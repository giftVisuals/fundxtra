import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  formatNaira,
  referralLink as buildReferralLink,
  type Kobo,
  type Referral,
  type ReferralStatus,
  type ReferralSummary,
  type User,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { toIso, toIsoRequired } from '../lib/time';
import { logger } from '../lib/logger';
import { idempotencyKey, postEntryIn } from './ledger';
import { getSettings } from './settings';
import { recordSecurityEvent } from './security';
import { bumpStats } from './stats';
import { flagUser, findUserByReferralCode } from './users';

/**
 * Referrals.
 *
 * A referral is worth ₦100 and qualifies at exactly one moment, defined by the
 * product spec: the referred user has started Fundxtra, created their 4-digit
 * PIN, and reached the dashboard. Completing a task is explicitly *not* required.
 *
 * Three structural decisions carry the anti-abuse weight, rather than a pile of
 * runtime checks that could be bypassed:
 *
 * 1. The referral document id **is the referred user's id**. One Telegram
 *    account can therefore appear as "the referred party" exactly once, ever —
 *    duplicate attribution is impossible rather than merely guarded against.
 * 2. `users/{id}.referredBy` is written once, inside the same transaction as
 *    the referral document, and never rewritten afterwards.
 * 3. The ₦100 credit is posted through the ledger with an idempotency key
 *    derived from the pair (`referral__{referrer}__{referred}`), so even a
 *    replayed qualification cannot pay twice.
 */

export interface AttributionResult {
  attributed: boolean;
  reason?: 'SELF_REFERRAL' | 'ALREADY_ATTRIBUTED' | 'UNKNOWN_CODE' | 'DISABLED' | 'INELIGIBLE';
  referrerId?: string;
}

/**
 * Record who referred a brand-new user. Called once, on first sign-in, with the
 * referral code from the bot's `start` payload.
 *
 * Attribution deliberately happens *before* qualification: we want the pending
 * referral visible to the referrer immediately, so "1 pending" is honest
 * feedback while the friend finishes setting up their PIN.
 */
export async function attributeReferral(
  referredUser: User,
  referralCode: string,
): Promise<AttributionResult> {
  const settings = await getSettings();
  if (!settings.referrals.enabled) return { attributed: false, reason: 'DISABLED' };

  const code = referralCode.trim().toUpperCase();
  if (!code) return { attributed: false, reason: 'UNKNOWN_CODE' };

  // Already attributed: never overwrite, even if a different code arrives later.
  if (referredUser.referredBy) return { attributed: false, reason: 'ALREADY_ATTRIBUTED' };

  // A user who already has a PIN is past the point where attribution is
  // meaningful; accepting a code now would let someone farm their own history.
  if (referredUser.hasPin || referredUser.onboardedAt) {
    return { attributed: false, reason: 'INELIGIBLE' };
  }

  const referrer = await findUserByReferralCode(code);
  if (!referrer) return { attributed: false, reason: 'UNKNOWN_CODE' };

  if (referrer.id === referredUser.id || referrer.telegramId === referredUser.telegramId) {
    recordSecurityEvent({
      type: 'SELF_REFERRAL_BLOCKED',
      userId: referredUser.id,
      telegramId: referredUser.telegramId,
      message: 'User attempted to refer themselves',
      metadata: { referralCode: code },
    });
    await flagUser(referredUser.id, 'SELF_REFERRAL_ATTEMPT', 15);
    return { attributed: false, reason: 'SELF_REFERRAL' };
  }

  if (referrer.status !== 'ACTIVE') return { attributed: false, reason: 'INELIGIBLE' };

  const firestore = db();
  const referralRef = firestore.collection(COLLECTIONS.referrals).doc(referredUser.id);
  const referredRef = firestore.collection(COLLECTIONS.users).doc(referredUser.id);
  const referrerRef = firestore.collection(COLLECTIONS.users).doc(referrer.id);

  try {
    await firestore.runTransaction(async (tx) => {
      const [existingReferral, referredSnapshot] = await Promise.all([
        tx.get(referralRef),
        tx.get(referredRef),
      ]);

      if (existingReferral.exists) {
        throw new ReferralConflict('ALREADY_ATTRIBUTED');
      }
      if (referredSnapshot.get('referredBy')) {
        throw new ReferralConflict('ALREADY_ATTRIBUTED');
      }

      const now = Timestamp.now();
      tx.create(referralRef, {
        referrerId: referrer.id,
        referredId: referredUser.id,
        referredUsername: referredUser.username,
        referredFirstName: referredUser.firstName,
        status: 'PENDING' as ReferralStatus,
        rewardKobo: settings.referrals.rewardKobo,
        transactionId: null,
        rejectionReason: null,
        createdAt: now,
        qualifiedAt: null,
      });
      tx.update(referredRef, { referredBy: referrer.id, updatedAt: now });
      tx.update(referrerRef, { referralCount: FieldValue.increment(1), updatedAt: now });
    });
  } catch (error) {
    if (error instanceof ReferralConflict) {
      recordSecurityEvent({
        type: 'DUPLICATE_REFERRAL_BLOCKED',
        userId: referredUser.id,
        message: 'Duplicate referral attribution blocked',
        metadata: { referralCode: code, referrerId: referrer.id },
      });
      return { attributed: false, reason: 'ALREADY_ATTRIBUTED' };
    }
    throw error;
  }

  logger.info(
    { referrerId: referrer.id, referredId: referredUser.id },
    'Referral attributed (pending qualification)',
  );
  return { attributed: true, referrerId: referrer.id };
}

class ReferralConflict extends Error {
  constructor(readonly reason: 'ALREADY_ATTRIBUTED') {
    super(reason);
    this.name = 'ReferralConflict';
  }
}

export interface QualificationResult {
  qualified: boolean;
  rewardKobo?: Kobo;
  referrerId?: string;
  transactionId?: string;
}

/**
 * Qualify a pending referral and pay the referrer.
 *
 * Called at the exact moment the referred user reaches the dashboard with a PIN
 * set. The status flip, the referrer's counters and the ₦100 ledger credit all
 * commit in one Firestore transaction: there is no window in which a referral
 * reads as QUALIFIED without the money having moved, or vice versa.
 */
export async function qualifyReferral(referredUserId: string): Promise<QualificationResult> {
  const settings = await getSettings();
  if (!settings.referrals.enabled) return { qualified: false };

  const firestore = db();
  const referralRef = firestore.collection(COLLECTIONS.referrals).doc(referredUserId);

  const result = await firestore.runTransaction(async (tx) => {
    const referralSnapshot = await tx.get(referralRef);
    if (!referralSnapshot.exists) return { qualified: false };

    const status = referralSnapshot.get('status') as ReferralStatus;
    if (status !== 'PENDING') return { qualified: false };

    const referrerId = referralSnapshot.get('referrerId') as string;
    if (!referrerId || referrerId === referredUserId) return { qualified: false };

    const referrerRef = firestore.collection(COLLECTIONS.users).doc(referrerId);
    const referrerSnapshot = await tx.get(referrerRef);
    if (!referrerSnapshot.exists) return { qualified: false };

    // A suspended or banned referrer does not get paid, but the referral is not
    // destroyed either — an admin can settle it after review.
    if (referrerSnapshot.get('status') !== 'ACTIVE') return { qualified: false };

    const rewardKobo =
      (referralSnapshot.get('rewardKobo') as number | undefined) ?? settings.referrals.rewardKobo;

    const referredName =
      (referralSnapshot.get('referredFirstName') as string | undefined) ?? 'a friend';

    const entry = await postEntryIn(tx, {
      userId: referrerId,
      type: 'REFERRAL_REWARD',
      amountKobo: rewardKobo,
      description: `Referral reward for ${referredName}`,
      reference: referredUserId,
      // Keyed on the pair, so this credit can only ever happen once.
      idempotencyKey: idempotencyKey('referral', referrerId, referredUserId),
      metadata: { referredId: referredUserId },
    });

    const now = Timestamp.now();
    tx.update(referralRef, {
      status: 'QUALIFIED' as ReferralStatus,
      qualifiedAt: now,
      transactionId: entry.transaction.id,
    });
    tx.update(referrerRef, {
      qualifiedReferralCount: FieldValue.increment(1),
      referralEarningsKobo: FieldValue.increment(rewardKobo),
      updatedAt: now,
    });

    return {
      qualified: true,
      rewardKobo,
      referrerId,
      transactionId: entry.transaction.id,
    };
  });

  if (result.qualified) {
    bumpStats({ totalReferralsQualified: 1, totalRewardsEarnedKobo: result.rewardKobo ?? 0 });
    logger.info(
      { referrerId: result.referrerId, referredId: referredUserId, rewardKobo: result.rewardKobo },
      'Referral qualified and reward credited',
    );
  }
  return result;
}

/** Reject a pending referral (fraud review). Pays nothing. */
export async function rejectReferral(referredUserId: string, reason: string): Promise<void> {
  await db()
    .collection(COLLECTIONS.referrals)
    .doc(referredUserId)
    .update({ status: 'REJECTED' as ReferralStatus, rejectionReason: reason });
}

export async function getReferralSummary(user: User): Promise<ReferralSummary> {
  const settings = await getSettings();
  const snapshot = await db()
    .collection(COLLECTIONS.referrals)
    .where('referrerId', '==', user.id)
    .get();

  let qualified = 0;
  let pending = 0;
  for (const doc of snapshot.docs) {
    const status = doc.get('status') as ReferralStatus;
    if (status === 'QUALIFIED') qualified += 1;
    else if (status === 'PENDING') pending += 1;
  }

  return {
    referralCode: user.referralCode,
    referralLink: buildReferralLink(settings.platform.botUsername, user.referralCode),
    rewardPerReferralKobo: settings.referrals.rewardKobo,
    totalReferrals: snapshot.size,
    qualifiedReferrals: qualified,
    pendingReferrals: pending,
    earningsKobo: user.referralEarningsKobo,
  };
}

export async function listReferrals(
  referrerId: string,
  options: { limit?: number } = {},
): Promise<Referral[]> {
  const snapshot = await db()
    .collection(COLLECTIONS.referrals)
    .where('referrerId', '==', referrerId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(options.limit ?? 50, 200))
    .get();
  return snapshot.docs.map((doc) => mapReferral(doc.id, doc.data()));
}

/**
 * Velocity check for the fraud system. A burst of qualified referrals in a
 * short window is flagged for human review — never auto-banned, because a
 * genuinely popular referrer looks identical to a farm at this resolution.
 */
export async function checkReferralVelocity(referrerId: string): Promise<{
  suspicious: boolean;
  qualifiedLastHour: number;
}> {
  const oneHourAgo = Timestamp.fromMillis(Date.now() - 3_600_000);
  const snapshot = await db()
    .collection(COLLECTIONS.referrals)
    .where('referrerId', '==', referrerId)
    .where('status', '==', 'QUALIFIED')
    .where('qualifiedAt', '>=', oneHourAgo)
    .get();

  const suspicious = snapshot.size >= 15;
  if (suspicious) {
    recordSecurityEvent({
      type: 'SUSPICIOUS_VELOCITY',
      userId: referrerId,
      message: `${snapshot.size} referrals qualified in the last hour`,
      metadata: { qualifiedLastHour: snapshot.size },
    });
    await flagUser(referrerId, 'REFERRAL_VELOCITY', 20);
  }
  return { suspicious, qualifiedLastHour: snapshot.size };
}

/** Copy explaining the qualification rule. Kept here so it cannot drift. */
export function qualificationExplanation(rewardKobo: Kobo): string[] {
  return [
    'Your friend opens Fundxtra from your link',
    'They create their 4-digit PIN',
    'They reach their dashboard',
    `Your ${formatNaira(rewardKobo)} lands in your balance`,
  ];
}

export function mapReferral(id: string, data: Record<string, unknown>): Referral {
  return {
    id,
    referrerId: String(data.referrerId ?? ''),
    referredId: String(data.referredId ?? id),
    referredUsername: (data.referredUsername as string | null) ?? null,
    referredFirstName: String(data.referredFirstName ?? 'Friend'),
    status: (data.status as ReferralStatus) ?? 'PENDING',
    rewardKobo: (data.rewardKobo as number | undefined) ?? 0,
    transactionId: (data.transactionId as string | null) ?? null,
    rejectionReason: (data.rejectionReason as string | null) ?? null,
    createdAt: toIsoRequired(data.createdAt),
    qualifiedAt: toIso(data.qualifiedAt),
  };
}
