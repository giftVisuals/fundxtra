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
    referrals: { enabled: true, rewardKobo: 10_000, joinBonusKobo: 5_000, lateClaimDays: 7 },
    platform: { botUsername: 'fundxtrabot' },
    withdrawals: {},
    rewards: {},
    tasks: {},
  }),
  withdrawalAvailability: () => ({ open: false, reason: null, opensAt: null }),
}));

const { attributeReferral, qualifyReferral, getReferralSummary, claimReferralCode } = await import(
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

/**
 * Adding a referral code after signing up without one.
 *
 * Most people hear about Fundxtra from a friend and then open the bot
 * directly, so the friend's code never travels with them and the friend
 * concludes that promoting it earned them nothing. The box that fixes that is
 * also the most farmable thing on the platform — a throwaway Telegram account
 * typing any code is worth the joining bonus — so the guards are the feature.
 */
describe('claiming a referral code late', () => {
  function claimant(id: string, overrides: Record<string, unknown> = {}) {
    seedUser(id, { hasPin: true, onboardedAt: new Date().toISOString(), ...overrides });
    return mapUser(id, store.snapshot()[`users/${id}`]!);
  }

  it('attributes the referral and pays the joining bonus', async () => {
    seedUser('700');
    const newcomer = claimant('701');

    const outcome = await claimReferralCode(newcomer, 'CODE700');

    expect(outcome.claimed).toBe(true);
    expect(outcome.bonusKobo).toBe(5_000);
    expect(store.snapshot()['users/701']?.referredBy).toBe('700');
  });

  it('is case-insensitive, because nobody types a code in caps', async () => {
    seedUser('702');
    const newcomer = claimant('703');

    expect((await claimReferralCode(newcomer, '  code702  ')).claimed).toBe(true);
  });

  it('refuses somebody who has already earned', async () => {
    seedUser('704');
    const established = claimant('705', { lifetimeEarnedKobo: 40_000 });

    /*
      The real risk: an account that has been using the platform for weeks
      suddenly attributing itself to a friend for the bonus. Nothing earned
      means nothing to launder.
    */
    const outcome = await claimReferralCode(established, 'CODE704');
    expect(outcome.claimed).toBe(false);
    expect(outcome.reason).toBe('ALREADY_EARNED');
  });

  it('refuses an account older than the window', async () => {
    seedUser('706');
    const old = claimant('707', {
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });

    // A dormant account suddenly attributed to somebody is more likely sold
    // than late-remembered.
    expect((await claimReferralCode(old, 'CODE706')).reason).toBe('WINDOW_CLOSED');
  });

  it('refuses a second code once one is set', async () => {
    seedUser('708');
    seedUser('709');
    const newcomer = claimant('710', { referredBy: '708' });

    expect((await claimReferralCode(newcomer, 'CODE709')).reason).toBe('ALREADY_ATTRIBUTED');
  });

  it('refuses your own code', async () => {
    const selfish = claimant('711');

    const outcome = await claimReferralCode(selfish, 'CODE711');
    expect(outcome.claimed).toBe(false);
    expect(store.snapshot()['users/711']?.referredBy).toBeNull();
  });

  it('refuses a code that does not exist', async () => {
    const newcomer = claimant('712');
    expect((await claimReferralCode(newcomer, 'NOTREAL1')).reason).toBe('UNKNOWN_CODE');
  });

  it('pays the bonus once, however many times it is tapped', async () => {
    seedUser('713');
    const newcomer = claimant('714');

    await claimReferralCode(newcomer, 'CODE713');
    const after = mapUser('714', store.snapshot()['users/714']!);
    const second = await claimReferralCode(after, 'CODE713');

    expect(second.claimed).toBe(false);
    expect(store.snapshot()['users/714']?.balanceKobo).toBe(5_000);
  });
});
