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
