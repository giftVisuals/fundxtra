import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { telegramWebhookSecret } from '../config/env';
import { handleBotUpdate, type TelegramUpdate } from '../services/bot';
import { logger } from '../lib/logger';

/**
 * Telegram webhook.
 *
 * Mounted before the maintenance gate and outside the session middleware: this
 * is Telegram talking, not a browser, and it carries no session.
 *
 * Three things matter here.
 *
 * **1. The secret header is the only authentication.** Telegram echoes the
 * `secret_token` given to `setWebhook` in `X-Telegram-Bot-Api-Secret-Token`.
 * Without checking it, anyone who learned the URL could post a fabricated
 * `/start` — and a `/start` carries a referral code. Compared in constant time,
 * so the comparison cannot be used to discover the secret byte by byte.
 *
 * **2. Always answer 200, even on failure.** A non-2xx makes Telegram redeliver
 * the same update, which would send a duplicate greeting. The one exception is
 * a bad secret, which is answered 401 and never processed — that is not a
 * delivery Telegram should retry either, but it is also not one to accept.
 *
 * **3. Nothing here moves money.** The bot replies with a button; every
 * balance-affecting route still requires HMAC-verified `initData` and a
 * verified PIN. A forged update cannot credit anyone.
 */

export const telegramRouter = Router();

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through an exception path.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

telegramRouter.post('/webhook', async (req, res) => {
  const expected = telegramWebhookSecret();
  if (!expected) {
    // Unconfigured: refuse rather than accept unauthenticated updates.
    logger.warn('Telegram webhook called but no secret is configured');
    res.status(503).json({ ok: false });
    return;
  }

  const provided = req.header('x-telegram-bot-api-secret-token');
  if (!secretMatches(provided, expected)) {
    logger.warn({ ip: req.clientIp }, 'Rejected a Telegram webhook with a bad secret');
    res.status(401).json({ ok: false });
    return;
  }

  // Acknowledge first, then handle. Telegram's delivery timeout is short, and
  // a slow Firestore read must not turn into a redelivered update.
  res.status(200).json({ ok: true });

  try {
    await handleBotUpdate(req.body as TelegramUpdate);
  } catch (error) {
    logger.warn({ err: error }, 'Unhandled failure while processing a Telegram update');
  }
});
