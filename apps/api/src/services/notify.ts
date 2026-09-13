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
    [
      `✅ <b>Task approved — ${formatNaira(input.rewardKobo)} earned</b>\n\n`,
      `Your proof for “${input.taskTitle}” was checked and approved.\n\n`,
      `<b>Earned:</b> ${formatNaira(input.rewardKobo)}\n`,
      `<b>New balance:</b> ${formatNaira(input.balanceAfterKobo)}`,
    ].join(''),
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
    [
      `🎉 <b>Referral confirmed — ${formatNaira(input.rewardKobo)} earned</b>\n\n`,
      'A friend you invited joined Fundxtra and set up their PIN.\n\n',
      `<b>Earned:</b> ${formatNaira(input.rewardKobo)}\n`,
      `<b>New balance:</b> ${formatNaira(input.balanceAfterKobo)}\n`,
      `<b>Friends joined:</b> ${String(input.qualifiedCount)}`,
    ].join(''),
    openApp('Share my link'),
  );
}

/** A payout was approved and sent to the bank. */
export function notifyWithdrawalPaid(input: {
  telegramId: string;
  netKobo: Kobo;
  bankName: string;
  accountNumber: string;
  reference: string;
}): void {
  send(
    input.telegramId,
    [
      `💸 <b>${formatNaira(input.netKobo)} sent to your bank</b>\n\n`,
      `<b>Bank:</b> ${input.bankName}\n`,
      `<b>Account:</b> ${maskAccount(input.accountNumber)}\n`,
      `<b>Reference:</b> <code>${input.reference}</code>\n\n`,
      // Banks are the slow part, and saying so prevents a support message.
      'Your bank may take a few minutes to show it.',
    ].join(''),
    openApp('View receipt'),
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
    [
      `↩️ <b>Withdrawal returned — ${formatNaira(input.amountKobo)} back in your balance</b>\n\n`,
      `<b>Reason:</b> ${input.reason}\n`,
      `<b>Balance:</b> ${formatNaira(input.balanceAfterKobo)}\n\n`,
      // The first thing anyone wants to know is whether the money is gone.
      'Nothing was lost. Check the account details and try again.',
    ].join(''),
    openApp('Try again'),
  );
}

/**
 * Shows enough of an account number to recognise, not enough to reuse.
 *
 * A notification can sit in a chat someone else sees; a full NUBAN in it is a
 * detail worth withholding when the last four already identify the account to
 * its owner.
 */
function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `••••${accountNumber.slice(-4)}`;
}
