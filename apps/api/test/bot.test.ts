import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { FakeFirestore } from './fake-firestore';

/**
 * The Telegram webhook and the bot's replies.
 *
 * This endpoint is reachable by anyone who learns the URL and its only
 * authentication is the secret header Telegram echoes back, so the rejection
 * cases matter as much as the happy path — a forged `/start` carries a
 * referral code.
 */

const SESSION_SECRET = 'test-session-secret-that-is-long-enough-32';
const BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_BOT_USERNAME = 'fundxtrabot';
process.env.PUBLIC_WEB_URL = 'https://fundxtra.vercel.app';
delete process.env.TELEGRAM_WEBHOOK_SECRET;

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

/** Captures what the bot would send, instead of calling Telegram. */
const sent: Array<{ chatId: string | number; text: string; markup?: unknown }> = [];

vi.mock('../src/lib/telegram-bot', () => ({
  sendBotMessage: async (chatId: string | number, text: string, markup?: unknown) => {
    sent.push({ chatId, text, markup });
    return true;
  },
  checkChatMembership: async () => ({ state: 'JOINED', status: 'member' }),
  probeChatAccess: async () => ({ ok: true, title: 'Fundxtra', warning: null }),
  notifyUser: async () => true,
  getBotIdentity: async () => ({ id: 7_000_000_000, username: 'fundxtrabot' }),
  getWebhookInfo: async () => null,
  setMyCommands: async () => true,
  setChatMenuButton: async () => true,
  setWebhook: async () => true,
  answerCallbackQuery: async (id: string, text?: string) => {
    answered.push({ id, text });
    return true;
  },
  editPhotoCaption: async (options: { caption: string }) => {
    captions.push(options.caption);
    return true;
  },
  sendBotPhoto: async () => ({ message_id: 1 }),
}));

/** Button taps the bot answered, and the captions it rewrote afterwards. */
const answered: { id: string; text?: string }[] = [];
const captions: string[] = [];

/** Decisions the review service was asked to apply. */
const decided: { submissionId: string; decision: string; reviewerId: string }[] = [];

vi.mock('../src/services/completions', () => ({
  reviewSubmission: async (input: { submissionId: string; decision: string; reviewerId: string }) => {
    decided.push(input);
    return { status: 'APPROVED', rewardKobo: 4_000, transactionId: 't1', telegramId: '1', taskTitle: 'Follow Crediplex on X', reason: '', balanceAfterKobo: 4_000 };
  },
}));

const { createApp } = await import('../src/app');
const app = createApp();

/** The secret the route expects, derived exactly as the server derives it. */
const SECRET = createHmac('sha256', SESSION_SECRET).update('telegram-webhook').digest('hex');

function startUpdate(text: string, chatId = 991_001) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: { id: chatId, first_name: 'Ada', username: 'ada' },
      chat: { id: chatId, type: 'private' },
      text,
    },
  };
}

function post(update: unknown, secret: string | null = SECRET) {
  const req = request(app).post('/telegram/webhook');
  if (secret !== null) req.set('x-telegram-bot-api-secret-token', secret);
  return req.send(update as object);
}

beforeEach(() => {
  sent.length = 0;
});

describe('webhook authentication', () => {
  it('rejects an update with no secret header', async () => {
    const response = await post(startUpdate('/start'), null);

    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('rejects an update with the wrong secret', async () => {
    const response = await post(startUpdate('/start'), 'a'.repeat(SECRET.length));

    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('rejects a secret of a different length rather than throwing', async () => {
    // timingSafeEqual throws on mismatched lengths; the route must not 500.
    const response = await post(startUpdate('/start'), 'short');

    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('accepts an update carrying the derived secret', async () => {
    const response = await post(startUpdate('/start'));

    expect(response.status).toBe(200);
  });
});

describe('/start', () => {
  it('replies with a Mini App button', async () => {
    await post(startUpdate('/start'));

    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message?.text).toContain('Fundxtra');
    expect(message?.text).toContain('Complete tasks. Earn rewards. Refer friends.');
    expect(JSON.stringify(message?.markup)).toContain('https://fundxtra.vercel.app/app');
  });

  it('greets the user by the name Telegram supplied', async () => {
    await post(startUpdate('/start'));

    expect(sent[0]?.text).toContain('Ada');
  });

  it('carries a referral code through to the Mini App URL', async () => {
    await post(startUpdate('/start ABCD2345'));

    expect(JSON.stringify(sent[0]?.markup)).toContain('/app?ref=ABCD2345');
    expect(sent[0]?.text).toContain('invited by a friend');
  });

  it('ignores a start payload that is not a plausible code', async () => {
    await post(startUpdate('/start <script>alert(1)</script>'));

    const markup = JSON.stringify(sent[0]?.markup);
    expect(markup).not.toContain('script');
    expect(markup).toContain('https://fundxtra.vercel.app/app');
  });

  it('handles the /start@botname form Telegram allows', async () => {
    await post(startUpdate('/start@fundxtrabot ABCD2345'));

    expect(JSON.stringify(sent[0]?.markup)).toContain('ref=ABCD2345');
  });

  it('promises no specific or guaranteed income', async () => {
    await post(startUpdate('/start'));

    const text = (sent[0]?.text ?? '').toLowerCase();
    for (const phrase of ['guarantee', 'per day', 'daily income', 'monthly income', 'get rich']) {
      expect(text).not.toContain(phrase);
    }
  });
});

describe('other commands', () => {
  it('explains how PIN recovery works on /help', async () => {
    await post(startUpdate('/help'));

    expect(sent[0]?.text).toContain('Forgot your PIN?');
    expect(sent[0]?.text).toContain('@fundxtracarebot');
  });

  it('states on /help that rewards are not a fixed amount', async () => {
    await post(startUpdate('/help'));

    expect(sent[0]?.text).toContain('no fixed or guaranteed amount');
  });

  it('points /support at the support account', async () => {
    await post(startUpdate('/support'));

    expect(sent[0]?.text).toContain('@fundxtracarebot');
    expect(JSON.stringify(sent[0]?.markup)).toContain('t.me/fundxtracarebot');
  });

  it('nudges free text back to the app instead of staying silent', async () => {
    await post(startUpdate('hello?'));

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0]?.markup)).toContain('/app');
  });
});

describe('updates the bot must not answer', () => {
  it('ignores another bot', async () => {
    await post({
      message: {
        from: { id: 1, first_name: 'Other', is_bot: true },
        chat: { id: 1, type: 'private' },
        text: '/start',
      },
    });

    expect(sent).toHaveLength(0);
  });

  it('stays quiet in a group chat', async () => {
    await post({
      message: {
        from: { id: 1, first_name: 'Ada' },
        chat: { id: -100, type: 'supergroup' },
        text: '/start',
      },
    });

    expect(sent).toHaveLength(0);
  });

  it('ignores an update with no message, without failing', async () => {
    const response = await post({ update_id: 5 });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('ignores a message with no text, such as a photo', async () => {
    await post({
      message: { from: { id: 1, first_name: 'Ada' }, chat: { id: 1, type: 'private' } },
    });

    expect(sent).toHaveLength(0);
  });
});

/**
 * Approving a screenshot by tapping a button in Telegram.
 *
 * This is how the owner clears the uncertain pile without opening a page that
 * loads hundreds of rows: the work arrives in their chat and a decision costs
 * one tap. Which makes it a button that moves money, so who may press it is
 * the part worth testing.
 */
describe('review buttons in Telegram', () => {
  function tap(data: string, fromId: number) {
    return {
      update_id: Math.floor(Math.random() * 1_000_000),
      callback_query: {
        id: `cb-${String(Math.random())}`,
        from: { id: fromId, is_bot: false },
        data,
        message: { message_id: 55, chat: { id: fromId } },
      },
    };
  }

  beforeEach(() => {
    answered.length = 0;
    captions.length = 0;
    decided.length = 0;
  });

  it('approves when the owner taps approve', async () => {
    const response = await request(app)
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', SECRET)
      .send(tap('rev:a:sub-1', 6_438_544_386));

    expect(response.status).toBe(200);
    expect(decided).toEqual([
      { submissionId: 'sub-1', decision: 'APPROVE', reviewerId: '6438544386', reason: undefined },
    ]);
    // The buttons are taken away, so the same one cannot be tapped twice.
    expect(captions[0]).toContain('Approved');
  });

  it('rejects when the owner taps reject', async () => {
    await request(app)
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', SECRET)
      .send(tap('rev:r:sub-2', 6_438_544_386));

    expect(decided[0]?.decision).toBe('REJECT');
    expect(captions[0]).toContain('nothing was deducted');
  });

  it('refuses anyone who is not the owner', async () => {
    await request(app)
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', SECRET)
      .send(tap('rev:a:sub-3', 999_111_222));

    // The callback arrives over the authenticated webhook, but the id inside
    // it decides nothing on its own: this button pays people.
    expect(decided).toHaveLength(0);
    expect(answered[0]?.text).toContain('not yours');
  });

  it('ignores callback data that is not a review decision', async () => {
    await request(app)
      .post('/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', SECRET)
      .send(tap('something:else:entirely', 6_438_544_386));

    expect(decided).toHaveLength(0);
  });
});
