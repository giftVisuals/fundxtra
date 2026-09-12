/**
 * Rate limiting.
 *
 * An in-process sliding-window counter. This is intentionally simple: the API
 * is a single Railway service, so a shared store would add a dependency without
 * buying much. Two consequences are worth stating plainly rather than
 * discovering later:
 *
 *  - Limits are per instance. Scaling to N replicas multiplies the effective
 *    limit by N. If the service is ever scaled horizontally, swap
 *    `MemoryRateLimiter` for a Redis-backed implementation of the same
 *    interface; nothing else needs to change.
 *  - Counters reset on deploy. Acceptable for abuse throttling.
 *
 * PIN lockout is *not* built on this. That state is persisted per user in
 * Firestore, because a lockout must survive a restart — otherwise redeploying
 * would hand an attacker a fresh set of attempts.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window frees up. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): RateLimitResult;
  reset(key: string): void;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private lastSweep = Date.now();

  consume(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    this.sweep(now);

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    if (existing.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Drop expired windows so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

export const rateLimiter: RateLimiter = new MemoryRateLimiter();

/** Named policies, so limits are reviewable in one place. */
export const RATE_LIMITS = {
  /** Session exchange. Generous: Telegram re-opens the app often. */
  auth: { limit: 30, windowSeconds: 60 },
  /** PIN verification per user. The persistent lockout is the real defence. */
  pin: { limit: 10, windowSeconds: 300 },
  /** Task completion attempts per user. */
  taskComplete: { limit: 20, windowSeconds: 60 },
  /** Proof uploads per user. */
  upload: { limit: 10, windowSeconds: 300 },
  /** Withdrawal and redemption requests per user. */
  payout: { limit: 8, windowSeconds: 300 },
  /** Everything else, per IP. */
  general: { limit: 240, windowSeconds: 60 },
  /** Unauthenticated public endpoints, per IP. */
  publicApi: { limit: 60, windowSeconds: 60 },
} as const;
