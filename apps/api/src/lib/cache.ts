import { logger } from './logger';

/**
 * In-process caches, sized for what actually costs money: Firestore reads.
 *
 * The measured problem was one user generating 966 reads and 465 writes in a
 * short session. Almost none of that was the user doing anything — it was the
 * same unchanging data being re-read on every request, and bookkeeping writes
 * ("last active at") firing on every request too.
 *
 * Three different shapes of the same idea live here:
 *
 *  - `shared`     one value everybody gets — the task list. Ten thousand users
 *                 asking for it should cost one read, not ten thousand.
 *  - `perKey`     one value per user, held briefly, so the three calls a screen
 *                 makes on open share a single read instead of taking three.
 *  - `throttle`   not a cache at all: a gate that lets a write through at most
 *                 once per interval, for writes nobody is waiting on.
 *
 * Deliberately in-process rather than Redis. The API runs as one replica (see
 * nixpacks.toml), so a process-local cache is the whole cache; when that stops
 * being true this file is the seam where Redis goes, and nothing above it
 * changes. A per-process cache is also self-limiting on restart, which is the
 * right failure mode for something holding balances.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A single shared value, refreshed on demand.
 *
 * In-flight requests share one load: without that, a cold cache under load
 * sends every simultaneous request to Firestore at once, which is precisely
 * the moment it hurts most.
 */
export class SharedCache<T> {
  private entry: Entry<T> | null = null;
  private inFlight: Promise<T> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly label: string,
  ) {}

  async get(load: () => Promise<T>): Promise<T> {
    if (this.entry && this.entry.expiresAt > Date.now()) return this.entry.value;
    if (this.inFlight) return this.inFlight;

    this.inFlight = load()
      .then((value) => {
        this.entry = { value, expiresAt: Date.now() + this.ttlMs };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /** Drop the value, so the next read is fresh. Call after writing to it. */
  invalidate(): void {
    this.entry = null;
    logger.debug({ cache: this.label }, 'Shared cache invalidated');
  }
}

/**
 * A short-lived value per key, with a hard cap on how many are held.
 *
 * The cap matters: one entry per active user is fine, one entry per user who
 * has ever signed in is a memory leak with a slow fuse. When it is reached the
 * oldest entries go first, which for a TTL this short is the same set that was
 * about to expire anyway.
 */
export class KeyedCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly label: string,
  ) {}

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictOldest();
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Forget one key.
   *
   * Every path that writes to the cached record must call this. A stale
   * balance is not a performance problem, it is a wrong number on a screen
   * about money — so the rule is that the writer invalidates, always, and the
   * TTL is only a backstop for what the writer missed.
   */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evictOldest(): void {
    // Map preserves insertion order, and every set is an insert or a refresh,
    // so the first key is the least recently written.
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
    logger.debug({ cache: this.label, size: this.entries.size }, 'Keyed cache evicted');
  }
}

/**
 * Let something through at most once per interval, per key.
 *
 * For writes nobody is waiting on and nobody would miss: "this admin was
 * active", "this user opened the app". Those were firing on every single
 * request. Recording them once an hour says the same thing for any purpose
 * they are actually used for.
 */
export class Throttle {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly maxKeys = 5_000,
  ) {}

  /** True at most once per interval for a given key. */
  claim(key: string): boolean {
    const now = Date.now();
    const previous = this.last.get(key);
    if (previous !== undefined && now - previous < this.intervalMs) return false;

    if (this.last.size >= this.maxKeys && !this.last.has(key)) {
      const oldest = this.last.keys().next();
      if (!oldest.done) this.last.delete(oldest.value);
    }
    this.last.set(key, now);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}
