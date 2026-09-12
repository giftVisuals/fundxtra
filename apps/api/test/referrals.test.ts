import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from './fake-firestore';

/**
 * Referral integrity.
 *
 * The spec is precise about when ₦100 is owed, so these tests pin the rule
 * down: qualification happens on PIN + dashboard, not on task completion, and
 * it can never pay twice or pay a self-referral.
 */

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true };
});

// Settings are read on every referral call; serve them without Firestore.
vi.mock('../src/services/settings', () => ({
  getSettings: async () => ({
    referrals: { enabled: true, rewardKobo: 10_000 },
    platform: { botUsername: 'fundxtrabot' },
    withdrawals: {},
    rewards: {},
    tasks: {},
  }),
  withdrawalAvailability: () => ({ open: false, reason: null, opensAt: null }),
}));

const { attributeReferral, qualifyReferral, getReferralSummary } = await import(
  '../src/services/referrals'
);
const { mapUser } = await import('../src/services/users');

function seedUser(id: string, overrides: Record<string, unknown> = {}) {
  store.seed('users', id, {
    telegramId: id,
    firstName: `User ${id}`,
    username: `user${id}`,
    status: 'ACTIVE',
    hasPin: false,
    onboardedAt: null,
    balanceKobo: 0,
    lifetimeEarnedKobo: 0,
    lifetimePaidOutKobo: 0,
    referralCode: `CODE${id}`,
    referredBy: null,
    referralCount: 0,
    qualifiedReferralCount: 0,
    referralEarningsKobo: 0,
    riskScore: 0,
    flags: [],
    ...overrides,
  });
}

function user(id: string) {
  const data = store.snapshot()[`users/${id}`];
  if (!data) throw new Error(`user ${id} not seeded`);
  return mapUser(id, data);
}

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  store.transactionAttempts = 0;
});

describe('attribution', () => {
  it('records a pending referral and links the referred user to the referrer', async () => {
    seedUser('100');
    seedUser('200');

    const result = await attributeReferral(user('200'), 'CODE100');

    expect(result.attributed).toBe(true);
    expect(result.referrerId).toBe('100');

    const referral = store.snapshot()['referrals/200'];
    expect(referral?.status).toBe('PENDING');
    expect(referral?.referrerId).toBe('100');
    expect(referral?.rewardKobo).toBe(10_000);
    // Pending, so nothing has been paid yet.
    expect(store.snapshot()['users/100']?.balanceKobo).toBe(0);
    expect(store.snapshot()['users/100']?.referralCount).toBe(1);
    expect(store.snapshot()['users/200']?.referredBy).toBe('100');
  });

  it('refuses a self-referral and flags the account', async () => {
    seedUser('100');

    const result = await attributeReferral(user('100'), 'CODE100');

    expect(result.attributed).toBe(false);
    expect(result.reason).toBe('SELF_REFERRAL');
    expect(store.snapshot()['referrals/100']).toBeUndefined();
    expect(store.snapshot()['users/100']?.flags).toContain('SELF_REFERRAL_ATTEMPT');
  });

  it('ignores an unknown referral code', async () => {
    seedUser('200');
    const result = await attributeReferral(user('200'), 'NOSUCHCODE');
    expect(result.attributed).toBe(false);
    expect(result.reason).toBe('UNKNOWN_CODE');
  });

  it('never re-attributes a user who already has a referrer', async () => {
    seedUser('100');
    seedUser('101');
    seedUser('200');

    await attributeReferral(user('200'), 'CODE100');
    const second = await attributeReferral(user('200'), 'CODE101');

    expect(second.attributed).toBe(false);
    expect(second.reason).toBe('ALREADY_ATTRIBUTED');
    expect(store.snapshot()['users/200']?.referredBy).toBe('100');
    expect(store.snapshot()['users/101']?.referralCount).toBe(0);
  });

  it('rejects attribution for a user who is already set up', async () => {
    seedUser('100');
    seedUser('200', { hasPin: true, onboardedAt: new Date().toISOString() });

    const result = await attributeReferral(user('200'), 'CODE100');
    expect(result.attributed).toBe(false);
    expect(result.reason).toBe('INELIGIBLE');
  });

  it('does not attribute to a suspended referrer', async () => {
    seedUser('100', { status: 'SUSPENDED' });
    seedUser('200');
    const result = await attributeReferral(user('200'), 'CODE100');
    expect(result.attributed).toBe(false);
    expect(result.reason).toBe('INELIGIBLE');
  });

  it('accepts the code case-insensitively', async () => {
    seedUser('100');
    seedUser('200');
    expect((await attributeReferral(user('200'), '  code100  ')).attributed).toBe(true);
  });
});

describe('qualification', () => {
  it('pays the referrer exactly ₦100 and records the ledger entry', async () => {
    seedUser('100');
    seedUser('200');
    await attributeReferral(user('200'), 'CODE100');

    const result = await qualifyReferral('200');

    expect(result.qualified).toBe(true);
    expect(result.rewardKobo).toBe(10_000);

    const snapshot = store.snapshot();
    expect(snapshot['users/100']?.balanceKobo).toBe(10_000);
    expect(snapshot['users/100']?.qualifiedReferralCount).toBe(1);
    expect(snapshot['users/100']?.referralEarningsKobo).toBe(10_000);
    expect(snapshot['referrals/200']?.status).toBe('QUALIFIED');
    expect(snapshot['referrals/200']?.transactionId).toBe(result.transactionId);

    // The credit is a real ledger row, not just a balance bump.
    const transaction = snapshot[`transactions/${result.transactionId}`];
    expect(transaction?.type).toBe('REFERRAL_REWARD');
    expect(transaction?.amountKobo).toBe(10_000);
    expect(transaction?.userId).toBe('100');
  });

  it('is idempotent: qualifying twice pays once', async () => {
    seedUser('100');
    seedUser('200');
    await attributeReferral(user('200'), 'CODE100');

    const first = await qualifyReferral('200');
    const second = await qualifyReferral('200');

    expect(first.qualified).toBe(true);
    expect(second.qualified).toBe(false);
    expect(store.snapshot()['users/100']?.balanceKobo).toBe(10_000);
    expect(store.countIn('transactions')).toBe(1);
  });

  it('pays once when two concurrent requests both try to qualify', async () => {
    seedUser('100');
    seedUser('200');
    await attributeReferral(user('200'), 'CODE100');

    await Promise.all([qualifyReferral('200'), qualifyReferral('200')]);

    expect(store.snapshot()['users/100']?.balanceKobo).toBe(10_000);
    expect(store.snapshot()['users/100']?.qualifiedReferralCount).toBe(1);
    expect(store.countIn('transactions')).toBe(1);
  });

  it('does nothing when there is no referral to qualify', async () => {
    seedUser('200');
    expect((await qualifyReferral('200')).qualified).toBe(false);
    expect(store.countIn('transactions')).toBe(0);
  });

  it('withholds payment while the referrer is suspended, without destroying the referral', async () => {
    seedUser('100');
    seedUser('200');
    await attributeReferral(user('200'), 'CODE100');

    store.commit([{ kind: 'update', path: 'users/100', data: { status: 'SUSPENDED' } }]);

    expect((await qualifyReferral('200')).qualified).toBe(false);
    expect(store.snapshot()['users/100']?.balanceKobo).toBe(0);
    // Still PENDING, so an admin can settle it after review.
    expect(store.snapshot()['referrals/200']?.status).toBe('PENDING');
  });

  it('does not require the referred user to complete any task', async () => {
    seedUser('100');
    seedUser('200');
    await attributeReferral(user('200'), 'CODE100');

    // No task completions exist at all.
    expect(store.countIn('taskCompletions')).toBe(0);
    expect((await qualifyReferral('200')).qualified).toBe(true);
    expect(store.snapshot()['users/100']?.balanceKobo).toBe(10_000);
  });
});

describe('summary', () => {
  it('counts qualified and pending referrals separately', async () => {
    seedUser('100');
    seedUser('200');
    seedUser('201');
    seedUser('202');

    await attributeReferral(user('200'), 'CODE100');
    await attributeReferral(user('201'), 'CODE100');
    await attributeReferral(user('202'), 'CODE100');
    await qualifyReferral('200');
    await qualifyReferral('201');

    const summary = await getReferralSummary(user('100'));
    expect(summary.totalReferrals).toBe(3);
    expect(summary.qualifiedReferrals).toBe(2);
    expect(summary.pendingReferrals).toBe(1);
    expect(summary.earningsKobo).toBe(20_000);
    expect(summary.referralLink).toBe('https://t.me/fundxtrabot?start=CODE100');
    expect(summary.rewardPerReferralKobo).toBe(10_000);
  });
});
