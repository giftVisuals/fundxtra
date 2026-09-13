import { Timestamp } from 'firebase-admin/firestore';
import { BLOCKED_PINS, ERROR_CODES, LIMITS } from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { AppError } from '../lib/errors';
import { runFilteredQuery } from '../lib/query-fallback';
import { hashPin, needsRehash, verifyPin } from '../lib/pin';
import { logger } from '../lib/logger';
import { minutesFromNow, toIso } from '../lib/time';
import { recordSecurityEvent } from './security';

/**
 * PIN lifecycle.
 *
 * The hash lives in its own `pins/{userId}` collection rather than on the user
 * document. That separation is deliberate: any query or export that reads user
 * profiles — an admin list, a stats job, a debug dump — cannot accidentally
 * carry PIN material with it, and Firestore rules can deny the collection
 * outright without also locking the user document.
 *
 * Lockout state is persisted, not held in memory. A restart or redeploy must
 * not hand an attacker a fresh set of attempts.
 */

interface PinRecord {
  hash: string;
  failedAttempts: number;
  lockedUntil: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastVerifiedAt: Timestamp | null;
  resetByAdminId: string | null;
}

function pinRef(userId: string) {
  return db().collection(COLLECTIONS.pins).doc(userId);
}

export interface PinStatus {
  hasPin: boolean;
  locked: boolean;
  lockedUntil: string | null;
  attemptsRemaining: number;
}

export async function getPinStatus(userId: string): Promise<PinStatus> {
  const snapshot = await pinRef(userId).get();
  if (!snapshot.exists) {
    return { hasPin: false, locked: false, lockedUntil: null, attemptsRemaining: LIMITS.MAX_PIN_ATTEMPTS };
  }

  const lockedUntil = snapshot.get('lockedUntil') as Timestamp | null;
  const failedAttempts = (snapshot.get('failedAttempts') as number | undefined) ?? 0;
  const locked = Boolean(lockedUntil && lockedUntil.toMillis() > Date.now());

  return {
    hasPin: true,
    locked,
    lockedUntil: locked ? toIso(lockedUntil) : null,
    attemptsRemaining: Math.max(0, LIMITS.MAX_PIN_ATTEMPTS - failedAttempts),
  };
}

/**
 * Create the user's first PIN.
 *
 * Uses `create()` so a double-submitted form cannot replace an existing PIN —
 * that would be a trivial account-takeover path if an attacker ever reached the
 * endpoint with a valid session.
 */
export async function createPin(userId: string, pin: string): Promise<void> {
  assertPinAcceptable(pin);

  const hash = await hashPin(pin);
  const now = Timestamp.now();

  try {
    await pinRef(userId).create({
      hash,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
      lastVerifiedAt: now,
      resetByAdminId: null,
    } satisfies PinRecord);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 6) throw new AppError(ERROR_CODES.PIN_ALREADY_SET);
    throw error;
  }

  await db()
    .collection(COLLECTIONS.users)
    .doc(userId)
    .update({ hasPin: true, updatedAt: now });

  recordSecurityEvent({ type: 'PIN_CREATED', userId, message: 'User created their PIN' });
}

/**
 * Verify a PIN, applying and maintaining the lockout.
 *
 * The counter increments *before* the answer is returned, and a correct PIN
 * clears it. A locked account is refused without the hash even being compared,
 * so lockout costs an attacker the full wait rather than just a slower reply.
 */
export async function checkPin(userId: string, pin: string): Promise<void> {
  const ref = pinRef(userId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError(ERROR_CODES.PIN_REQUIRED);

  const lockedUntil = snapshot.get('lockedUntil') as Timestamp | null;
  if (lockedUntil && lockedUntil.toMillis() > Date.now()) {
    throw new AppError(ERROR_CODES.PIN_LOCKED, {
      detail: `locked until ${lockedUntil.toDate().toISOString()}`,
    });
  }

  const hash = snapshot.get('hash') as string | undefined;
  if (!hash) throw new AppError(ERROR_CODES.PIN_REQUIRED, { detail: 'pin record has no hash' });

  const valid = await verifyPin(pin, hash);

  if (!valid) {
    const failedAttempts = ((snapshot.get('failedAttempts') as number | undefined) ?? 0) + 1;
    const shouldLock = failedAttempts >= LIMITS.MAX_PIN_ATTEMPTS;

    await ref.update({
      failedAttempts,
      lockedUntil: shouldLock ? Timestamp.fromDate(minutesFromNow(LIMITS.PIN_LOCK_MINUTES)) : null,
      updatedAt: Timestamp.now(),
    });

    if (shouldLock) {
      recordSecurityEvent({
        type: 'PIN_LOCKED',
        userId,
        message: `PIN locked after ${failedAttempts} failed attempts`,
        metadata: { failedAttempts, lockMinutes: LIMITS.PIN_LOCK_MINUTES },
      });
      throw new AppError(ERROR_CODES.PIN_LOCKED);
    }

    recordSecurityEvent({
      type: 'PIN_FAILED',
      userId,
      message: 'Incorrect PIN entered',
      metadata: { failedAttempts, attemptsRemaining: LIMITS.MAX_PIN_ATTEMPTS - failedAttempts },
    });
    throw new AppError(ERROR_CODES.PIN_INVALID, {
      detail: `attempt ${failedAttempts} of ${LIMITS.MAX_PIN_ATTEMPTS}`,
    });
  }

  // Success: clear the counter and opportunistically upgrade a weak hash.
  const patch: Record<string, unknown> = {
    failedAttempts: 0,
    lockedUntil: null,
    lastVerifiedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  if (needsRehash(hash)) {
    patch.hash = await hashPin(pin);
    logger.info({ userId }, 'Upgraded PIN hash to current cost parameters');
  }
  await ref.update(patch);
}

export async function changePin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<void> {
  assertPinAcceptable(newPin);
  // Reuses the full lockout path, so brute-forcing the current PIN through the
  // change endpoint is no cheaper than through the unlock screen.
  await checkPin(userId, currentPin);

  await pinRef(userId).update({
    hash: await hashPin(newPin),
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: Timestamp.now(),
  });

  recordSecurityEvent({ type: 'PIN_CHANGED', userId, message: 'User changed their PIN' });
}

/**
 * Admin PIN reset.
 *
 * Deletes the hash rather than setting a known value, so the user creates a
 * fresh PIN on next open and no admin ever knows a user's PIN. Support flow:
 * "Forgot your PIN? Contact Fundxtra Support."
 */
export async function resetPinByAdmin(userId: string, adminId: string): Promise<void> {
  const now = Timestamp.now();
  await db().runTransaction(async (tx) => {
    tx.delete(pinRef(userId));
    tx.update(db().collection(COLLECTIONS.users).doc(userId), {
      hasPin: false,
      updatedAt: now,
    });
  });

  recordSecurityEvent({
    type: 'PIN_RESET_BY_ADMIN',
    userId,
    message: 'PIN reset by an administrator',
    metadata: { adminId },
  });
}

/** Clear a lockout without touching the PIN itself. */
export async function unlockPin(userId: string, adminId: string): Promise<void> {
  await pinRef(userId).update({
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: Timestamp.now(),
    resetByAdminId: adminId,
  });
}

function assertPinAcceptable(pin: string): void {
  if (!new RegExp(`^\\d{${LIMITS.PIN_LENGTH}}$`).test(pin)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { pin: `PIN must be exactly ${LIMITS.PIN_LENGTH} digits` },
    });
  }
  if (BLOCKED_PINS.includes(pin)) {
    throw new AppError(ERROR_CODES.PIN_WEAK, { fields: { pin: 'Choose a less predictable PIN' } });
  }
}

/** Count failed PIN attempts across the platform, for the fraud dashboard. */
export async function recentPinFailures(minutes = 60): Promise<number> {
  const since = Timestamp.fromMillis(Date.now() - minutes * 60_000);
  const collection = db().collection(COLLECTIONS.securityEvents);
  const types = new Set(['PIN_FAILED', 'PIN_LOCKED']);

  const { docs } = await runFilteredQuery({
    narrow: collection.where('type', 'in', [...types]).where('createdAt', '>=', since),
    // A range on one field alone is served by the automatic single-field index.
    base: collection.where('createdAt', '>=', since),
    matches: (doc) => types.has(doc.get('type') as string),
    label: 'auth.recentPinFailures',
  });
  return docs.length;
}
