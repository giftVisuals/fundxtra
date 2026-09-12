import type { Query, QuerySnapshot } from 'firebase-admin/firestore';
import { logger } from './logger';

/**
 * Runs a query that wants a composite index, and survives its absence.
 *
 * Firestore serves `where(field == x).orderBy(other)` only from a composite
 * index. When that index has not been built the query fails outright with
 * FAILED_PRECONDITION — and a user's own wallet history and referral list are
 * not features that may disappear because of a provisioning step they cannot
 * see or influence.
 *
 * So the ordered query is attempted first, because when the index exists it is
 * the right one: ordering and the limit are applied by the database. If it is
 * refused, the same rows are fetched with the equality filter alone — which
 * Firestore always serves from the automatic single-field index — and ordered
 * in memory.
 *
 * The fallback reads more rows than it returns, so it is capped. Beyond the
 * cap the result is the newest rows *within the fetched set* rather than
 * across the whole collection, which is why the cap is generous and why the
 * indexed path stays the one that matters at scale. For one user's own
 * history it is not a limit that is reached in practice.
 */

const FALLBACK_FETCH_CAP = 500;

export interface OrderedQueryOptions<T> {
  /** The query with the equality filters only — no orderBy, no limit. */
  base: Query;
  /** The same query with ordering and limit applied. */
  ordered: Query;
  /** How many documents the caller wants. */
  limit: number;
  /** Sort key, read from a document. Higher sorts first. */
  timestampOf: (data: T) => number;
  /** Names the query in logs. */
  label: string;
}

/** True for the specific failure that means "no composite index". */
function isMissingIndex(error: unknown): boolean {
  const code = (error as { code?: number }).code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 9 && /index/i.test(message);
}

export async function runOrderedQuery<T extends Record<string, unknown>>(
  options: OrderedQueryOptions<T>,
): Promise<QuerySnapshot> {
  try {
    return await options.ordered.get();
  } catch (error) {
    if (!isMissingIndex(error)) throw error;

    logger.warn(
      {
        query: options.label,
        hint: 'Sorting in memory until the composite index finishes building. Deploy firebase/firestore.indexes.json, or grant the service account Cloud Datastore Index Admin so the API can create it.',
      },
      'Composite index missing; using the unordered fallback',
    );

    const snapshot = await options.base.limit(FALLBACK_FETCH_CAP).get();
    const docs = [...snapshot.docs].sort(
      (a, b) => options.timestampOf(b.data() as T) - options.timestampOf(a.data() as T),
    );

    // Reshaped to look like a snapshot to the caller, so neither list has to
    // know which path produced its rows.
    const page = docs.slice(0, options.limit);
    return {
      ...snapshot,
      docs: page,
      size: page.length,
      empty: page.length === 0,
      forEach: (callback: (doc: (typeof page)[number]) => void) => page.forEach(callback),
    } as unknown as QuerySnapshot;
  }
}

/**
 * Milliseconds from whatever shape a timestamp arrives in.
 *
 * A live Firestore read gives a `Timestamp` with `toMillis`. The same value
 * loses its prototype whenever it passes through structured cloning or JSON —
 * a cached document, a serialized fixture — and arrives as a bare
 * `{_seconds, _nanoseconds}`. Reading only `toMillis` would silently score
 * those as 0 and shuffle the list into an arbitrary order, which is a worse
 * failure than an error because it looks like it worked.
 *
 * A plain number passes through, which is also what makes this usable as the
 * comparator for a numeric sort such as `riskScore`.
 */
export function millisOf(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();

  if (value && typeof value === 'object') {
    const candidate = value as {
      toMillis?: unknown;
      _seconds?: unknown;
      seconds?: unknown;
      _nanoseconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof candidate.toMillis === 'function') {
      return (candidate.toMillis as () => number)();
    }

    const seconds = candidate._seconds ?? candidate.seconds;
    if (typeof seconds === 'number') {
      const nanos = candidate._nanoseconds ?? candidate.nanoseconds;
      return seconds * 1_000 + (typeof nanos === 'number' ? Math.floor(nanos / 1_000_000) : 0);
    }
  }

  return 0;
}
