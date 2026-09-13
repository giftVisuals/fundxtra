import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from './fake-firestore';

/**
 * Actions must survive a missing composite index, not only lists.
 *
 * A real withdrawal of ₦300 failed in production with
 * "Fundxtra is finishing a one-time setup step". The cause was the daily-limit
 * check: `userId ==` plus a range on `requestedAt` is the one query shape
 * Firestore refuses to serve without a composite index, and that check runs
 * before a withdrawal is created — so an index still building did not slow
 * anything down, it stopped every withdrawal on the platform.
 *
 * `query-fallback.test.ts` covers the list side of this, where the cost of a
 * missing index is ordering. These cover the side where the cost is the action
 * itself, and the extra rule that comes with it: a *limit* check that falls
 * back must still be exact, because a daily total that reads too low is a daily
 * limit somebody can walk past.
 */

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true };
});

let settings = freshSettings();

function freshSettings() {
  return {
    withdrawals: {
      enabled: true,
      maintenanceMessage: 'Withdrawals open shortly.',
      opensAt: null as string | null,
      closesAt: null as string | null,
      minAmountKobo: 10_000,
      maxAmountKobo: 20_000_000,
      dailyLimitKobo: 100_000,
      feeKobo: 0,
      requireManualApproval: true,
    },
    rewards: {},
    referrals: { enabled: true, rewardKobo: 10_000 },
    tasks: { maxRewardKobo: 100_000, earningEnabled: true },
    platform: { botUsername: 'fundxtrabot', supportHandle: '@fundxtracarebot', maintenanceMode: false },
  };
}

vi.mock('../src/services/settings', async () => {
  const actual = await vi.importActual<typeof import('../src/services/settings')>(
    '../src/services/settings',
  );
  return { ...actual, getSettings: async () => settings };
});

const { requestWithdrawal } = await import('../src/services/withdrawals');
const { expireFinishedTasks } = await import('../src/services/tasks');
const { recentPinFailures } = await import('../src/services/auth');
const { mapUser } = await import('../src/services/users');

const RANGE_OPERATORS = new Set(['<', '<=', '>', '>=', '!=']);

/**
 * Refuse exactly what Firestore refuses.
 *
 * Multiple equality filters are served by merging single-field indexes, so
 * those keep working. An equality combined with a range on a different field
 * is the combination that needs a composite index — so that is the only shape
 * this makes fail, and it fails the way Firestore does: gRPC code 9.
 */
function refuseCompositeQueries(): () => void {
  const original = store.collection.bind(store);

  const wrap = (query: object, filters: [string, string][]): object =>
    new Proxy(query, {
      get(source, property) {
        const value = Reflect.get(source, property);

        if (property === 'where' && typeof value === 'function') {
          return (field: string, op: string, ...rest: unknown[]) =>
            wrap(
              (value as (...a: unknown[]) => object).call(source, field, op, ...rest),
              [...filters, [field, op]],
            );
        }
        if (property === 'limit' && typeof value === 'function') {
          return (...args: unknown[]) =>
            wrap((value as (...a: unknown[]) => object).apply(source, args), filters);
        }
        if (property === 'get' && typeof value === 'function') {
          const fields = new Set(filters.map(([field]) => field));
          const hasRange = filters.some(([, op]) => RANGE_OPERATORS.has(op));
          if (fields.size > 1 && hasRange) {
            return () =>
              Promise.reject(
                Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), {
                  code: 9,
                }),
              );
          }
        }
        return typeof value === 'function' ? (value as () => unknown).bind(source) : value;
      },
    });

  store.collection = ((name: string) =>
    wrap(original(name) as unknown as object, [])) as typeof store.collection;

  return () => {
    store.collection = original;
  };
}

function seedUser(id: string, balanceKobo: number) {
  store.seed('users', id, {
    telegramId: id, firstName: `User ${id}`, username: `user${id}`, status: 'ACTIVE',
    hasPin: true, onboardedAt: new Date().toISOString(),
    balanceKobo, lifetimeEarnedKobo: balanceKobo, lifetimePaidOutKobo: 0, pendingOutKobo: 0,
    tasksCompleted: 0, referralCode: `CODE${id}`, referredBy: null, referralCount: 0,
    qualifiedReferralCount: 0, referralEarningsKobo: 0, riskScore: 0, flags: [],
    createdAt: new Date(Date.now() - 7 * 86_400_000),
  });
}

function user(id: string) {
  return mapUser(id, store.snapshot()[`users/${id}`]!);
}

const OPAY = '999992';

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  settings = freshSettings();
});

describe('a withdrawal with no composite index', () => {
  it('goes through instead of failing the user', async () => {
    seedUser('300', 200_000);

    const restore = refuseCompositeQueries();
    try {
      const withdrawal = await requestWithdrawal({
        user: user('300'), amountKobo: 30_000,
        bankCode: OPAY, accountNumber: '9161376561', accountName: 'GIFT VISUALS',
      });

      expect(withdrawal.status).toBe('PENDING');
      expect(withdrawal.amountKobo).toBe(30_000);
    } finally {
      restore();
    }
  });

  it('still counts today against the daily limit', async () => {
    seedUser('301', 500_000);
    // Already spent today, written straight to the store so the limit check is
    // the only thing under test.
    store.seed('withdrawals', 'w-earlier', {
      userId: '301', amountKobo: 80_000, feeKobo: 0, netKobo: 80_000, status: 'PENDING',
      bank: { bankCode: OPAY, bankName: 'OPay', accountNumber: '9161376561', accountName: 'GIFT VISUALS' },
      requestedAt: Timestamp.now(), transactionId: 't-earlier',
    });

    const restore = refuseCompositeQueries();
    try {
      // 80,000 + 30,000 passes the 100,000 daily limit. The fallback must see
      // the earlier request; if it counted zero the limit would not exist.
      await expect(
        requestWithdrawal({
          user: user('301'), amountKobo: 30_000,
          bankCode: OPAY, accountNumber: '9161376561', accountName: 'GIFT VISUALS',
        }),
      ).rejects.toThrow(/daily limit/i);
    } finally {
      restore();
    }
  });

  it('ignores yesterday, exactly as the indexed query would', async () => {
    seedUser('302', 500_000);
    store.seed('withdrawals', 'w-yesterday', {
      userId: '302', amountKobo: 90_000, feeKobo: 0, netKobo: 90_000, status: 'PAID',
      bank: { bankCode: OPAY, bankName: 'OPay', accountNumber: '9161376561', accountName: 'GIFT VISUALS' },
      requestedAt: Timestamp.fromMillis(Date.now() - 3 * 86_400_000), transactionId: 't-yesterday',
    });

    const restore = refuseCompositeQueries();
    try {
      const withdrawal = await requestWithdrawal({
        user: user('302'), amountKobo: 30_000,
        bankCode: OPAY, accountNumber: '9161376561', accountName: 'GIFT VISUALS',
      });
      expect(withdrawal.status).toBe('PENDING');
    } finally {
      restore();
    }
  });

  it('does not let another user spend this one’s limit', async () => {
    seedUser('303', 500_000);
    store.seed('withdrawals', 'w-somebody-else', {
      userId: 'somebody-else', amountKobo: 90_000, feeKobo: 0, netKobo: 90_000, status: 'PENDING',
      bank: { bankCode: OPAY, bankName: 'OPay', accountNumber: '9161376561', accountName: 'OTHER' },
      requestedAt: Timestamp.now(), transactionId: 't-other',
    });

    const restore = refuseCompositeQueries();
    try {
      const withdrawal = await requestWithdrawal({
        user: user('303'), amountKobo: 30_000,
        bankCode: OPAY, accountNumber: '9161376561', accountName: 'GIFT VISUALS',
      });
      expect(withdrawal.status).toBe('PENDING');
    } finally {
      restore();
    }
  });
});

describe('other equality-plus-range queries with no composite index', () => {
  it('still expires tasks whose end date has passed', async () => {
    const base = {
      title: 'Follow the channel', description: 'Tap follow', instructions: 'Tap follow',
      type: 'TELEGRAM_JOIN', verification: 'TELEGRAM', rewardKobo: 5_000,
      maxCompletions: 100, completionCount: 0, perUserLimit: 1,
      budgetKobo: 500_000, spentKobo: 0, pendingCount: 0,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), startsAt: null,
    };
    store.seed('tasks', 'finished', { ...base, status: 'ACTIVE', endsAt: Timestamp.fromMillis(Date.now() - 60_000) });
    store.seed('tasks', 'running', { ...base, status: 'ACTIVE', endsAt: Timestamp.fromMillis(Date.now() + 86_400_000) });
    store.seed('tasks', 'open-ended', { ...base, status: 'ACTIVE', endsAt: null });

    const restore = refuseCompositeQueries();
    try {
      expect(await expireFinishedTasks()).toBe(1);
    } finally {
      restore();
    }

    const snapshot = store.snapshot();
    expect(snapshot['tasks/finished']?.status).toBe('EXPIRED');
    expect(snapshot['tasks/running']?.status).toBe('ACTIVE');
    // A task with no end date never expires on its own.
    expect(snapshot['tasks/open-ended']?.status).toBe('ACTIVE');
  });

  it('still counts recent PIN failures for the fraud dashboard', async () => {
    store.seed('securityEvents', 'e1', { type: 'PIN_FAILED', createdAt: Timestamp.now() });
    store.seed('securityEvents', 'e2', { type: 'PIN_LOCKED', createdAt: Timestamp.now() });
    store.seed('securityEvents', 'e3', { type: 'PIN_FAILED', createdAt: Timestamp.fromMillis(Date.now() - 86_400_000) });
    store.seed('securityEvents', 'e4', { type: 'SUSPICIOUS_VELOCITY', createdAt: Timestamp.now() });

    const restore = refuseCompositeQueries();
    try {
      // The two recent PIN events only: not the day-old one, not the other type.
      expect(await recentPinFailures(60)).toBe(2);
    } finally {
      restore();
    }
  });
});
