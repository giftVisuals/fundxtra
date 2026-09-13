import { ERROR_CODES, LIMITS, TRANSACTION_LABELS, formatNaira, type User } from '@fundxtra/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { sendBotPhoto, TelegramApiError } from '../lib/telegram-bot';
import { getTransactionReceipt } from './ledger';
import { getSettings } from './settings';

/**
 * Deliver a receipt into the user's own Telegram chat.
 *
 * Telegram's in-app browser will not save a file. Not "sometimes fails" —
 * downloads are inert there, so a Mini App cannot hand the user a copy of
 * anything, and the share sheet is not offered on every build either. The way
 * out is the one channel that was always going to work: the bot posts the
 * receipt into the chat the user is already in. Telegram then keeps it
 * forever, and saving it to the gallery is the viewer's own menu item.
 *
 * The image is painted by the app, because the receipt is drawn on a canvas
 * and there is no canvas on the server. That means the bytes arrive from the
 * client, so two rules hold:
 *
 *  - It is only ever sent to the requester's own chat. The destination comes
 *    from the session, never from the request, so this cannot be used to push
 *    an image at anybody else.
 *  - The caption is composed here from the stored transaction. Whatever the
 *    picture shows, the words underneath are the platform's own record, and
 *    reading the transaction is also what proves the caller owns it —
 *    `getTransactionReceipt` answers "not found" for someone else's id.
 */
export interface ReceiptDelivery {
  delivered: true;
  /** Where it landed, so the app can tell the user where to look. */
  chat: string;
}

export async function sendReceiptToTelegram(options: {
  user: User;
  transactionId: string;
  image: Buffer;
  declaredMimeType: string;
}): Promise<ReceiptDelivery> {
  assertPng(options.image, options.declaredMimeType);

  // Also the ownership check: this throws NOT_FOUND for another user's id.
  const receipt = await getTransactionReceipt(options.user.id, options.transactionId);
  const settings = await getSettings();

  const { transaction, withdrawal } = receipt;
  const amountKobo = withdrawal ? withdrawal.amountKobo : Math.abs(transaction.amountKobo);
  const reference = withdrawal ? withdrawal.id : transaction.id;

  const caption = [
    `🧾 <b>${withdrawal ? 'Withdrawal receipt' : 'Transaction receipt'}</b>`,
    '',
    `${withdrawal ? '' : transaction.direction === 'CREDIT' ? '+' : '-'}<b>${formatNaira(amountKobo)}</b> · ${statusWord(receipt)}`,
    withdrawal
      ? `${escape(withdrawal.bankName)} · ${escape(maskAccount(withdrawal.accountNumber))}`
      : escape(TRANSACTION_LABELS[transaction.type]),
    '',
    `Reference: <code>${escape(reference)}</code>`,
    '',
    'Saved here for you. Tap the image, then use Save to Gallery to keep a copy.',
  ].join('\n');

  try {
    await sendBotPhoto({
      chatId: options.user.telegramId,
      bytes: options.image,
      filename: `fundxtra-receipt-${reference}.png`,
      caption,
    });
  } catch (error) {
    throw toUserFacingError(error, settings.platform.botUsername);
  }

  logger.info({ userId: options.user.id, transactionId: options.transactionId }, 'Receipt delivered to Telegram');
  return { delivered: true, chat: `@${settings.platform.botUsername}` };
}

/**
 * Check the bytes really are a PNG, by their first eight.
 *
 * The declared content type is whatever the client typed, so it is checked
 * only to fail early with a clearer message — the signature is the part that
 * decides. The app paints this image itself, so anything that is not a PNG is
 * either a broken client or somebody poking at the endpoint.
 */
function assertPng(image: Buffer, declaredMimeType: string): void {
  if (image.byteLength === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { receipt: 'The receipt image was empty' },
    });
  }
  if (image.byteLength > LIMITS.MAX_RECEIPT_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { receipt: 'That receipt image is too large' },
    });
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!image.subarray(0, 8).equals(signature)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { receipt: 'That file is not a receipt image' },
      detail: `declared ${declaredMimeType}, signature did not match PNG`,
    });
  }
}

/**
 * Turn a Telegram refusal into something the user can act on.
 *
 * "Bot was blocked" and "chat not found" are the two that are not our fault
 * and not a mystery: the user has never pressed Start, or has blocked the bot.
 * Telling them that is a fix they can perform in five seconds; "something went
 * wrong" is not.
 */
function toUserFacingError(error: unknown, botUsername: string): AppError {
  if (error instanceof TelegramApiError) {
    const description = error.description.toLowerCase();
    if (
      error.errorCode === 403 ||
      description.includes('blocked') ||
      description.includes('chat not found')
    ) {
      return new AppError(ERROR_CODES.VALIDATION_FAILED, {
        message: `Open your chat with @${botUsername} and tap Start, then try again.`,
        detail: error.description,
      });
    }
    logger.warn({ err: error }, 'Telegram refused the receipt');
    return new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
      message: 'Telegram would not take the receipt just now. Please try again shortly.',
      detail: error.description,
    });
  }

  logger.error({ err: error }, 'Receipt delivery failed');
  return new AppError(ERROR_CODES.INTERNAL);
}

function statusWord(receipt: Awaited<ReturnType<typeof getTransactionReceipt>>): string {
  if (receipt.withdrawal) {
    const map: Record<string, string> = {
      PENDING: 'Queued for review',
      PROCESSING: 'Being paid',
      PAID: 'Paid',
      FAILED: 'Failed',
      REJECTED: 'Rejected',
      CANCELLED: 'Cancelled',
    };
    return map[receipt.withdrawal.status] ?? receipt.withdrawal.status;
  }
  return receipt.transaction.status === 'COMPLETED' ? 'Completed' : receipt.transaction.status;
}

/** Same masking the app shows: enough to recognise, not enough to reuse. */
function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `••••${accountNumber.slice(-4)}`;
}

/** Telegram's HTML parse mode needs these three escaped, and only these. */
function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
