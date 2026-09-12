import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from './fake-firestore';

/**
 * Ledger integrity.
 *
 * These tests answer the questions that matter for a system holding real money:
 * can a reward be credited twice, can a balance go negative, does the cached
 * balance ever disagree with the ledger, and does a failed write leave partial
 * state behind.
 */

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>(
    '../src/lib/firebase',
  );
  return { ...actual, db: () => store, firestoreAvailable: true };
});

const {
  postEntry,
  reverseEntry,
  auditUserBalance,
  listUserTransactions,
  idempotencyKey,
} = await import('../src/services/ledger');

function seedUser(id = 'u1', balanceKobo = 0) {
  store.seed('users', id, {
    telegramId: id,
    balanceKobo,
    lifetimeEarnedKobo: 0,
    lifetimePaidOutKobo: 0,
    status: 'ACTIVE',
  });
}

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  store.onBeforeCommit = null;
  store.transactionAttempts = 0;
});

describe('posting entries', () => {
  it('credits the balance and writes an immutable ledger row together', async () => {
    seedUser('u1', 0);

    const result = await postEntry({
      userId: 'u1',
      type: 'TASK_REWARD',
      amountKobo: 15_000,
      description: 'Join the Fundxtra channel',
      idempotencyKey: 'task__u1__t1',
      reference: 't1',
    });

    expect(result.replayed).toBe(false);
    expect(result.balanceAfterKobo).toBe(15_000);
    expect(result.transaction.amountKobo).toBe(15_000);
    expect(result.transaction.direction).toBe('CREDIT');
    expect(result.transaction.balanceAfterKobo).toBe(15_000);

    const snapshot = store.snapshot();
    expect(snapshot['users/u1']?.balanceKobo).toBe(15_000);
    expect(snapshot['users/u1']?.lifetimeEarnedKobo).toBe(15_000);
    expect(store.countIn('transactions')).toBe(1);
  });

  it('stores debits as negative amounts and tracks lifetime payout', async () => {
    seedUser('u1', 100_000);

    const result = await postEntry({
      userId: 'u1',
      type: 'CASH_WITHDRAWAL',
      amountKobo: 30_000,
      description: 'Withdrawal to bank',
      idempotencyKey: 'wd__u1__1',
    });

    expect(result.transaction.direction).toBe('DEBIT');
    expect(result.transaction.amountKobo).toBe(-30_000);
    expect(result.balanceAfterKobo).toBe(70_000);
    expect(store.snapshot()['users/u1']?.lifetimePaidOutKobo).toBe(30_000);
  });

  it('refuses a debit that would overdraw the balance, writing nothing at all', async () => {
    seedUser('u1', 20_000);

    await expect(
      postEntry({
        userId: 'u1',
        type: 'CASH_WITHDRAWAL',
        amountKobo: 30_000,
        description: 'Too much',
        idempotencyKey: 'wd__u1__over',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

    // The transaction aborted, so no ledger row and no idempotency key survive.
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(20_000);
    expect(store.countIn('transactions')).toBe(0);
    expect(store.countIn('idempotencyKeys')).toBe(0);
  });

  it('rejects non-integer and non-positive amounts', async () => {
    seedUser('u1', 0);
    for (const amountKobo of [0, -100, 10.5, Number.NaN]) {
      await expect(
        postEntry({
          userId: 'u1',
          type: 'TASK_REWARD',
          amountKobo,
          description: 'bad',
          idempotencyKey: `bad__${amountKobo}`,
        }),
      ).rejects.toThrow();
    }
    expect(store.countIn('transactions')).toBe(0);
  });
});

describe('idempotency — the double-credit defence', () => {
  it('a repeated request returns the original entry and does not pay twice', async () => {
    seedUser('u1', 0);
    const key = idempotencyKey('task', 'u1', 't1');

    const first = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Reward', idempotencyKey: key,
    });
    const second = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Reward', idempotencyKey: key,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(15_000);
    expect(store.countIn('transactions')).toBe(1);
  });

  it('survives a genuine race: two concurrent requests, one credit', async () => {
    seedUser('u1', 0);
    const key = idempotencyKey('task', 'u1', 'race');

    // Both requests read "no key yet" before either commits — the classic
    // check-then-act window. The create() on the key is what closes it.
    const [a, b] = await Promise.all([
      postEntry({
        userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
        description: 'Reward', idempotencyKey: key,
      }),
      postEntry({
        userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
        description: 'Reward', idempotencyKey: key,
      }),
    ]);

    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(15_000);
    expect(store.countIn('transactions')).toBe(1);
    // One of the two was served the original row.
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    expect(a.transaction.id).toBe(b.transaction.id);
  });

  it('different keys for the same user credit independently', async () => {
    seedUser('u1', 0);
    await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Task 1', idempotencyKey: 'task__u1__t1',
    });
    await postEntry({
      userId: 'u1', type: 'REFERRAL_REWARD', amountKobo: 10_000,
      description: 'Referral', idempotencyKey: 'ref__u1__u2',
    });
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(25_000);
    expect(store.countIn('transactions')).toBe(2);
  });

  it('retries and stays consistent when the balance is mutated mid-transaction', async () => {
    seedUser('u1', 0);

    // Inject a concurrent write to the user document just before the first
    // commit attempt, forcing the optimistic-concurrency retry path.
    let injected = false;
    store.onBeforeCommit = () => {
      if (injected) return;
      injected = true;
      store.commit([{ kind: 'update', path: 'users/u1', data: { balanceKobo: 50_000 } }]);
    };

    const result = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Reward', idempotencyKey: 'task__u1__retry',
    });

    // The retry re-read the *new* balance, so the credit lands on top of it
    // rather than clobbering the concurrent write.
    expect(result.balanceAfterKobo).toBe(65_000);
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(65_000);
    expect(store.countIn('transactions')).toBe(1);
    expect(store.transactionAttempts).toBeGreaterThan(1);
  });
});

describe('reversals', () => {
  it('undoes a credit with a compensating entry and leaves both rows visible', async () => {
    seedUser('u1', 0);
    const credit = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Reward', idempotencyKey: 'task__u1__t1',
    });

    const reversal = await reverseEntry({
      transactionId: credit.transaction.id,
      reason: 'Fraudulent completion',
      actorAdminId: '6438544386',
      idempotencyKey: 'rev__t1',
    });

    expect(reversal.transaction.type).toBe('REVERSAL');
    expect(reversal.transaction.direction).toBe('DEBIT');
    expect(reversal.transaction.reversalOf).toBe(credit.transaction.id);
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(0);
    // Original row survives, marked reversed — the audit trail is intact.
    expect(store.snapshot()[`transactions/${credit.transaction.id}`]?.status).toBe('REVERSED');
    expect(store.countIn('transactions')).toBe(2);
  });

  it('allows a reversal to push a spent balance negative rather than absorbing the loss', async () => {
    seedUser('u1', 0);
    const credit = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Reward', idempotencyKey: 'task__u1__t1',
    });
    await postEntry({
      userId: 'u1', type: 'AIRTIME_REDEMPTION', amountKobo: 15_000,
      description: 'Airtime', idempotencyKey: 'air__u1__1',
    });
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(0);

    await reverseEntry({
      transactionId: credit.transaction.id,
      reason: 'Chargeback',
      idempotencyKey: 'rev__t1',
    });
    expect(store.snapshot()['users/u1']?.balanceKobo).toBe(-15_000);
  });

  it('refuses to reverse the same entry twice', async () => {
    seedUser('u1', 0);
    const credit = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000,
      description: 'Reward', idempotencyKey: 'task__u1__t1',
    });
    await reverseEntry({ transactionId: credit.transaction.id, reason: 'a', idempotencyKey: 'r1' });
    await expect(
      reverseEntry({ transactionId: credit.transaction.id, reason: 'b', idempotencyKey: 'r2' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
  });
});

describe('integrity audit', () => {
  it('confirms the cache matches the ledger after a series of movements', async () => {
    seedUser('u1', 0);
    await postEntry({ userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000, description: 'a', idempotencyKey: 'k1' });
    await postEntry({ userId: 'u1', type: 'REFERRAL_REWARD', amountKobo: 10_000, description: 'b', idempotencyKey: 'k2' });
    await postEntry({ userId: 'u1', type: 'CASH_WITHDRAWAL', amountKobo: 20_000, description: 'c', idempotencyKey: 'k3' });

    const audit = await auditUserBalance('u1');
    expect(audit.cachedKobo).toBe(5_000);
    expect(audit.ledgerKobo).toBe(5_000);
    expect(audit.matches).toBe(true);
    expect(audit.entryCount).toBe(3);
  });

  it('detects a tampered balance cache instead of trusting it', async () => {
    seedUser('u1', 0);
    await postEntry({ userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000, description: 'a', idempotencyKey: 'k1' });

    // Simulate someone editing the balance field directly in the console.
    store.commit([{ kind: 'update', path: 'users/u1', data: { balanceKobo: 900_000 } }]);

    const audit = await auditUserBalance('u1');
    expect(audit.matches).toBe(false);
    expect(audit.cachedKobo).toBe(900_000);
    expect(audit.ledgerKobo).toBe(15_000);
  });
});

describe('history', () => {
  it('returns newest first and pages with a cursor', async () => {
    seedUser('u1', 0);
    for (let index = 0; index < 5; index += 1) {
      await postEntry({
        userId: 'u1', type: 'TASK_REWARD', amountKobo: 1_000 * (index + 1),
        description: `Task ${index}`, idempotencyKey: `k${index}`,
      });
    }

    const first = await listUserTransactions('u1', { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listUserTransactions('u1', { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items).toHaveLength(2);
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(4);
  });

  it("sums only today's non-reversed credits", async () => {
    seedUser('u1', 0);
    const credit = await postEntry({
      userId: 'u1', type: 'TASK_REWARD', amountKobo: 15_000, description: 'a', idempotencyKey: 'k1',
    });
    await postEntry({
      userId: 'u1', type: 'REFERRAL_REWARD', amountKobo: 10_000, description: 'b', idempotencyKey: 'k2',
    });
    const { sumTodayCredits } = await import('../src/services/ledger');
    expect((await sumTodayCredits('u1')).kobo).toBe(25_000);

    await reverseEntry({ transactionId: credit.transaction.id, reason: 'x', idempotencyKey: 'r1' });
    // The reversed credit drops out; the reversal itself is a debit, so it does
    // not inflate today's earnings either.
    expect((await sumTodayCredits('u1')).kobo).toBe(10_000);
  });
});
