import {
  BRAND,
  formatNaira,
  isTaskSlug,
  LIMITS,
  toSignupSource,
  type ChannelInvite,
} from '@fundxtra/shared';
import { getSettings } from './settings';
import { isPrimaryAdmin } from './admins';
import { channelInvite, channelMembership } from './channel';
import { answerCallbackQuery, sendBotMessage, type ReplyMarkup } from '../lib/telegram-bot';
import { logger } from '../lib/logger';
import { env, miniAppUrl } from '../config/env';
import { reviewSubmission } from './completions';
import { rememberEscalation } from './review-escalation';
import { findUser } from './users';

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

export interface TelegramCallbackQuery {
  id: string;
  from?: { id?: number; is_bot?: boolean };
  data?: string;
  message?: { message_id?: number; chat?: { id?: number } };
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

function openButton(label: string, url: string): ReplyMarkup {
  return { inline_keyboard: [[{ text: label, web_app: { url } }]] };
}

/**
 * Join the channel, then open the app.
 *
 * Two rows in that order because that is the order the user has to do them
 * in: the app will not let a non-member past its front screen, so offering
 * "Open" first would send them to a door they cannot walk through.
 */
function joinButtons(channelUrl: string, openLabel: string, openUrl: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Join the Fundxtra channel', url: channelUrl }],
      [{ text: openLabel, web_app: { url: openUrl } }],
    ],
  };
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
function startMessage(
  firstName: string | undefined,
  referralCode: string | null,
  forTask = false,
  channelRequired = false,
): string {
  const greeting = firstName ? `Hi ${firstName}! 👋` : 'Hi! 👋';
  const invited = referralCode
    ? '\n\nYou were invited by a friend — they get credited once you complete your first task and get paid for it.'
    : forTask
      ? '\n\nThis link opens a specific task. Tap below to see what it pays and what to do.'
      : '';

  return [
    `${greeting}\n`,
    `<b>${BRAND.name}</b> — ${BRAND.tagline}`,
    invited,
    '\n\nHere is how it works:',
    '\n• Complete sponsored tasks and earn Naira rewards',
    `\n• Invite friends and earn ${formatNaira(LIMITS.REFERRAL_REWARD_KOBO)} per friend who joins and earns their first reward`,
    '\n• Withdraw as cash, or redeem airtime, data, Telegram Stars or Premium',
    channelNote(channelRequired),
    '\n\nTap below to open the app and set your 4-digit PIN.',
  ].join('');
}

/** One line about the channel, in the greeting, whether or not it is enforced. */
function channelNote(required: boolean): string {
  return required
    ? '\n\n<b>You must join our Telegram channel to use Fundxtra.</b> Tap the button below to join first — it takes a second, and it is where new tasks and payout news are posted.'
    : '\n\nJoin our Telegram channel for new tasks and payout news.';
}

/**
 * What the bot says to someone who has not joined the channel.
 *
 * Friendly, and specific about what happens next. Someone who has earned
 * before and left is asked to come back rather than told they are locked out:
 * their balance has not moved and saying so first is the truthful thing as
 * well as the kind one.
 */
function joinFirstMessage(firstName: string | undefined, returning: boolean): string {
  const greeting = firstName ? `Hi ${firstName}! 👋` : 'Hi! 👋';
  return [
    `${greeting}\n\n`,
    returning
      ? `<b>Join the ${BRAND.name} channel to continue</b>\n\n`
      : `<b>One step before you start</b>\n\n`,
    returning
      ? 'It looks like you are no longer in our Telegram channel, so earning is paused. Your balance and everything you have earned are safe and waiting — join back and it all continues where it left off.'
      : `Everyone on ${BRAND.name} is a member of our Telegram channel. It is where new tasks, payout news and announcements are posted.`,
    '\n\nTap <b>Join the Fundxtra channel</b> below, then come back and open the app.',
  ].join('');
}

function helpMessage(
  supportHandle: string,
  minWithdrawal: string,
  invite: ChannelInvite | null,
): string {
  return [
    `<b>${BRAND.name} help</b>\n\n`,
    '• <b>Open the app</b> — use the button below or the menu button beside the message box\n',
    '• <b>Your PIN</b> — 4 digits, set on first open, and needed for anything that moves money\n',
    `• <b>Forgot your PIN?</b> Contact Fundxtra Support at ${supportHandle}\n`,
    `• <b>Withdrawals</b> — from ${minWithdrawal}, when the withdrawal portal is open\n`,
    '• <b>Rewards</b> — cash, airtime, data, Telegram Stars and Telegram Premium\n',
    invite?.required
      ? `• <b>Our channel</b> — membership of ${invite.handle} is required to use ${BRAND.name}\n`
      : invite
        ? `• <b>Our channel</b> — ${invite.handle} for new tasks and payout news\n`
        : '',
    '\nRewards depend on the tasks sponsors are funding at the time, so there is no fixed or guaranteed amount.',
  ].join('');
}

/**
 * What the bot says while the platform is locked down.
 *
 * No "open the app" button: during maintenance the app is a locked screen, and
 * inviting someone to open something that is closed reads as a broken platform
 * rather than a scheduled one. Support is the only useful door, so it is the
 * only one offered.
 */
function maintenanceMessage(message: string): string {
  return [
    `<b>${BRAND.name} is closed for maintenance</b>\n\n`,
    escape(message),
    '\n\nYour balance is safe — nothing is lost while we are working. Message support if you need us.',
  ].join('');
}

/** Telegram's HTML parse mode needs these three escaped, and only these. */
function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Handle one update.
 *
 * Always resolves. A webhook that rejects makes Telegram redeliver the same
 * update, and a redelivered `/start` would send a duplicate greeting.
 */
export async function handleBotUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleReviewTap(update.callback_query);
    return;
  }

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

    /*
      A lockdown is a lockdown here too.

      Maintenance mode closes the Mini App for everyone but an admin, so the
      bot stops greeting people into it and says what is happening instead.
      Checked against the owner's Telegram id alone, which costs nothing —
      resolving every sender against the admins collection would be a read per
      message, and the owner is who needs the bot working during an outage.
    */
    if (settings.platform.maintenanceMode && !isPrimaryAdmin(String(message.from.id))) {
      await sendBotMessage(
        chatId,
        maintenanceMessage(settings.platform.maintenanceMessage),
        supportButton(supportHandle),
      );
      return;
    }

    /*
      Channel membership, for everything the bot answers.

      The app will not let a non-member past its front screen, so the bot must
      not pretend otherwise. One `getChatMember` call per message, and members
      are cached for a few minutes, so a conversation does not re-ask Telegram
      on every line. A check that cannot be answered lets the person through —
      see services/channel.ts.

      The owner is exempt on their id alone, which costs nothing and keeps the
      bot working for them if the channel is ever misconfigured.
    */
    const invite = channelInvite(settings);
    const gated = Boolean(invite?.required) && !isPrimaryAdmin(String(message.from.id));
    if (invite && gated) {
      const state = await channelMembership(String(message.from.id), invite.handle);
      if (state === 'MISSING') {
        const user = await findUser(String(message.from.id));
        await sendBotMessage(
          chatId,
          joinFirstMessage(message.from.first_name, Boolean(user?.hasPin)),
          joinButtons(invite.url, `Open ${BRAND.name}`, miniAppUrl()),
        );
        return;
      }
    }

    if (command === '/start') {
      const payload = rest[0] && START_PAYLOAD_PATTERN.test(rest[0]) ? rest[0] : null;

      /*
        One payload, three meanings, distinguished before anything is looked
        up:

          task_<id>   a campaign link — open the app on that task
          website|…   a channel the signup came from (see SIGNUP_SOURCES)
          anything    a user's referral code

        The task prefix is checked first because `task_crediplex` is neither a
        channel nor a code, and treating it as one would open a dead referral
        lookup and lose the campaign the person actually followed.
      */
      const taskSlug = payload?.startsWith('task_') ? payload.slice('task_'.length) : null;

      let url = miniAppUrl();
      if (taskSlug && isTaskSlug(taskSlug)) {
        url = `${miniAppUrl()}?task=${encodeURIComponent(taskSlug)}`;
      } else if (payload && !taskSlug) {
        url = `${miniAppUrl()}?ref=${encodeURIComponent(payload)}`;
      }

      const referralCode = payload && !taskSlug && !toSignupSource(payload) ? payload : null;

      const openLabel = taskSlug ? 'Open this task' : `Open ${BRAND.name}`;
      await sendBotMessage(
        chatId,
        startMessage(
          message.from.first_name,
          referralCode,
          Boolean(taskSlug),
          Boolean(invite?.required),
        ),
        invite
          ? joinButtons(invite.url, openLabel, url)
          : openButton(openLabel, url),
      );
      return;
    }

    if (command === '/help') {
      await sendBotMessage(
        chatId,
        helpMessage(supportHandle, formatNaira(settings.withdrawals.minAmountKobo), invite),
        invite
          ? joinButtons(invite.url, `Open ${BRAND.name}`, miniAppUrl())
          : openButton(`Open ${BRAND.name}`, miniAppUrl()),
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

/**
 * A tapped Approve or Reject button on an escalated screenshot.
 *
 * This is the whole point of escalating to Telegram: deciding costs one tap
 * and reads exactly one document — the submission being decided. No queue is
 * loaded, because there is no queue here. The work came to the owner.
 *
 * Authorised by Telegram id against the primary admin, and nothing else. The
 * callback arrives over the same authenticated webhook as every other update,
 * and the id in it is Telegram's own — but this is a button that moves money,
 * so it is checked rather than assumed.
 */
async function handleReviewTap(query: TelegramCallbackQuery): Promise<void> {
  const data = query.data ?? '';
  const [prefix, action, submissionId] = data.split(':');
  if (prefix !== 'rev' || !submissionId || (action !== 'a' && action !== 'r')) return;

  const tapperId = query.from?.id === undefined ? '' : String(query.from.id);
  if (tapperId !== env.PRIMARY_ADMIN_TELEGRAM_ID) {
    await answerCallbackQuery(query.id, 'That is not yours to decide.');
    logger.warn({ tapperId, submissionId }, 'Non-owner tapped a review button');
    return;
  }

  const approve = action === 'a';

  /*
    Register the card before deciding, so the close-out below happens through
    the same path as a decision made in the admin console. After a restart the
    registry is empty and this is the only place that still knows which
    message is showing this submission.
  */
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (chatId !== undefined && messageId !== undefined) {
    rememberEscalation(submissionId, String(chatId), messageId);
  }

  try {
    await reviewSubmission({
      submissionId,
      decision: approve ? 'APPROVE' : 'REJECT',
      reviewerId: tapperId,
      reason: approve ? undefined : 'Reviewed by the Fundxtra team.',
    });

    /*
      The caption is rewritten and the buttons removed by `reviewSubmission`
      itself, so the same submission cannot be decided twice by scrolling back
      to an old message. The service would refuse the second attempt anyway,
      but a button that still looks live is a button somebody presses.
    */
    await answerCallbackQuery(query.id, approve ? 'Approved and paid' : 'Rejected');
  } catch (error) {
    logger.warn({ err: error, submissionId }, 'Review tap could not be applied');
    // Most likely somebody already decided it in the admin console.
    await answerCallbackQuery(query.id, 'Already decided, or no longer available.');
  }
}
