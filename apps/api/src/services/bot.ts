import { BRAND, formatNaira, LIMITS } from '@fundxtra/shared';
import { getSettings } from './settings';
import { sendBotMessage, type ReplyMarkup } from '../lib/telegram-bot';
import { logger } from '../lib/logger';
import { miniAppUrl } from '../config/env';

/**
 * The bot conversation.
 *
 * Deliberately small. The bot is a doorway, not a second interface: it greets,
 * it hands over a button, and it points at support. Everything that touches a
 * balance happens in the Mini App behind a verified `initData` signature and a
 * PIN, so there is nothing here for a forged chat message to reach.
 *
 * Why it exists at all: a referral link is `t.me/<bot>?start=<code>`, which
 * opens a chat. An unanswered chat is an invited friend who leaves, and a
 * referral that never qualifies. This is the reply.
 *
 * Two rules the copy has to keep:
 *
 * 1. **No income promises.** Not "earn ₦50,000 monthly", not "guaranteed".
 *    Rewards depend on the tasks a sponsor is actually funding, and saying
 *    otherwise would be a lie the platform cannot honour.
 * 2. **No unverified claim of who the user is.** The greeting uses the name
 *    Telegram supplies for display only; nothing is created or credited here.
 */

/** The referral code is opaque to the bot; the API validates it. */
const START_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface TelegramMessage {
  message_id?: number;
  from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  chat?: { id: number; type?: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

function openButton(label: string, url: string): ReplyMarkup {
  return { inline_keyboard: [[{ text: label, web_app: { url } }]] };
}

function supportButton(supportHandle: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: 'Message Fundxtra Support',
          url: `https://t.me/${supportHandle.replace(/^@/, '')}`,
        },
      ],
    ],
  };
}

/**
 * `/start`, with or without a referral payload.
 *
 * The payload rides on the Mini App URL as `?ref=`, because Telegram only
 * populates the signed `start_param` for direct Mini App links, not for a
 * `web_app` button. The API treats an unsigned code as a claim, not a fact:
 * attribution happens once, on account creation, and self-referral is refused
 * — so the worst a forged code can do is credit a real referrer who did not
 * earn it, which the referral service already rejects.
 */
function startMessage(firstName: string | undefined, referralCode: string | null): string {
  const greeting = firstName ? `Hi ${firstName}! 👋` : 'Hi! 👋';
  const invited = referralCode
    ? '\n\nYou were invited by a friend — open the app and they get credited once you set your PIN.'
    : '';

  return [
    `${greeting}\n`,
    `<b>${BRAND.name}</b> — ${BRAND.tagline}`,
    invited,
    '\n\nHere is how it works:',
    '\n• Complete sponsored tasks and earn Naira rewards',
    `\n• Invite friends and earn ${formatNaira(LIMITS.REFERRAL_REWARD_KOBO)} per friend who joins and sets a PIN`,
    '\n• Withdraw as cash, or redeem airtime, data, Telegram Stars or Premium',
    '\n\nTap below to open the app and set your 4-digit PIN.',
  ].join('');
}

function helpMessage(supportHandle: string, minWithdrawal: string): string {
  return [
    `<b>${BRAND.name} help</b>\n\n`,
    '• <b>Open the app</b> — use the button below or the menu button beside the message box\n',
    '• <b>Your PIN</b> — 4 digits, set on first open, and needed for anything that moves money\n',
    `• <b>Forgot your PIN?</b> Contact Fundxtra Support at ${supportHandle}\n`,
    `• <b>Withdrawals</b> — from ${minWithdrawal}, when the withdrawal portal is open\n`,
    '• <b>Rewards</b> — cash, airtime, data, Telegram Stars and Telegram Premium\n\n',
    'Rewards depend on the tasks sponsors are funding at the time, so there is no fixed or guaranteed amount.',
  ].join('');
}

/**
 * Handle one update.
 *
 * Always resolves. A webhook that rejects makes Telegram redeliver the same
 * update, and a redelivered `/start` would send a duplicate greeting.
 */
export async function handleBotUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || !message.chat || !message.from) return;

  // Ignore other bots, and anything that is not a private chat: the bot has
  // nothing to say in a group, and replying there would be noise.
  if (message.from.is_bot) return;
  if (message.chat.type && message.chat.type !== 'private') return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  // "/start@fundxtrabot code" is valid in Telegram; strip the mention.
  const [rawCommand = '', ...rest] = text.split(/\s+/);
  const command = rawCommand.split('@')[0]?.toLowerCase() ?? '';

  try {
    const settings = await getSettings();
    const supportHandle = settings.platform.supportHandle;

    if (command === '/start') {
      const payload = rest[0];
      const referralCode = payload && START_PAYLOAD_PATTERN.test(payload) ? payload : null;
      const url = referralCode
        ? `${miniAppUrl()}?ref=${encodeURIComponent(referralCode)}`
        : miniAppUrl();

      await sendBotMessage(
        chatId,
        startMessage(message.from.first_name, referralCode),
        openButton(`Open ${BRAND.name}`, url),
      );
      return;
    }

    if (command === '/help') {
      await sendBotMessage(
        chatId,
        helpMessage(supportHandle, formatNaira(settings.withdrawals.minAmountKobo)),
        openButton(`Open ${BRAND.name}`, miniAppUrl()),
      );
      return;
    }

    if (command === '/support') {
      await sendBotMessage(
        chatId,
        `Fundxtra Support is at ${supportHandle}. For a forgotten PIN, message support — a PIN can never be read back to you, only reset.`,
        supportButton(supportHandle),
      );
      return;
    }

    // Anything else: one short nudge back to the app rather than silence, and
    // no attempt to interpret free text as a command.
    await sendBotMessage(
      chatId,
      `Everything happens inside the app. Tap below to open ${BRAND.name}, or send /help.`,
      openButton(`Open ${BRAND.name}`, miniAppUrl()),
    );
  } catch (error) {
    logger.warn({ err: error, chatId }, 'Could not handle the bot update');
  }
}
