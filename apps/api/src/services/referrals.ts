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
import { millisOf, runFilteredQuery, runOrderedQuery } from '../lib/query-fallback';
import { toIso, toIsoRequired } from '../lib/time';
import { logger } from '../lib/logger';
import { idempotencyKey, postEntry, postEntryIn } from './ledger';
import { getSettings } from './settings';
import { recordSecurityEvent } from './security';
import { bumpStats } from './stats';
import { notifyReferralQualified } from './notify';
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
  /** First name of whoever's code it was, so the app can thank them by name. */
  referrerName?: string;
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
  options: { afterOnboarding?: boolean } = {},
): Promise<AttributionResult> {
  const settings = await getSettings();
  if (!settings.referrals.enabled) return { attributed: false, reason: 'DISABLED' };

  const code = referralCode.trim().toUpperCase();
  if (!code) return { attributed: false, reason: 'UNKNOWN_CODE' };

  // Already attributed: never overwrite, even if a different code arrives later.
  if (referredUser.referredBy) return { attributed: false, reason: 'ALREADY_ATTRIBUTED' };

  /*
    At signup, a user who already has a PIN is past the point where attribution
    is meaningful, and accepting a code then would let someone farm their own
    history.

    A deliberate late claim is the exception, and `claimReferralCode` is the
    only caller that passes it. That path is not laxer — it applies its own,
    stricter conditions (nothing earned yet, inside a fixed window) before ever
    getting here. What it cannot use is *this* condition, because everybody has
    a PIN within a minute of arriving.
  */
  if (!options.afterOnboarding && (referredUser.hasPin || referredUser.onboardedAt)) {
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
  return { attributed: true, referrerId: referrer.id, referrerName: referrer.firstName };
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
  /** Carried out of the transaction so the referrer can be notified. */
  referrerTelegramId?: string | undefined;
  balanceAfterKobo?: Kobo;
  qualifiedCount?: number;
}

/**
 * Qualify a pending referral and pay the referrer.
 *
 * Called at the exact moment the referred user reaches the dashboard with a PIN
 * set. The status flip, the referrer's counters and the ₦100 ledger credit all
 * commit in one Firestore transaction: there is no window in which a referral
 * reads as QUALIFIED without the money having moved, or vice versa.
 */
/**
 * Add a referral code after signing up without one.
 *
 * Most people hear about Fundxtra from a friend and then open the bot
 * directly — they search for it, or tap a link in a group, and the friend's
 * code never travels with them. The friend gets nothing, notices that
 * promoting it earned them nothing, and stops promoting it. That is how a
 * referral programme quietly dies, and it dies from a missing text box.
 *
 * So a code can be added afterwards, inside a window that makes it safe:
 *
 * - **Nothing earned yet.** The risk is an established account attributing
 *   itself to a friend for a bonus it has already worked around. Someone with
 *   a zero balance has nothing to launder.
 * - **Signed up recently.** An account dormant for months that is suddenly
 *   attributed to somebody is more likely sold than late-remembered.
 * - **Once, ever.** `referredBy` is never overwritten, here or anywhere.
 * - Self-referral, unknown codes and inactive referrers are refused by
 *   `attributeReferral`, which this delegates to rather than reimplementing.
 *
 * The joining bonus is paid in the same breath, and is a setting rather than
 * a constant precisely because it is the farmable part: a throwaway Telegram
 * account typing any code is worth exactly this much, so it must be possible
 * to drop it to zero without a deploy.
 */
export type ClaimRefusal =
  | 'DISABLED'
  | 'ALREADY_ATTRIBUTED'
  | 'WINDOW_CLOSED'
  | 'ALREADY_EARNED'
  | 'UNKNOWN_CODE'
  | 'SELF_REFERRAL'
  | 'INELIGIBLE';

export interface ClaimOutcome {
  claimed: boolean;
  reason?: ClaimRefusal;
  bonusKobo?: Kobo;
  balanceAfterKobo?: Kobo;
  referrerName?: string;
}

export async function claimReferralCode(user: User, code: string): Promise<ClaimOutcome> {
  const settings = await getSettings();
  if (!settings.referrals.enabled) return { claimed: false, reason: 'DISABLED' };

  if (user.referredBy) return { claimed: false, reason: 'ALREADY_ATTRIBUTED' };

  if (user.lifetimeEarnedKobo > 0) {
    return { claimed: false, reason: 'ALREADY_EARNED' };
  }

  const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000;
  if (ageDays > settings.referrals.lateClaimDays) {
    return { claimed: false, reason: 'WINDOW_CLOSED' };
  }

  const attribution = await attributeReferral(user, code, { afterOnboarding: true });
  if (!attribution.attributed) {
    const reason = attribution.reason;
    return {
      claimed: false,
      reason:
        reason === 'UNKNOWN_CODE' || reason === 'SELF_REFERRAL' || reason === 'ALREADY_ATTRIBUTED'
          ? reason
          : 'INELIGIBLE',
    };
  }

  /*
    The referrer is paid straight away rather than waiting for onboarding,
    because a late claimer has already onboarded — that milestone is behind
    them, and waiting for it again would mean it never arrives.
  */
  await qualifyReferral(user.id).catch((error: unknown) => {
    logger.warn({ err: error, userId: user.id }, 'Could not qualify a claimed referral');
    return { qualified: false };
  });

  const bonusKobo = settings.referrals.joinBonusKobo;
  if (bonusKobo <= 0) {
    return { claimed: true, bonusKobo: 0, referrerName: attribution.referrerName };
  }

  const entry = await postEntry({
    userId: user.id,
    type: 'BONUS',
    amountKobo: bonusKobo,
    description: 'Referral code bonus',
    // Keyed on the user, so a retry or a double tap cannot pay twice.
    idempotencyKey: idempotencyKey('join-bonus', user.id),
    metadata: { referralCode: code.trim().toUpperCase() },
  });

  logger.info({ userId: user.id, bonusKobo }, 'Referral code claimed after signup');

  return {
    claimed: true,
    bonusKobo,
    balanceAfterKobo: entry.balanceAfterKobo,
    referrerName: attribution.referrerName,
  };
}

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
      // Carried out of the transaction so the referrer can be told without a
      // second read, and so the figures quoted are the committed ones.
      referrerTelegramId: referrerSnapshot.get('telegramId') as string | undefined,
      balanceAfterKobo: entry.balanceAfterKobo,
      qualifiedCount:
        ((referrerSnapshot.get('qualifiedReferralCount') as number | undefined) ?? 0) + 1,
    };
  });

  if (result.qualified) {
    bumpStats({ totalReferralsQualified: 1, totalRewardsEarnedKobo: result.rewardKobo ?? 0 });
    logger.info(
      { referrerId: result.referrerId, referredId: referredUserId, rewardKobo: result.rewardKobo },
      'Referral qualified and reward credited',
    );

    /*
      The referrer is the one who needs telling: their friend finished
      onboarding somewhere they cannot see, and the reward arriving silently
      is how a referral programme feels broken even when it works.
    */
    if (result.referrerTelegramId) {
      notifyReferralQualified({
        telegramId: result.referrerTelegramId,
        rewardKobo: result.rewardKobo ?? 0,
        balanceAfterKobo: result.balanceAfterKobo ?? 0,
        qualifiedCount: result.qualifiedCount ?? 1,
      });
    }
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
  const limit = Math.min(options.limit ?? 50, 200);
  const base = db().collection(COLLECTIONS.referrals).where('referrerId', '==', referrerId);

  // Survives a missing composite index: see lib/query-fallback.ts. A user's
  // own referral list must not disappear because an index is still building.
  const snapshot = await runOrderedQuery({
    base,
    ordered: base.orderBy('createdAt', 'desc').limit(limit),
    limit,
    timestampOf: (data) => millisOf(data.createdAt),
    label: 'referrals by referrer, newest first',
  });

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
  const collection = db().collection(COLLECTIONS.referrals);

  // Runs inside qualification, so it must not be able to stop a referral bonus
  // from being paid while the composite index for the time window is building.
  const { docs } = await runFilteredQuery({
    narrow: collection
      .where('referrerId', '==', referrerId)
      .where('status', '==', 'QUALIFIED')
      .where('qualifiedAt', '>=', oneHourAgo),
    // Two equality filters need no composite index of their own.
    base: collection.where('referrerId', '==', referrerId).where('status', '==', 'QUALIFIED'),
    matches: (doc) => millisOf(doc.get('qualifiedAt')) >= oneHourAgo.toMillis(),
    label: 'referrals.checkReferralVelocity',
  });

  const qualifiedLastHour = docs.length;
  const suspicious = qualifiedLastHour >= 15;
  if (suspicious) {
    recordSecurityEvent({
      type: 'SUSPICIOUS_VELOCITY',
      userId: referrerId,
      message: `${qualifiedLastHour} referrals qualified in the last hour`,
      metadata: { qualifiedLastHour },
    });
    await flagUser(referrerId, 'REFERRAL_VELOCITY', 20);
  }
  return { suspicious, qualifiedLastHour };
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
