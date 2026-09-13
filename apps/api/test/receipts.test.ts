import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FakeFirestore } from './fake-firestore';

/**
 * Delivering a receipt through the bot.
 *
 * Telegram's in-app browser cannot save a file, so the Mini App has no way to
 * hand a user their own receipt. The bot posts it into their chat instead —
 * which means image bytes now arrive from a client, and these tests pin down
 * the two rules that makes safe: it can only ever be delivered to the
 * requester's own chat, and the caption under it is written from the stored
 * transaction rather than echoed from the request.
 */

const BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-32';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_BOT_USERNAME = 'fundxtrabot';
process.env.FIREBASE_CLIENT_EMAIL = 'test@fundxtra.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

interface SentPhoto {
  chatId: string;
  bytes: Buffer;
  filename: string;
  caption: string;
}

const sent: SentPhoto[] = [];
let photoFailure: Error | null = null;

vi.mock('../src/lib/telegram-bot', async () => {
  // The error class is real: the service branches on it, so a stand-in would
  // test the stand-in rather than the branch.
  const actual =
    await vi.importActual<typeof import('../src/lib/telegram-bot')>('../src/lib/telegram-bot');
  return {
    TelegramApiError: actual.TelegramApiError,
    checkChatMembership: async () => ({ state: 'JOINED', status: 'member' }),
    probeChatAccess: async () => ({ ok: true, title: 'Channel', warning: null }),
    notifyUser: async () => true,
    getBotIdentity: async () => null,
    sendBotMessage: async () => true,
    sendBotPhoto: async (options: SentPhoto) => {
      if (photoFailure) throw photoFailure;
      sent.push(options);
      return { message_id: 1 };
    },
  };
});

const { createApp } = await import('../src/app');
const { signInitData } = await import('../src/lib/telegram-auth');
const { postEntry } = await import('../src/services/ledger');
const { TelegramApiError } = await import('../src/lib/telegram-bot');

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  sent.length = 0;
  photoFailure = null;
});

async function signIn(telegramId: number) {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: telegramId, first_name: 'Gift' }),
    },
    BOT_TOKEN,
  );
  const response = await request(app).post('/auth/telegram').send({ initData });
  expect(response.status).toBe(200);
  return response.body.data as { token: string; user: { id: string } };
}

/** A real PNG header, which is all the signature check looks at. */
function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);
}

async function seedTransaction(userId: string, amountKobo = 50_000) {
  const entry = await postEntry({
    userId,
    type: 'BONUS',
    amountKobo,
    description: 'Fundxtra team topped you up',
    idempotencyKey: `seed__${userId}__${String(amountKobo)}`,
  });
  return entry.transaction.id;
}

function send(token: string, transactionId: string, bytes: Buffer, filename = 'receipt.png') {
  return request(app)
    .post(`/wallet/transactions/${transactionId}/send-to-telegram`)
    .set('authorization', `Bearer ${token}`)
    .attach('receipt', bytes, { filename, contentType: 'image/png' });
}

describe('sending a receipt to Telegram', () => {
  it('delivers it to the requester’s own chat', async () => {
    const auth = await signIn(770001);
    const transactionId = await seedTransaction(auth.user.id);

    const response = await send(auth.token, transactionId, pngBytes());

    expect(response.status).toBe(200);
    expect(response.body.data.delivered).toBe(true);
    expect(response.body.data.chat).toBe('@fundxtrabot');

    expect(sent).toHaveLength(1);
    // The destination comes from the session, never from the request.
    expect(sent[0]?.chatId).toBe('770001');
    expect(sent[0]?.bytes.byteLength).toBe(72);
  });

  it('captions it from the stored transaction, not from the request', async () => {
    const auth = await signIn(770002);
    const transactionId = await seedTransaction(auth.user.id, 125_000);

    await send(auth.token, transactionId, pngBytes());

    const caption = sent[0]?.caption ?? '';
    // Whatever the picture shows, the words underneath are our own record.
    expect(caption).toContain('₦1,250');
    expect(caption).toContain(transactionId);
    expect(caption).toContain('Transaction receipt');
  });

  it('will not send another user’s receipt', async () => {
    const owner = await signIn(770003);
    const stranger = await signIn(770004);
    const transactionId = await seedTransaction(owner.user.id);

    const response = await send(stranger.token, transactionId, pngBytes());

    // Not FORBIDDEN: that would confirm the id exists.
    expect(response.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('refuses anything that is not a PNG', async () => {
    const auth = await signIn(770005);
    const transactionId = await seedTransaction(auth.user.id);

    // A correct content-type header on bytes that are not an image. The
    // signature is what decides, because the header is just what was typed.
    const response = await send(auth.token, transactionId, Buffer.from('<?php echo 1; ?>'));

    expect(response.status).toBe(422);
    expect(sent).toHaveLength(0);
  });

  it('refuses an empty upload', async () => {
    const auth = await signIn(770006);
    const transactionId = await seedTransaction(auth.user.id);

    const response = await send(auth.token, transactionId, Buffer.alloc(0));

    expect(response.status).toBe(422);
    expect(sent).toHaveLength(0);
  });

  it('turns a blocked bot into something the user can act on', async () => {
    const auth = await signIn(770007);
    const transactionId = await seedTransaction(auth.user.id);
    photoFailure = new TelegramApiError('sendPhoto', 403, 'Forbidden: bot was blocked by the user');

    const response = await send(auth.token, transactionId, pngBytes());

    expect(response.status).toBe(422);
    // A fix they can perform in five seconds beats "something went wrong".
    expect(response.body.error.message).toContain('@fundxtrabot');
    expect(response.body.error.message).toContain('Start');
  });

  it('does not leak Telegram’s wording on an unexpected refusal', async () => {
    const auth = await signIn(770008);
    const transactionId = await seedTransaction(auth.user.id);
    photoFailure = new TelegramApiError('sendPhoto', 400, 'Bad Request: PHOTO_INVALID_DIMENSIONS');

    const response = await send(auth.token, transactionId, pngBytes());

    expect(response.status).toBe(503);
    expect(response.body.error.message).not.toContain('PHOTO_INVALID_DIMENSIONS');
  });

  it('is closed to callers with no session', async () => {
    const auth = await signIn(770009);
    const transactionId = await seedTransaction(auth.user.id);

    const response = await request(app)
      .post(`/wallet/transactions/${transactionId}/send-to-telegram`)
      .attach('receipt', pngBytes(), { filename: 'receipt.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});
