import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from './fake-firestore';

/**
 * The owner's daily brief, and the stale-work alert.
 *
 * Once payouts are delegated, the owner's risk stops being a bug and becomes
 * not knowing: that the queue has not been touched in days, that yesterday's
 * payouts were four times normal, that the float is smaller than what is owed.
 *
 * Two properties matter more than the wording, and both are tested here: it
 * must not send twice in a day — a brief that arrives five times on a
 * deployment day gets muted, and a muted brief is worse than none — and the
 * stale alert must stay silent on a good day, or it teaches the owner to
 * ignore it on a bad one.
 */

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-32';
process.env.TELEGRAM_BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';
process.env.TELEGRAM_BOT_USERNAME = 'fundxtrabot';
process.env.PRIMARY_ADMIN_TELEGRAM_ID = '6438544386';
process.env.FIREBASE_CLIENT_EMAIL = 'test@fundxtra.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

const sent: { chatId: string; text: string }[] = [];

vi.mock('../src/lib/telegram-bot', () => ({
  sendBotMessage: async (chatId: string | number, text: string) => {
    sent.push({ chatId: String(chatId), text });
    return true;
  },
  checkChatMembership: async () => ({ state: 'JOINED', status: 'member' }),
  probeChatAccess: async () => ({ ok: true, title: 'Channel', warning: null }),
  notifyUser: async () => true,
  getBotIdentity: async () => null,
}));

const { buildOwnerBrief, formatOwnerBrief, sendOwnerBriefIfDue, sendStaleWorkAlertIfNeeded } =
  await import('../src/services/briefing');

const HOURS = 3_600_000;

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  sent.length = 0;
});

function seedSubmission(id: string, agoHours: number) {
  store.seed('taskSubmissions', id, {
    userId: 'u1', taskId: 't1', status: 'PENDING_REVIEW',
    proofPath: 'https://i.ibb.co/a/b.png', answer: null, rejectionReason: null,
    createdAt: Timestamp.fromMillis(Date.now() - agoHours * HOURS),
  });
}

function seedWithdrawal(
  id: string,
  options: { status: string; amountKobo: number; agoHours: number },
) {
  const at = Timestamp.fromMillis(Date.now() - options.agoHours * HOURS);
  store.seed('withdrawals', id, {
    userId: 'u1', amountKobo: options.amountKobo, feeKobo: 0, netKobo: options.amountKobo,
    status: options.status,
    bank: { bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Gift' },
    requestedAt: at, reviewedAt: at, transactionId: `txn-${id}`,
  });
}

function seedUser(id: string, balanceKobo: number) {
  store.seed('users', id, {
    telegramId: id, firstName: 'Gift', username: `u${id}`, status: 'ACTIVE',
    hasPin: true, balanceKobo, lifetimeEarnedKobo: balanceKobo, lifetimePaidOutKobo: 0,
    pendingOutKobo: 0, tasksCompleted: 0, referralCode: `C${id}`, referredBy: null,
    referralCount: 0, qualifiedReferralCount: 0, referralEarningsKobo: 0, riskScore: 0,
    flags: [], createdAt: Timestamp.fromMillis(Date.now() - 7 * 24 * HOURS),
  });
}

describe('what the brief says', () => {
  it('counts what is waiting, and what went out', async () => {
    seedSubmission('s1', 2);
    seedSubmission('s2', 5);
    seedWithdrawal('w-pending', { status: 'PENDING', amountKobo: 40_000, agoHours: 3 });
    // Paid a couple of hours ago is today; 30 hours ago is yesterday.
    seedWithdrawal('w-today', { status: 'COMPLETED', amountKobo: 25_000, agoHours: 1 });
    seedWithdrawal('w-yesterday', { status: 'COMPLETED', amountKobo: 60_000, agoHours: 30 });
    seedUser('u1', 150_000);

    const brief = await buildOwnerBrief();

    expect(brief.pendingSubmissions).toBe(2);
    expect(brief.pendingWithdrawalCount).toBe(1);
    expect(brief.pendingWithdrawalsKobo).toBe(40_000);
    expect(brief.paidTodayKobo).toBe(25_000);
    expect(brief.owedToUsersKobo).toBe(150_000);
  });

  it('leads with whether anything needs a person', async () => {
    seedUser('u1', 0);
    const quiet = formatOwnerBrief(await buildOwnerBrief());
    expect(quiet.startsWith('✅')).toBe(true);

    seedSubmission('s1', 1);
    const busy = formatOwnerBrief(await buildOwnerBrief());
    expect(busy.startsWith('🔔')).toBe(true);
    expect(busy).toContain('1 waiting');
  });

  it('mentions an old submission only when it is actually old', async () => {
    seedUser('u1', 0);
    seedSubmission('fresh', 2);
    expect(formatOwnerBrief(await buildOwnerBrief())).not.toContain('oldest has waited');

    seedSubmission('stale', 40);
    expect(formatOwnerBrief(await buildOwnerBrief())).toContain('oldest has waited');
  });
});

describe('sending the brief', () => {
  it('sends it to the owner, once', async () => {
    seedUser('u1', 1_000);

    const morning = new Date();
    morning.setUTCHours(9, 0, 0, 0);

    expect(await sendOwnerBriefIfDue(morning)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe('6438544386');

    // A redeploy restarts the process and the timer with it. The record of
    // having sent lives in the database precisely so that does not resend.
    expect(await sendOwnerBriefIfDue(morning)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('waits until the morning', async () => {
    seedUser('u1', 1_000);

    const middleOfTheNight = new Date();
    middleOfTheNight.setUTCHours(1, 0, 0, 0);

    expect(await sendOwnerBriefIfDue(middleOfTheNight)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('the stale work alert', () => {
  it('stays quiet when the queue is being worked', async () => {
    seedSubmission('s1', 3);
    seedWithdrawal('w1', { status: 'PENDING', amountKobo: 40_000, agoHours: 6 });

    expect(await sendStaleWorkAlertIfNeeded()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('speaks up when a screenshot has been abandoned', async () => {
    seedSubmission('s1', 40);

    expect(await sendStaleWorkAlertIfNeeded()).toBe(true);
    expect(sent[0]?.text).toContain('40 hours');
    expect(sent[0]?.text).toContain('screenshot');
  });

  it('speaks up when a withdrawal has not been paid', async () => {
    seedWithdrawal('w1', { status: 'PENDING', amountKobo: 40_000, agoHours: 60 });

    expect(await sendStaleWorkAlertIfNeeded()).toBe(true);
    expect(sent[0]?.text).toContain('withdrawal');
  });

  it('does not nag more than once a day', async () => {
    seedSubmission('s1', 40);

    expect(await sendStaleWorkAlertIfNeeded()).toBe(true);
    expect(await sendStaleWorkAlertIfNeeded()).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
