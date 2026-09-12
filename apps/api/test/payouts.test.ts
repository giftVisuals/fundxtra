import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from './fake-firestore';

/**
 * Withdrawals and redemptions.
 *
 * The risk on money-out paths is not that a payment fails — it is that a
 * failure leaves the user short, or that a user spends the same balance twice.
 * These tests pin down the debit-first ordering and the compensating reversal.
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
      minAmountKobo: 30_000,
      maxAmountKobo: 20_000_000,
      dailyLimitKobo: 20_000_000,
      feeKobo: 0,
      requireManualApproval: true,
    },
    rewards: {
      airtimeEnabled: true,
      dataEnabled: true,
      starsEnabled: true,
      premiumEnabled: true,
      minAirtimeKobo: 10_000,
      minDataKobo: 10_000,
      activeProvider: 'mock',
    },
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

const { requestWithdrawal, transitionWithdrawal, cancelWithdrawal } = await import(
  '../src/services/withdrawals'
);
const { redeem, seedRewardCatalogue } = await import('../src/services/rewards');
const { setProvider } = await import('../src/providers');
const { MockProvider } = await import('../src/providers/mock');
const { NasfamPayProvider } = await import('../src/providers/nasfampay');
const { NoneProvider } = await import('../src/providers/none');
const { mapUser } = await import('../src/services/users');
const { auditUserBalance, postEntry } = await import('../src/services/ledger');

function seedUser(id: string, balanceKobo: number, overrides: Record<string, unknown> = {}) {
  store.seed('users', id, {
    telegramId: id, firstName: `User ${id}`, username: `user${id}`, status: 'ACTIVE',
    hasPin: true, onboardedAt: new Date().toISOString(),
    balanceKobo, lifetimeEarnedKobo: balanceKobo, lifetimePaidOutKobo: 0, pendingOutKobo: 0,
    tasksCompleted: 0, referralCode: `CODE${id}`, referredBy: null, referralCount: 0,
    qualifiedReferralCount: 0, referralEarningsKobo: 0, riskScore: 0, flags: [],
    createdAt: new Date(Date.now() - 7 * 86_400_000),
    ...overrides,
  });
}

function user(id: string) {
  return mapUser(id, store.snapshot()[`users/${id}`]!);
}

/**
 * Seed a user whose opening balance is backed by a real ledger entry.
 *
 * `seedUser` writes `balanceKobo` directly, which is fine for testing limits
 * but leaves the ledger empty — so `auditUserBalance` would (correctly) report
 * a mismatch. Any test that audits the ledger must start from a balance the
 * ledger can actually explain.
 */
async function seedFundedUser(id: string, balanceKobo: number) {
  seedUser(id, 0);
  await postEntry({
    userId: id,
    type: 'BONUS',
    amountKobo: balanceKobo,
    description: 'Opening balance',
    idempotencyKey: `opening__${id}`,
  });
}

const GTB = '058';

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  settings = freshSettings();
  setProvider(new MockProvider());
});

describe('withdrawal requests', () => {
  it('debits the balance immediately, as a real pending ledger entry', async () => {
    seedUser('200', 500_000);

    const withdrawal = await requestWithdrawal({
      user: user('200'), amountKobo: 200_000,
      bankCode: GTB, accountNumber: '0123456789', accountName: 'Gift Update',
    });

    expect(withdrawal.status).toBe('PENDING');
    expect(withdrawal.bank.bankName).toBe('Guaranty Trust Bank');

    const snapshot = store.snapshot();
    // The money is gone from the spendable balance right away.
    expect(snapshot['users/200']?.balanceKobo).toBe(300_000);
    expect(snapshot['users/200']?.pendingOutKobo).toBe(200_000);

    const transaction = snapshot[`transactions/${withdrawal.transactionId}`];
    expect(transaction?.type).toBe('CASH_WITHDRAWAL');
    expect(transaction?.amountKobo).toBe(-200_000);
    expect(transaction?.status).toBe('PENDING');
  });

  it('refuses a withdrawal larger than the balance, writing nothing', async () => {
    seedUser('200', 50_000);

    await expect(
      requestWithdrawal({
        user: user('200'), amountKobo: 200_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'Gift Update',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(50_000);
    expect(store.countIn('withdrawals')).toBe(0);
    expect(store.countIn('transactions')).toBe(0);
  });

  it('cannot be double-spent by two concurrent requests for the whole balance', async () => {
    seedUser('200', 200_000);

    const results = await Promise.allSettled([
      requestWithdrawal({
        user: user('200'), amountKobo: 200_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'Gift Update',
      }),
      requestWithdrawal({
        user: user('200'), amountKobo: 200_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'Gift Update',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(0);
    expect(store.countIn('withdrawals')).toBe(1);
  });

  it('enforces the minimum, the maximum and the daily limit', async () => {
    seedUser('200', 50_000_000);

    await expect(
      requestWithdrawal({
        user: user('200'), amountKobo: 20_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'A B',
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    settings.withdrawals.maxAmountKobo = 100_000;
    await expect(
      requestWithdrawal({
        user: user('200'), amountKobo: 200_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'A B',
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    settings.withdrawals.maxAmountKobo = 20_000_000;
    settings.withdrawals.dailyLimitKobo = 150_000;
    await requestWithdrawal({
      user: user('200'), amountKobo: 100_000,
      bankCode: GTB, accountNumber: '0123456789', accountName: 'A B',
    });
    await expect(
      requestWithdrawal({
        user: user('200'), amountKobo: 100_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'A B',
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('is refused entirely while the withdrawal portal is closed', async () => {
    seedUser('200', 500_000);
    settings.withdrawals.enabled = false;

    await expect(
      requestWithdrawal({
        user: user('200'), amountKobo: 100_000,
        bankCode: GTB, accountNumber: '0123456789', accountName: 'A B',
      }),
    ).rejects.toMatchObject({ code: 'WITHDRAWALS_CLOSED' });

    expect(store.countIn('withdrawals')).toBe(0);
  });

  it('rejects an unsupported bank code', async () => {
    seedUser('200', 500_000);
    await expect(
      requestWithdrawal({
        user: user('200'), amountKobo: 100_000,
        bankCode: '99999', accountNumber: '0123456789', accountName: 'A B',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('withdrawal settlement', () => {
  async function pending(balance = 500_000, amount = 200_000) {
    // Ledger-backed, so the audit assertions below are meaningful.
    await seedFundedUser('200', balance);
    return requestWithdrawal({
      user: user('200'), amountKobo: amount,
      bankCode: GTB, accountNumber: '0123456789', accountName: 'Gift Update',
    });
  }

  it('completing a payout keeps the money out and records the bank reference', async () => {
    const withdrawal = await pending();

    await transitionWithdrawal({
      withdrawalId: withdrawal.id, status: 'COMPLETED',
      actorAdminId: '6438544386', providerReference: 'NIBSS-889912',
    });

    const snapshot = store.snapshot();
    expect(snapshot[`withdrawals/${withdrawal.id}`]?.status).toBe('COMPLETED');
    expect(snapshot[`withdrawals/${withdrawal.id}`]?.providerReference).toBe('NIBSS-889912');
    expect(snapshot['users/200']?.balanceKobo).toBe(300_000);
    expect(snapshot['users/200']?.pendingOutKobo).toBe(0);
    expect(snapshot[`transactions/${withdrawal.transactionId}`]?.status).toBe('COMPLETED');
  });

  it('a failed payout gives the money back with a compensating entry', async () => {
    const withdrawal = await pending();

    await transitionWithdrawal({
      withdrawalId: withdrawal.id, status: 'FAILED',
      actorAdminId: '6438544386', reason: 'Bank rejected the account number',
    });

    const snapshot = store.snapshot();
    expect(snapshot['users/200']?.balanceKobo).toBe(500_000);
    expect(snapshot['users/200']?.pendingOutKobo).toBe(0);

    const reversalId = snapshot[`withdrawals/${withdrawal.id}`]?.reversalTransactionId as string;
    expect(reversalId).toBeTruthy();
    expect(snapshot[`transactions/${reversalId}`]?.type).toBe('REVERSAL');
    expect(snapshot[`transactions/${reversalId}`]?.amountKobo).toBe(200_000);

    // Both halves of the story remain on the ledger.
    const audit = await auditUserBalance('200');
    expect(audit.matches).toBe(true);
    expect(audit.ledgerKobo).toBe(500_000);
  });

  it('a rejected payout also restores the balance', async () => {
    const withdrawal = await pending();
    await transitionWithdrawal({
      withdrawalId: withdrawal.id, status: 'REJECTED',
      actorAdminId: '6438544386', reason: 'Account name does not match',
    });
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(500_000);
  });

  it('refuses an illegal transition, so a completed payout cannot be paid twice', async () => {
    const withdrawal = await pending();
    await transitionWithdrawal({
      withdrawalId: withdrawal.id, status: 'COMPLETED', actorAdminId: '6438544386',
    });

    await expect(
      transitionWithdrawal({
        withdrawalId: withdrawal.id, status: 'PENDING', actorAdminId: '6438544386',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      transitionWithdrawal({
        withdrawalId: withdrawal.id, status: 'FAILED',
        actorAdminId: '6438544386', reason: 'retry',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(300_000);
  });

  it('lets a user cancel their own pending request and get the money back', async () => {
    const withdrawal = await pending();
    await cancelWithdrawal('200', withdrawal.id);

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(500_000);
    expect(store.snapshot()[`withdrawals/${withdrawal.id}`]?.status).toBe('CANCELLED');
  });

  it("will not let one user cancel another user's withdrawal", async () => {
    const withdrawal = await pending();
    seedUser('999', 0);
    await expect(cancelWithdrawal('999', withdrawal.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(300_000);
  });
});

describe('reward redemption', () => {
  it('debits the balance and completes when the provider delivers', async () => {
    seedUser('200', 500_000);

    const outcome = await redeem({
      user: user('200'), kind: 'AIRTIME', target: '08031234567',
      network: 'MTN', amountKobo: 100_000,
    });

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.amountKobo).toBe(100_000);

    const snapshot = store.snapshot();
    expect(snapshot['users/200']?.balanceKobo).toBe(400_000);
    expect(snapshot[`redemptions/${outcome.redemptionId}`]?.status).toBe('COMPLETED');
    expect(snapshot[`redemptions/${outcome.redemptionId}`]?.providerReference).toMatch(/^MOCK-/);
    expect(snapshot[`transactions/${snapshot[`redemptions/${outcome.redemptionId}`]?.transactionId as string}`]?.status).toBe('COMPLETED');
  });

  it('restores the balance in full when the provider fails', async () => {
    await seedFundedUser('200', 500_000);

    // The mock fails for any target containing "fail".
    await expect(
      redeem({
        user: user('200'), kind: 'AIRTIME', target: '0803fail567',
        network: 'MTN', amountKobo: 100_000,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });

    const snapshot = store.snapshot();
    expect(snapshot['users/200']?.balanceKobo).toBe(500_000);

    const audit = await auditUserBalance('200');
    expect(audit.matches).toBe(true);
    expect(audit.ledgerKobo).toBe(500_000);

    const redemption = Object.entries(snapshot).find(([path]) => path.startsWith('redemptions/'));
    expect(redemption?.[1]?.status).toBe('FAILED');
    expect(redemption?.[1]?.reversalTransactionId).toBeTruthy();

    // The redemption failed, but the debit genuinely moved money and was
    // genuinely undone: its ledger status is REVERSED, not FAILED, so the
    // audit above can still reconcile.
    const debitId = redemption?.[1]?.transactionId as string;
    expect(snapshot[`transactions/${debitId}`]?.status).toBe('REVERSED');
    expect(snapshot[`transactions/${debitId}`]?.amountKobo).toBe(-100_000);
  });

  it('leaves an uncertain outcome pending rather than reversing it', async () => {
    seedUser('200', 500_000);

    const outcome = await redeem({
      user: user('200'), kind: 'AIRTIME', target: '0803pending7',
      network: 'MTN', amountKobo: 100_000,
    });

    expect(outcome.status).toBe('PROCESSING');
    // The money stays debited: reversing an unknown outcome would give the
    // user both a refund and the airtime.
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(400_000);
    expect(store.snapshot()[`redemptions/${outcome.redemptionId}`]?.status).toBe('PROCESSING');
  });

  it('refuses when the balance cannot cover the reward, and never calls the provider', async () => {
    seedUser('200', 5_000);
    await expect(
      redeem({
        user: user('200'), kind: 'AIRTIME', target: '08031234567',
        network: 'MTN', amountKobo: 100_000,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(store.countIn('redemptions')).toBe(0);
  });

  it('enforces the minimum airtime amount', async () => {
    seedUser('200', 500_000);
    await expect(
      redeem({
        user: user('200'), kind: 'AIRTIME', target: '08031234567',
        network: 'MTN', amountKobo: 5_000,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('uses the catalogue price, ignoring any amount the client sends', async () => {
    seedUser('200', 5_000_000);
    await seedRewardCatalogue();
    // Stars are seeded unavailable; an admin turns them on once a provider exists.
    store.commit([
      { kind: 'update', path: 'rewardProducts/stars-100', data: { available: true } },
    ]);

    const outcome = await redeem({
      user: user('200'), kind: 'TELEGRAM_STARS', productId: 'stars-100',
      target: 'giftvisuals',
      // A client trying to pay ₦1 for a ₦2,400 bundle.
      amountKobo: 100,
    });

    expect(outcome.amountKobo).toBe(240_000);
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(4_760_000);
  });

  it('refuses a reward the catalogue marks unavailable', async () => {
    seedUser('200', 5_000_000);
    await seedRewardCatalogue();

    await expect(
      redeem({
        user: user('200'), kind: 'TELEGRAM_STARS', productId: 'stars-100',
        target: 'giftvisuals',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(5_000_000);
  });

  it('refuses when the reward kind is switched off in settings', async () => {
    seedUser('200', 500_000);
    settings.rewards.airtimeEnabled = false;

    await expect(
      redeem({
        user: user('200'), kind: 'AIRTIME', target: '08031234567',
        network: 'MTN', amountKobo: 100_000,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(store.countIn('redemptions')).toBe(0);
  });
});

describe('provider abstraction', () => {
  it('the default provider refuses every redemption without debiting anyone', async () => {
    seedUser('200', 500_000);
    setProvider(new NoneProvider());

    await expect(
      redeem({
        user: user('200'), kind: 'AIRTIME', target: '08031234567',
        network: 'MTN', amountKobo: 100_000,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(500_000);
    expect(store.countIn('redemptions')).toBe(0);
  });

  it('the NasfamPay provider reports itself unimplemented rather than guessing at their API', async () => {
    seedUser('200', 500_000);
    const nasfampay = new NasfamPayProvider();
    setProvider(nasfampay);

    expect(nasfampay.configured).toBe(false);
    expect(nasfampay.unavailableReason('AIRTIME')).toContain('Coming soon');
    expect(nasfampay.capabilities()).toEqual({
      airtime: false, data: false, telegramStars: false,
      telegramPremium: false, statusLookup: false,
    });

    await expect(
      redeem({
        user: user('200'), kind: 'AIRTIME', target: '08031234567',
        network: 'MTN', amountKobo: 100_000,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(500_000);
  });

  it('honours the idempotency key, so a provider retry cannot deliver twice', async () => {
    const provider = new MockProvider();
    const request = {
      idempotencyKey: 'redemption__rd_1',
      kind: 'AIRTIME' as const,
      amountKobo: 100_000,
      target: '08031234567',
      network: 'MTN' as const,
      productCode: null,
      quantity: null,
      reference: 'rd_1',
    };

    const first = await provider.fulfil(request);
    const second = await provider.fulfil(request);
    expect(second).toEqual(first);
    expect(second.providerReference).toBe(first.providerReference);
  });
});
