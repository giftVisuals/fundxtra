import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from './fake-firestore';

/**
 * Lists must survive a missing composite index.
 *
 * Firestore serves `where(field == x).orderBy(other)` only from a composite
 * index, and until one is built the query fails with FAILED_PRECONDITION. That
 * took the Refer and Wallet screens down entirely: a user could sign in and
 * then could not see their own referrals or their own money.
 *
 * Whether an index has finished building is not something the person looking
 * at their balance can influence, so these lists now fall back to sorting in
 * memory. This asserts the rows still come back, still newest-first.
 */

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

vi.mock('../src/services/settings', () => ({
  getSettings: async () => ({
    referrals: { enabled: true, rewardKobo: 10_000 },
    platform: { botUsername: 'fundxtrabot' },
    withdrawals: {}, rewards: {}, tasks: {},
  }),
  withdrawalAvailability: () => ({ open: true, reason: null, opensAt: null }),
}));

const { listReferrals } = await import('../src/services/referrals');
const { listUserTransactions } = await import('../src/services/ledger');

/** Makes only the *ordered* form of a query fail, the way Firestore does. */
function refuseOrderedQueries(): () => void {
  const original = store.collection.bind(store);
  store.collection = ((name: string) => {
    const target = original(name);
    const wrap = (query: Record<string, unknown>): unknown =>
      new Proxy(query, {
        get(source, property) {
          const value = Reflect.get(source, property);
          if (property === 'orderBy') {
            return () => {
              const failing = {
                limit: () => failing,
                startAfter: () => failing,
                get: () => {
                  throw Object.assign(
                    new Error('9 FAILED_PRECONDITION: The query requires an index.'),
                    { code: 9 },
                  );
                },
              };
              return failing;
            };
          }
          if (property === 'where' && typeof value === 'function') {
            return (...args: unknown[]) =>
              wrap((value as (...a: unknown[]) => Record<string, unknown>).apply(source, args));
          }
          return typeof value === 'function' ? value.bind(source) : value;
        },
      });
    return wrap(target as unknown as Record<string, unknown>);
  }) as typeof store.collection;

  return () => {
    store.collection = original;
  };
}

describe('a user list with no composite index', () => {
  it('still returns referrals, newest first', async () => {
    store.seed('referrals', 'r-old', {
      referrerId: 'u1', referredUserId: 'u2', status: 'QUALIFIED',
      createdAt: Timestamp.fromMillis(1_000), rewardKobo: 10_000,
    });
    store.seed('referrals', 'r-new', {
      referrerId: 'u1', referredUserId: 'u3', status: 'PENDING',
      createdAt: Timestamp.fromMillis(9_000), rewardKobo: 10_000,
    });
    store.seed('referrals', 'r-other', {
      referrerId: 'somebody-else', referredUserId: 'u4', status: 'PENDING',
      createdAt: Timestamp.fromMillis(5_000), rewardKobo: 10_000,
    });

    const restore = refuseOrderedQueries();
    try {
      const referrals = await listReferrals('u1');

      // Present, ordered, and still scoped to this referrer.
      expect(referrals.map((entry) => entry.id)).toEqual(['r-new', 'r-old']);
    } finally {
      restore();
    }
  });

  it('still returns the wallet history, newest first', async () => {
    for (const [id, millis] of [['t-a', 1_000], ['t-c', 9_000], ['t-b', 5_000]] as const) {
      store.seed('transactions', id, {
        userId: 'u1', type: 'TASK_REWARD', direction: 'CREDIT', status: 'COMPLETED',
        amountKobo: 5_000, balanceAfterKobo: 5_000, description: id,
        createdAt: Timestamp.fromMillis(millis),
      });
    }

    const restore = refuseOrderedQueries();
    try {
      const page = await listUserTransactions('u1', { limit: 10 });

      expect(page.items.map((item) => item.id)).toEqual(['t-c', 't-b', 't-a']);
      // Paging needs an ordering, so the fallback reports the end rather than
      // handing out a cursor it could not honour.
      expect(page.nextCursor).toBeNull();
    } finally {
      restore();
    }
  });

  it('respects the requested limit', async () => {
    for (let index = 0; index < 6; index += 1) {
      store.seed('transactions', `x-${String(index)}`, {
        userId: 'u2', type: 'TASK_REWARD', direction: 'CREDIT', status: 'COMPLETED',
        amountKobo: 1_000, balanceAfterKobo: 1_000, description: 'x',
        createdAt: Timestamp.fromMillis(index * 1_000),
      });
    }

    const restore = refuseOrderedQueries();
    try {
      const page = await listUserTransactions('u2', { limit: 3 });

      expect(page.items).toHaveLength(3);
      expect(page.items[0]?.id).toBe('x-5');
    } finally {
      restore();
    }
  });
});

describe('failures that are not a missing index', () => {
  it('are not swallowed by the fallback', async () => {
    const original = store.collection.bind(store);
    store.collection = ((name: string) => {
      const target = original(name);
      return {
        ...target,
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              get: () => {
                throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
              },
            }),
          }),
        }),
      };
    }) as typeof store.collection;

    try {
      // A credentials problem must surface, not be hidden behind an
      // in-memory sort that would quietly read nothing.
      await expect(listReferrals('u1')).rejects.toThrow('PERMISSION_DENIED');
    } finally {
      store.collection = original;
    }
  });
});
