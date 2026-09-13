import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from './fake-firestore';

/**
 * Notifications about money.
 *
 * Two properties are load-bearing.
 *
 * The first is that a notification can never break the thing it describes. The
 * money has already committed by the time a message is sent, so a Telegram
 * outage, a blocked bot or a rate limit must be invisible to the operation.
 *
 * The second is the copy. A notification is the easiest place to accidentally
 * promise an income, and "no unrealistic income promises" is a platform rule,
 * not a preference.
 */

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

vi.mock('../src/services/settings', () => ({
  getSettings: async () => ({
    referrals: { enabled: true, rewardKobo: 10_000 },
    platform: { botUsername: 'fundxtrabot', supportHandle: '@fundxtracarebot' },
    withdrawals: { enabled: true, minAmountKobo: 30_000, maxAmountKobo: 20_000_000, dailyLimitKobo: 20_000_000, feeKobo: 0, requireManualApproval: true },
    rewards: {}, tasks: { maxRewardKobo: 100_000, earningEnabled: true },
  }),
  withdrawalAvailability: () => ({ open: true, reason: null, opensAt: null }),
}));

/** Captures what would be sent, and can be made to fail on demand. */
const sent: Array<{ chatId: string | number; text: string; markup?: unknown }> = [];
let sendShouldFail = false;
/** Throws before returning a promise, the way an unconfigured client does. */
let sendShouldThrowSync = false;

vi.mock('../src/lib/telegram-bot', () => ({
  sendBotMessage: (chatId: string | number, text: string, markup?: unknown) => {
    if (sendShouldThrowSync) throw new Error('client is not configured');
    if (sendShouldFail) return Promise.reject(new Error('403: bot was blocked by the user'));
    sent.push({ chatId, text, markup });
    return Promise.resolve(true);
  },
  notifyUser: async () => true,
  checkChatMembership: async () => ({ state: 'JOINED', status: 'member' }),
  probeChatAccess: async () => ({ ok: true, title: 'Fundxtra', warning: null }),
  getBotIdentity: async () => null,
}));

const notify = await import('../src/services/notify');

beforeEach(() => {
  sent.length = 0;
  sendShouldFail = false;
  sendShouldThrowSync = false;
});

/** Lets the fire-and-forget send settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('an admin crediting a balance', () => {
  it('tells the user the amount, the new balance and the reason', async () => {
    notify.notifyBalanceAdjusted({
      telegramId: '555001',
      firstName: 'Gift',
      amountKobo: 50_000,
      balanceAfterKobo: 125_000,
      reason: 'Goodwill for the delayed task review',
    });
    await flush();

    expect(sent).toHaveLength(1);
    const text = sent[0]?.text ?? '';
    expect(text).toContain('₦500');
    expect(text).toContain('Gift');
    expect(text).toContain('₦1,250');
    expect(text).toContain('Goodwill for the delayed task review');
    // A button, so the balance is one tap away rather than a hunt.
    expect(JSON.stringify(sent[0]?.markup)).toContain('web_app');
  });

  it('states a debit plainly rather than burying it', async () => {
    notify.notifyBalanceAdjusted({
      telegramId: '555001',
      firstName: 'Gift',
      amountKobo: -20_000,
      balanceAfterKobo: 5_000,
      reason: 'Duplicate credit corrected',
    });
    await flush();

    const text = sent[0]?.text ?? '';
    expect(text).toContain('removed from your balance');
    expect(text).toContain('₦200');
    expect(text).toContain('Duplicate credit corrected');
    // Someone who finds money missing and was not told assumes the worst.
    expect(text.toLowerCase()).toContain('support');
  });
});

describe('the other money events', () => {
  it('names the reward and the balance when a task is approved', async () => {
    notify.notifyTaskApproved({
      telegramId: '555001',
      taskTitle: 'Join the Fundxtra channel',
      rewardKobo: 5_000,
      balanceAfterKobo: 30_000,
    });
    await flush();

    expect(sent[0]?.text).toContain('Join the Fundxtra channel');
    expect(sent[0]?.text).toContain('₦50');
    expect(sent[0]?.text).toContain('₦300');
  });

  it('says nothing was deducted when a task is rejected', async () => {
    notify.notifyTaskRejected({
      telegramId: '555001',
      taskTitle: 'Follow on X',
      reason: 'The screenshot showed a different account',
    });
    await flush();

    expect(sent[0]?.text).toContain('The screenshot showed a different account');
    expect(sent[0]?.text).toContain('Nothing was deducted');
  });

  it('tells the referrer their friend completed onboarding', async () => {
    notify.notifyReferralQualified({
      telegramId: '555001',
      rewardKobo: 10_000,
      balanceAfterKobo: 40_000,
      qualifiedCount: 3,
    });
    await flush();

    expect(sent[0]?.text).toContain('₦100');
    expect(sent[0]?.text).toContain('3');
  });

  it('masks the account number when a payout is sent', async () => {
    notify.notifyWithdrawalPaid({
      telegramId: '555001',
      netKobo: 250_000,
      bankName: 'Kuda Microfinance Bank',
      accountNumber: '2094417803',
      reference: 'WD-77',
    });
    await flush();

    const text = sent[0]?.text ?? '';
    expect(text).toContain('Kuda Microfinance Bank');
    expect(text).toContain('7803');
    // A notification can sit in a chat someone else sees.
    expect(text).not.toContain('2094417803');
  });

  it('answers "is my money gone" first when a payout is returned', async () => {
    notify.notifyWithdrawalReturned({
      telegramId: '555001',
      amountKobo: 250_000,
      balanceAfterKobo: 300_000,
      reason: 'Account name did not match',
    });
    await flush();

    const text = sent[0]?.text ?? '';
    expect(text).toContain('back in your balance');
    expect(text).toContain('Nothing was lost');
    expect(text).toContain('₦3,000');
  });
});

describe('delivery failure', () => {
  it('survives a client that throws synchronously, not just a rejection', async () => {
    /*
      The first version of `send` guarded only the promise rejection. A
      synchronous throw — an unconfigured client, a bad argument — escaped it
      and propagated into the caller, which is the transaction that had just
      moved someone's money. Two task tests failed on exactly that, which is
      how the hole was found.
    */
    sendShouldThrowSync = true;

    expect(() => {
      notify.notifyTaskApproved({
        telegramId: '555001',
        taskTitle: 'Join the channel',
        rewardKobo: 5_000,
        balanceAfterKobo: 5_000,
      });
    }).not.toThrow();

    await flush();
    expect(sent).toHaveLength(0);
  });

  it('never throws, so the money operation cannot be broken by Telegram', async () => {
    sendShouldFail = true;

    // A user who blocked the bot is the common case, and their reward must
    // still be credited.
    expect(() => {
      notify.notifyBalanceAdjusted({
        telegramId: '555001',
        firstName: 'Gift',
        amountKobo: 50_000,
        balanceAfterKobo: 125_000,
        reason: 'Test',
      });
    }).not.toThrow();

    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe('the copy rules', () => {
  it('promises no income, anywhere', async () => {
    notify.notifyBalanceAdjusted({ telegramId: '1', firstName: 'A', amountKobo: 50_000, balanceAfterKobo: 1, reason: 'r' });
    notify.notifyTaskApproved({ telegramId: '1', taskTitle: 't', rewardKobo: 1, balanceAfterKobo: 1 });
    notify.notifyTaskRejected({ telegramId: '1', taskTitle: 't', reason: 'r' });
    notify.notifyReferralQualified({ telegramId: '1', rewardKobo: 1, balanceAfterKobo: 1, qualifiedCount: 1 });
    notify.notifyWithdrawalPaid({ telegramId: '1', netKobo: 1, bankName: 'b', accountNumber: '1234567890', reference: 'r' });
    notify.notifyWithdrawalReturned({ telegramId: '1', amountKobo: 1, balanceAfterKobo: 1, reason: 'r' });
    await flush();

    expect(sent).toHaveLength(6);
    for (const message of sent) {
      const text = message.text.toLowerCase();
      for (const phrase of [
        'guarantee', 'guaranteed', 'per day', 'daily income', 'monthly income',
        'earn up to', 'get rich', 'risk-free', 'passive income',
      ]) {
        expect(text).not.toContain(phrase);
      }
    }
  });
});
