import { BRAND, formatNaira, type Kobo } from '@fundxtra/shared';
import { miniAppUrl } from '../config/env';
import { logger } from '../lib/logger';
import { sendBotMessage, type ReplyMarkup } from '../lib/telegram-bot';

/**
 * Telling users what happened to their money.
 *
 * A Telegram-first platform that never messages anyone in Telegram is a web
 * app with extra steps. Until now nothing did: `notifyUser` existed and had no
 * callers, so a credited reward, a qualified referral and an approved payout
 * were all silent unless the user happened to reopen the app.
 *
 * Three rules hold for every message here.
 *
 * 1. **Never block the money.** Every send is fire-and-forget. A Telegram
 *    outage, a user who blocked the bot, a rate limit — none of those may fail
 *    the transaction that caused the message, which has already committed.
 *
 * 2. **State the balance.** "You earned ₦100" invites a second question. "You
 *    earned ₦100 · balance ₦1,250" answers it, and makes a wrong balance
 *    visible immediately rather than at withdrawal time.
 *
 * 3. **No income promises.** Nothing here says what someone could earn, only
 *    what they did earn. That is a platform rule, and a notification is
 *    exactly where it gets broken by accident.
 */

/** Opens the Mini App straight from the message. */
function openApp(label = `Open ${BRAND.name}`): ReplyMarkup {
  return { inline_keyboard: [[{ text: label, web_app: { url: miniAppUrl() } }]] };
}

/**
 * Sends without ever throwing.
 *
 * Exported for the services that need to notify inside their own flow; they
 * must not have to remember the try/catch themselves.
 */
function send(telegramId: string, text: string, markup?: ReplyMarkup): void {
  /*
    Both failure modes are caught, not just the rejection.

    `.catch()` handles a send that fails in flight. A synchronous throw —
    an unconfigured client, a bad argument — would escape it entirely and
    propagate into the caller, which is the transaction that just moved
    someone's money. "Never block the money" has to hold for both.
  */
  try {
    void sendBotMessage(telegramId, text, markup).catch((error: unknown) => {
      logger.info({ telegramId, err: error }, 'Notification not delivered');
    });
  } catch (error) {
    logger.info({ telegramId, err: error }, 'Notification could not be attempted');
  }
}

/**
 * A receipt, in a chat message.
 *
 * Every money event now sends one of these the moment it happens, rather than
 * waiting for someone to open the app and find it. That matters most for the
 * one people worry about: a payout. Somebody who has just been paid wants
 * proof in their hand, and a Telegram message is the only thing that reaches
 * them while they are still wondering.
 *
 * The shape deliberately matches the receipt the app paints — headline,
 * amount, when, the rows, the reference — so the two never look like
 * different documents for the same transaction.
 */
function receipt(input: {
  icon: string;
  headline: string;
  amountKobo: number;
  /** The rows, in reading order. Falsy values are dropped. */
  rows: [string, string | null | undefined][];
  reference?: string | undefined;
  /** One line of plain advice under the rows, if there is any worth giving. */
  note?: string | undefined;
}): string {
  const lines = [
    `${input.icon} <b>${input.headline}</b>\n\n`,
    `<b>${formatNaira(Math.abs(input.amountKobo))}</b>\n`,
    `${stamp()}\n`,
  ];

  for (const [label, value] of input.rows) {
    if (value) lines.push(`\n${label} · ${value}`);
  }

  if (input.reference) lines.push(`\n\nRef <code>${input.reference}</code>`);
  if (input.note) lines.push(`\n\n${input.note}`);

  return lines.join('');
}

/**
 * When, in Lagos.
 *
 * Fixed to the platform's timezone rather than the server's: a receipt that
 * says 13:02 to somebody who was paid at 14:02 reads as the wrong receipt.
 */
function stamp(): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

/** Money moved by an admin, in either direction. */
export function notifyBalanceAdjusted(input: {
  telegramId: string;
  firstName: string;
  amountKobo: number;
  balanceAfterKobo: Kobo;
  reason: string;
}): void {
  const credited = input.amountKobo > 0;
  const amount = formatNaira(Math.abs(input.amountKobo));

  const text = credited
    ? [
        `🎊 <b>${amount} added to your balance</b>\n\n`,
        `Hi ${input.firstName}, the ${BRAND.name} team just credited your account.\n\n`,
        `<b>Amount:</b> ${amount}\n`,
        `<b>New balance:</b> ${formatNaira(input.balanceAfterKobo)}\n`,
        `<b>Reason:</b> ${input.reason}`,
      ].join('')
    : [
        /*
          A debit is told plainly rather than softened. Someone who finds money
          missing and was not told assumes theft; someone who was told, with a
          reason and a support route, asks a question instead.
        */
        `⚠️ <b>${amount} removed from your balance</b>\n\n`,
        `Hi ${input.firstName}, the ${BRAND.name} team adjusted your account.\n\n`,
        `<b>Amount:</b> ${amount}\n`,
        `<b>New balance:</b> ${formatNaira(input.balanceAfterKobo)}\n`,
        `<b>Reason:</b> ${input.reason}\n\n`,
        'If this looks wrong, reply to Fundxtra Support with your account name.',
      ].join('');

  send(input.telegramId, text, openApp(credited ? 'See my balance' : `Open ${BRAND.name}`));
}

/** A screenshot task was approved and the reward credited. */
export function notifyTaskApproved(input: {
  telegramId: string;
  taskTitle: string;
  rewardKobo: Kobo;
  balanceAfterKobo: Kobo;
}): void {
  send(
    input.telegramId,
    receipt({
      icon: '✅',
      headline: 'Task approved',
      amountKobo: input.rewardKobo,
      rows: [
        ['Task', input.taskTitle],
        ['Type', 'Task reward'],
        ['Balance after', formatNaira(input.balanceAfterKobo)],
      ],
    }),
    openApp('Find another task'),
  );
}

/** A screenshot task was rejected. Nothing was credited. */
export function notifyTaskRejected(input: {
  telegramId: string;
  taskTitle: string;
  reason: string;
}): void {
  send(
    input.telegramId,
    [
      `❌ <b>Task not approved</b>\n\n`,
      `Your proof for “${input.taskTitle}” could not be approved.\n\n`,
      `<b>Reason:</b> ${input.reason}\n\n`,
      // Says the budget is untouched, so a rejection does not read as a loss.
      'Nothing was deducted. You can try the task again if it is still open.',
    ].join(''),
    openApp('Back to tasks'),
  );
}

/** A referred friend finished onboarding, so the referrer is paid. */
export function notifyReferralQualified(input: {
  telegramId: string;
  rewardKobo: Kobo;
  balanceAfterKobo: Kobo;
  qualifiedCount: number;
}): void {
  send(
    input.telegramId,
    receipt({
      icon: '🎉',
      headline: 'Referral confirmed',
      amountKobo: input.rewardKobo,
      rows: [
        ['Type', 'Referral reward'],
        // What actually qualifies it, not the old rule it still described.
        ['Detail', 'A friend you invited earned their first reward'],
        ['Friends earning', String(input.qualifiedCount)],
        ['Balance after', formatNaira(input.balanceAfterKobo)],
      ],
    }),
    openApp('Share my link'),
  );
}

/** A payout was approved and sent to the bank. */
export function notifyWithdrawalPaid(input: {
  telegramId: string;
  netKobo: Kobo;
  bankName: string;
  accountName: string;
  accountNumber: string;
  reference: string;
}): void {
  send(
    input.telegramId,
    receipt({
      icon: '✅',
      headline: 'Payment sent to your bank',
      amountKobo: input.netKobo,
      rows: [
        ['Type', 'Bank transfer'],
        ['To', input.accountName],
        [input.bankName, maskAccount(input.accountNumber)],
      ],
      reference: input.reference,
      // Banks are the slow part, and saying so prevents a support message.
      note: 'Your bank may take a few minutes to show it.',
    }),
    openApp('View receipt'),
  );
}

/**
 * A payout was asked for. The money has left the spendable balance already.
 *
 * This had no notification at all, which left the most alarming moment on the
 * platform unexplained: a user requests ₦2,000 and watches their balance drop
 * by ₦2,000 with nothing paid out yet. Saying so immediately, with the figure
 * and where it is going, is the difference between waiting and panicking.
 */
export function notifyWithdrawalRequested(input: {
  telegramId: string;
  amountKobo: Kobo;
  bankName: string;
  accountName: string;
  accountNumber: string;
  balanceAfterKobo: Kobo;
  reference: string;
}): void {
  send(
    input.telegramId,
    receipt({
      icon: '🧾',
      headline: 'Withdrawal requested',
      amountKobo: input.amountKobo,
      rows: [
        ['Type', 'Bank transfer'],
        ['To', input.accountName],
        [input.bankName, maskAccount(input.accountNumber)],
        ['Balance after', formatNaira(input.balanceAfterKobo)],
      ],
      reference: input.reference,
      note: 'This amount is held while we pay it, so it is already out of your balance. You will get another message the moment it leaves.',
    }),
    openApp('Track it'),
  );
}

/** A payout was refused or failed. The money is back in the balance. */
export function notifyWithdrawalReturned(input: {
  telegramId: string;
  amountKobo: Kobo;
  balanceAfterKobo: Kobo;
  reason: string;
}): void {
  send(
    input.telegramId,
    receipt({
      icon: '↩️',
      headline: 'Money is back in your balance',
      amountKobo: input.amountKobo,
      rows: [
        ['Type', 'Returned'],
        ['Reason', input.reason],
        ['Balance after', formatNaira(input.balanceAfterKobo)],
      ],
      /*
        The money first, the reason second. Somebody reading this has just
        had a payout refused and the only question in their head is whether
        their money is gone.
      */
      note: 'Nothing was lost. Fix what the reason says and request it again.',
    }),
    openApp('Try again'),
  );
}

function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `••••${accountNumber.slice(-4)}`;
}
