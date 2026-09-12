import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isReservedReferralCode } from '@fundxtra/shared';

/**
 * Identifier generation.
 *
 * Two kinds of id exist here and the distinction matters:
 *
 * - **Random** ids (`newId`) for entities where collision is the only concern.
 * - **Deterministic** ids (`deterministicId`) for documents whose *existence*
 *   is a uniqueness constraint. A task completion keyed `${userId}__${taskId}`
 *   cannot be created twice, which is what makes duplicate rewards impossible
 *   under concurrency - Firestore `create()` fails rather than overwriting.
 */

/** URL-safe random id with a sortable timestamp prefix: `tx_1a2b3c...`. */
export function newId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const random = randomBytes(8).toString('hex');
  return `${prefix}_${stamp}${random}`;
}

export const newTransactionId = () => newId('tx');
export const newWithdrawalId = () => newId('wd');
export const newRedemptionId = () => newId('rd');
export const newSubmissionId = () => newId('sub');
export const newTaskId = () => newId('task');
export const newAuditId = () => newId('log');
export const newEventId = () => newId('evt');
export const newAnnouncementId = () => newId('ann');

/** Stable id built from its parts. The same inputs always produce the same id. */
export function deterministicId(...parts: string[]): string {
  return parts.map((part) => part.replace(/[^\w-]/g, '_')).join('__');
}

/** Short hash, for keys that would otherwise exceed Firestore id limits. */
export function hashedId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('::')).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Referral code: 8 characters from an alphabet with no 0/O/1/I/L, because
 * these codes get typed by hand and read aloud.
 */
export function newReferralCode(): string {
  // Bounded rather than `while (true)`: reserved words are a handful out of
  // 32^8, so a second draw is already unreachable in practice, and a loop with
  // no ceiling in code that runs on every signup is a hang waiting to happen.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = randomBytes(8);
    let code = '';
    for (let index = 0; index < 8; index += 1) {
      const byte = bytes[index] ?? 0;
      code += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
    }
    // A code equal to a reserved channel word would be read as a channel
    // before any referrer lookup, so its owner would never be credited for a
    // referral. See isReservedReferralCode.
    if (!isReservedReferralCode(code)) return code;
  }
  // Unreachable in practice; a deterministic suffix beats returning a code
  // that is known to be unusable.
  return `${REFERRAL_ALPHABET[0] ?? 'A'}${randomBytes(4).toString('hex').toUpperCase()}`;
}

export const newUuid = (): string => randomUUID();

/** Random token for signed URLs and one-time links. */
export const newToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
