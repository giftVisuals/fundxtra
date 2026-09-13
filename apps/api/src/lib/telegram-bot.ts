import { env, hasTelegram } from '../config/env';
import { logger } from './logger';

/**
 * Telegram Bot API client.
 *
 * Only documented methods are used, and only for what they actually support:
 *
 * - `getChatMember`  — reads a user's membership status in a chat.
 * - `getChat`        — resolves a chat and reveals whether we can see it at all.
 * - `getMe`          — startup sanity check.
 * - `sendMessage`    — optional notifications.
 *
 * Nothing here is invented. Where Telegram cannot answer a question (for
 * example, whether someone watched a video), the platform uses screenshot
 * review instead of pretending otherwise.
 */

const API_ROOT = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 8_000;

export type ChatMemberStatus =
  | 'creator'
  | 'administrator'
  | 'member'
  | 'restricted'
  | 'left'
  | 'kicked';

/** Statuses that count as "in the chat" for task verification. */
const JOINED_STATUSES: readonly ChatMemberStatus[] = ['creator', 'administrator', 'member'];

export interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | null,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed (${errorCode ?? 'network'}): ${description}`);
    this.name = 'TelegramApiError';
  }
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  if (!hasTelegram) {
    throw new TelegramApiError(method, null, 'TELEGRAM_BOT_TOKEN is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_ROOT}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = (await response.json()) as TelegramApiResult<T>;
    if (!body.ok || body.result === undefined) {
      throw new TelegramApiError(
        method,
        body.error_code ?? response.status,
        body.description ?? 'Unknown Telegram API error',
      );
    }
    return body.result;
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TelegramApiError(method, null, 'Request to Telegram timed out');
    }
    throw new TelegramApiError(
      method,
      null,
      error instanceof Error ? error.message : 'Network failure',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A Bot API call that carries a file, which `call` above cannot do — it sends
 * JSON, and Telegram takes uploads only as multipart.
 *
 * Written against the platform's own FormData and fetch rather than a client
 * library: one method needs this, and a dependency that can upload files is a
 * dependency that can be pointed anywhere.
 */
async function callWithFile<T>(method: string, form: FormData): Promise<T> {
  if (!hasTelegram) {
    throw new TelegramApiError(method, null, 'TELEGRAM_BOT_TOKEN is not configured');
  }

  const controller = new AbortController();
  // Longer than the JSON timeout: this one is carrying a few hundred kilobytes
  // over whatever connection the server happens to have.
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(`${API_ROOT}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    const body = (await response.json()) as TelegramApiResult<T>;
    if (!body.ok || body.result === undefined) {
      throw new TelegramApiError(
        method,
        body.error_code ?? response.status,
        body.description ?? 'Unknown Telegram API error',
      );
    }
    return body.result;
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TelegramApiError(method, null, 'Request to Telegram timed out');
    }
    throw new TelegramApiError(
      method,
      null,
      error instanceof Error ? error.message : 'Network failure',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send an image into a chat, as a photo.
 *
 * A photo rather than a document on purpose: a photo opens with one tap and
 * the Telegram viewer's own menu has "Save to Gallery" in it, which is the
 * thing the user is actually trying to do. A document would stay lossless but
 * lands as a file card, and saving it is a longer road.
 *
 * The caption is written by the caller from server-side data, never echoed
 * from the client, so the words under the picture are the platform's record
 * regardless of what image was handed in.
 */
export async function sendBotPhoto(options: {
  chatId: string;
  bytes: Buffer;
  filename: string;
  caption: string;
  replyMarkup?: ReplyMarkup;
}): Promise<{ message_id: number }> {
  const form = new FormData();
  form.append('chat_id', options.chatId);
  form.append(
    'photo',
    new Blob([new Uint8Array(options.bytes)], { type: 'image/png' }),
    options.filename,
  );
  form.append('caption', options.caption);
  form.append('parse_mode', 'HTML');
  if (options.replyMarkup) form.append('reply_markup', JSON.stringify(options.replyMarkup));

  return callWithFile<{ message_id: number }>('sendPhoto', form);
}

export interface ChatMember {
  status: ChatMemberStatus;
  user: { id: number; username?: string; first_name: string };
}

export type MembershipOutcome =
  | { state: 'JOINED'; status: ChatMemberStatus }
  | { state: 'NOT_JOINED'; status: ChatMemberStatus }
  | { state: 'CONFIGURATION_ERROR'; adminMessage: string }
  | { state: 'UNAVAILABLE'; adminMessage: string };

/**
 * Check whether a user is in a chat.
 *
 * The three failure modes are kept distinct because they need different
 * handling, and collapsing them is how a verification system ends up either
 * blocking legitimate users or paying out on a misconfiguration:
 *
 * - NOT_JOINED           the user genuinely has not joined. Tell the user.
 * - CONFIGURATION_ERROR  the bot cannot see the chat's members. Tell the admin,
 *                        and never credit the reward.
 * - UNAVAILABLE          Telegram is unreachable. Ask the user to retry.
 */
export async function checkChatMembership(
  chatId: string,
  telegramUserId: string,
): Promise<MembershipOutcome> {
  try {
    const member = await call<ChatMember>('getChatMember', {
      chat_id: normaliseChatId(chatId),
      user_id: Number.parseInt(telegramUserId, 10),
    });

    return JOINED_STATUSES.includes(member.status)
      ? { state: 'JOINED', status: member.status }
      : { state: 'NOT_JOINED', status: member.status };
  } catch (error) {
    if (!(error instanceof TelegramApiError)) {
      return { state: 'UNAVAILABLE', adminMessage: 'Unexpected verification failure' };
    }

    const description = error.description.toLowerCase();

    // "user not found" / "participant id invalid" means the user is not in the
    // chat, which is a legitimate negative rather than a configuration fault.
    if (description.includes('user not found') || description.includes('participant_id_invalid')) {
      return { state: 'NOT_JOINED', status: 'left' };
    }

    if (
      description.includes('chat not found') ||
      description.includes('member list is inaccessible') ||
      description.includes('not enough rights') ||
      description.includes('bot is not a member') ||
      description.includes('forbidden')
    ) {
      logger.error(
        { chatId, description: error.description },
        'Telegram verification is misconfigured for this chat',
      );
      return {
        state: 'CONFIGURATION_ERROR',
        adminMessage: configurationAdvice(error.description),
      };
    }

    logger.warn({ chatId, err: error }, 'Telegram membership check unavailable');
    return { state: 'UNAVAILABLE', adminMessage: error.description };
  }
}

/** Actionable guidance for the admin, derived from Telegram's own description. */
function configurationAdvice(description: string): string {
  const text = description.toLowerCase();
  if (text.includes('chat not found')) {
    return 'Telegram cannot find this chat. Check the @username or numeric id, and make sure the Fundxtra bot has been added to it.';
  }
  if (text.includes('member list is inaccessible')) {
    return 'The Fundxtra bot must be an administrator of this chat to read its member list. Promote the bot, then retry.';
  }
  if (text.includes('not enough rights')) {
    return 'The Fundxtra bot lacks the rights to verify members here. Promote it to administrator.';
  }
  return `Telegram refused the membership check: ${description}`;
}

/**
 * Confirm at task-creation time that verification will actually work, so an
 * admin finds out immediately rather than through a wave of failed completions.
 */
export async function probeChatAccess(chatId: string): Promise<{
  ok: boolean;
  title: string | null;
  warning: string | null;
}> {
  try {
    const chat = await call<{ id: number; title?: string; username?: string; type: string }>(
      'getChat',
      { chat_id: normaliseChatId(chatId) },
    );

    // Seeing the chat is not the same as being able to read its members: the
    // bot needs administrator rights for that in channels and large groups.
    const administrators = await call<Array<{ user: { id: number; is_bot: boolean } }>>(
      'getChatAdministrators',
      { chat_id: normaliseChatId(chatId) },
    ).catch(() => null);

    const me = await call<{ id: number }>('getMe', {}).catch(() => null);
    const botIsAdmin =
      administrators && me
        ? administrators.some((entry) => entry.user.id === me.id)
        : false;

    return {
      ok: true,
      title: chat.title ?? chat.username ?? null,
      warning: botIsAdmin
        ? null
        : 'The Fundxtra bot is not an administrator of this chat. Automatic membership verification will fail until it is promoted.',
    };
  } catch (error) {
    const description =
      error instanceof TelegramApiError ? error.description : 'Verification probe failed';
    return { ok: false, title: null, warning: configurationAdvice(description) };
  }
}

/** `@name` or a numeric `-100…` id, in the form the Bot API expects. */
function normaliseChatId(chatId: string): string | number {
  const trimmed = chatId.trim();
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export async function getBotIdentity(): Promise<{ id: number; username: string } | null> {
  try {
    const me = await call<{ id: number; username: string }>('getMe', {});
    return me;
  } catch (error) {
    logger.warn({ err: error }, 'Could not read the bot identity');
    return null;
  }
}

/** Optional notification. Failure is logged and swallowed: never block a reward. */
export async function notifyUser(telegramId: string, text: string): Promise<boolean> {
  try {
    await call('sendMessage', {
      chat_id: Number.parseInt(telegramId, 10),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    return true;
  } catch (error) {
    logger.info({ telegramId, err: error }, 'Could not notify the user on Telegram');
    return false;
  }
}

/* ------------------------------------------------------------------------- *
 * Bot presence: replying in chat, and configuring the bot with Telegram.
 *
 * A referral link is `t.me/<bot>?start=<code>`, which opens a *chat* with the
 * bot. Without a reply there, an invited friend sees an empty conversation and
 * leaves — so the reply below is what makes referrals work at all, not a
 * nicety. The message carries a Mini App button rather than instructions,
 * because the fewer taps between the link and the dashboard the better.
 * ------------------------------------------------------------------------- */

export interface InlineKeyboardButton {
  text: string;
  web_app?: { url: string };
  url?: string;
}

export interface ReplyMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Send a chat message, optionally with buttons.
 *
 * Failure is logged and swallowed. A webhook that throws makes Telegram retry
 * the same update, which would send the message twice if the first attempt had
 * actually arrived.
 */
export async function sendBotMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: ReplyMarkup,
): Promise<boolean> {
  try {
    await call('sendMessage', {
      chat_id: typeof chatId === 'string' ? Number.parseInt(chatId, 10) : chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    return true;
  } catch (error) {
    logger.warn({ chatId, err: error }, 'Could not send the bot message');
    return false;
  }
}

export interface BotCommand {
  command: string;
  description: string;
}

/** Populates the "/" menu in the chat. */
export async function setMyCommands(commands: BotCommand[]): Promise<boolean> {
  try {
    await call('setMyCommands', { commands });
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Could not set the bot commands');
    return false;
  }
}

/**
 * Points the chat's menu button at the Mini App.
 *
 * Doing this over the API rather than by hand in @BotFather means a fresh
 * deployment configures itself, and the button can never drift from the URL
 * this deployment actually serves.
 */
export async function setChatMenuButton(miniAppUrl: string, label: string): Promise<boolean> {
  try {
    await call('setChatMenuButton', {
      menu_button: { type: 'web_app', text: label, web_app: { url: miniAppUrl } },
    });
    return true;
  } catch (error) {
    logger.warn({ miniAppUrl, err: error }, 'Could not set the chat menu button');
    return false;
  }
}

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  last_error_date?: number;
}

export async function getWebhookInfo(): Promise<WebhookInfo | null> {
  try {
    return await call<WebhookInfo>('getWebhookInfo', {});
  } catch (error) {
    logger.warn({ err: error }, 'Could not read the webhook info');
    return null;
  }
}

/**
 * Register the webhook.
 *
 * `secret_token` makes Telegram send an `X-Telegram-Bot-Api-Secret-Token`
 * header with every update, which the route requires. Without it the webhook
 * URL would accept forged updates from anyone who guessed it — and an update
 * is what triggers a referral attribution.
 *
 * `allowed_updates` is narrowed to messages: nothing else is handled, and
 * asking for less means Telegram does not queue updates that would only be
 * discarded.
 */
export async function setWebhook(url: string, secretToken: string): Promise<boolean> {
  try {
    await call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message'],
      drop_pending_updates: false,
      max_connections: 20,
    });
    return true;
  } catch (error) {
    logger.error({ url, err: error }, 'Could not register the Telegram webhook');
    return false;
  }
}
