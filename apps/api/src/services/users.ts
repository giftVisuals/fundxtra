import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  referralLink as buildReferralLink,
  type AccountFlag,
  type DashboardSummary,
  type RiskBand,
  type SignupSource,
  type User,
  type UserProfile,
  type UserStatus,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { AppError, notFound } from '../lib/errors';
import { newReferralCode } from '../lib/ids';
import { nowIso, toIso, toIsoRequired } from '../lib/time';
import { logger } from '../lib/logger';
import type { TelegramUser } from '../lib/telegram-auth';
import { getSettings, withdrawalAvailability } from './settings';
import { bumpStats, countSignup } from './stats';
import { sumTodayCredits } from './ledger';

/**
 * Users.
 *
 * The document id is the Telegram id. That choice does most of the abuse
 * prevention work for free: one Telegram account can only ever be one Fundxtra
 * account, so "multiple referral rewards for one Telegram account" is not a
 * race to be won but a structural impossibility. `create()` on a
 * deterministically-named document also means two simultaneous first-opens
 * cannot produce two users.
 */

export async function findUser(userId: string): Promise<User | null> {
  const snapshot = await db().collection(COLLECTIONS.users).doc(userId).get();
  return snapshot.exists ? mapUser(snapshot.id, snapshot.data() ?? {}) : null;
}

export async function requireUser(userId: string): Promise<User> {
  const user = await findUser(userId);
  if (!user) throw notFound('that account', `user ${userId} not found`);
  return user;
}

/** Reject suspended and banned accounts before any state-changing action. */
export function assertUsable(user: User): void {
  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
  if (user.status === 'BANNED') throw new AppError('ACCOUNT_BANNED');
}

export interface FindOrCreateResult {
  user: User;
  created: boolean;
}

/**
 * Resolve a verified Telegram identity to a Fundxtra user, creating it on first
 * contact. Profile fields are refreshed on every sign-in, since a user can
 * change their Telegram name or username at any time.
 */
export async function findOrCreateUser(
  telegramUser: TelegramUser,
  options: { referralCodeFromStartParam?: string | null; signupSource?: SignupSource | null } = {},
): Promise<FindOrCreateResult> {
  const userId = String(telegramUser.id);
  const firestore = db();
  const ref = firestore.collection(COLLECTIONS.users).doc(userId);

  const result = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const now = Timestamp.now();

    const profilePatch = {
      username: telegramUser.username?.toLowerCase() ?? null,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name ?? null,
      languageCode: telegramUser.language_code ?? null,
      photoUrl: telegramUser.photo_url ?? null,
      isPremiumTelegram: Boolean(telegramUser.is_premium),
      lastSeenAt: now,
      updatedAt: now,
    };

    if (snapshot.exists) {
      tx.update(ref, profilePatch);
      return {
        user: mapUser(userId, { ...(snapshot.data() ?? {}), ...profilePatch }),
        created: false,
      };
    }

    const record = {
      telegramId: userId,
      ...profilePatch,
      status: 'ACTIVE' as UserStatus,
      hasPin: false,
      onboardedAt: null,
      balanceKobo: 0,
      lifetimeEarnedKobo: 0,
      lifetimePaidOutKobo: 0,
      pendingOutKobo: 0,
      tasksCompleted: 0,
      referralCode: newReferralCode(),
      // Attribution is recorded here and never changed afterwards.
      referredBy: null as string | null,
      referralCount: 0,
      qualifiedReferralCount: 0,
      referralEarningsKobo: 0,
      /*
        Which channel this signup arrived through, from a reserved `?start=`
        payload such as `website`. Written once at creation and never changed:
        a later visit through a different link does not rewrite where someone
        originally came from.
      */
      signupSource: options.signupSource ?? null,
      riskScore: 0,
      riskBand: 'LOW' as RiskBand,
      flags: [] as AccountFlag[],
      createdAt: now,
    };

    // `create` rather than `set`: two simultaneous first-opens must not both
    // succeed in writing a fresh user over each other.
    tx.create(ref, record);
    return { user: mapUser(userId, record), created: true };
  });

  if (result.created) {
    bumpStats({ totalUsers: 1 });
    if (options.signupSource) countSignup(options.signupSource);
    logger.info({ userId, username: result.user.username }, 'New Fundxtra user created');
  }
  return result;
}

/**
 * Mark the user as onboarded.
 *
 * This is the referral qualification gate. It is called once the user has a PIN
 * and has actually reached the dashboard — not when they merely opened the bot —
 * and returns whether this call was the transition, so the caller knows whether
 * to fire the referral reward exactly once.
 */
export async function markOnboarded(userId: string): Promise<{ transitioned: boolean }> {
  const ref = db().collection(COLLECTIONS.users).doc(userId);
  return db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound('that account');
    if (snapshot.get('onboardedAt')) return { transitioned: false };

    tx.update(ref, { onboardedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    return { transitioned: true };
  });
}

export async function findUserByReferralCode(code: string): Promise<User | null> {
  const snapshot = await db()
    .collection(COLLECTIONS.users)
    .where('referralCode', '==', code.toUpperCase())
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  return doc ? mapUser(doc.id, doc.data()) : null;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const snapshot = await db()
    .collection(COLLECTIONS.users)
    .where('username', '==', username.replace(/^@/, '').toLowerCase())
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  return doc ? mapUser(doc.id, doc.data()) : null;
}

export async function setUserStatus(userId: string, status: UserStatus): Promise<void> {
  await db()
    .collection(COLLECTIONS.users)
    .doc(userId)
    .update({ status, updatedAt: Timestamp.now() });
}

/** Add a flag and raise the risk score. Flags never auto-ban; they queue review. */
export async function flagUser(
  userId: string,
  flag: AccountFlag,
  riskIncrement = 10,
): Promise<void> {
  const ref = db().collection(COLLECTIONS.users).doc(userId);
  await db().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;

    const score = Math.min(100, ((snapshot.get('riskScore') as number) ?? 0) + riskIncrement);
    tx.update(ref, {
      flags: FieldValue.arrayUnion(flag),
      riskScore: score,
      riskBand: riskBandFor(score),
      updatedAt: Timestamp.now(),
    });
  });
}

export async function clearFlag(userId: string, flag: AccountFlag): Promise<void> {
  await db()
    .collection(COLLECTIONS.users)
    .doc(userId)
    .update({ flags: FieldValue.arrayRemove(flag), updatedAt: Timestamp.now() });
}

export function riskBandFor(score: number): RiskBand {
  if (score >= 60) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

/** The user shape sent to the Mini App. Nothing internal crosses this boundary. */
export function toProfile(user: User, botUsername: string): UserProfile {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    status: user.status,
    hasPin: user.hasPin,
    balanceKobo: user.balanceKobo,
    pendingOutKobo: user.pendingOutKobo,
    lifetimeEarnedKobo: user.lifetimeEarnedKobo,
    tasksCompleted: user.tasksCompleted,
    referralCode: user.referralCode,
    referralLink: buildReferralLink(botUsername, user.referralCode),
    referralCount: user.referralCount,
    qualifiedReferralCount: user.qualifiedReferralCount,
    referralEarningsKobo: user.referralEarningsKobo,
    createdAt: user.createdAt,
  };
}

/** Everything the dashboard needs, in one round trip. */
export async function buildDashboard(user: User): Promise<DashboardSummary> {
  const settings = await getSettings();
  const availability = withdrawalAvailability(settings);

  const [today, availableTasks, pendingSubmissions] = await Promise.all([
    sumTodayCredits(user.id),
    db()
      .collection(COLLECTIONS.tasks)
      .where('status', '==', 'ACTIVE')
      .count()
      .get()
      .then((result) => result.data().count)
      .catch(() => 0),
    db()
      .collection(COLLECTIONS.taskSubmissions)
      .where('userId', '==', user.id)
      .where('status', '==', 'PENDING_REVIEW')
      .count()
      .get()
      .then((result) => result.data().count)
      .catch(() => 0),
  ]);

  return {
    user: toProfile(user, settings.platform.botUsername),
    todayEarnedKobo: today.kobo,
    tasksCompletedToday: today.count,
    availableTaskCount: availableTasks,
    pendingSubmissionCount: pendingSubmissions,
    withdrawalsOpen: availability.open,
    withdrawalNotice: availability.reason,
  };
}

export function mapUser(id: string, data: Record<string, unknown>): User {
  return {
    id,
    telegramId: String(data.telegramId ?? id),
    username: (data.username as string | null) ?? null,
    firstName: String(data.firstName ?? 'Friend'),
    lastName: (data.lastName as string | null) ?? null,
    languageCode: (data.languageCode as string | null) ?? null,
    photoUrl: (data.photoUrl as string | null) ?? null,
    isPremiumTelegram: Boolean(data.isPremiumTelegram),
    status: (data.status as UserStatus) ?? 'ACTIVE',
    hasPin: Boolean(data.hasPin),
    onboardedAt: toIso(data.onboardedAt),
    balanceKobo: (data.balanceKobo as number | undefined) ?? 0,
    lifetimeEarnedKobo: (data.lifetimeEarnedKobo as number | undefined) ?? 0,
    lifetimePaidOutKobo: (data.lifetimePaidOutKobo as number | undefined) ?? 0,
    pendingOutKobo: (data.pendingOutKobo as number | undefined) ?? 0,
    tasksCompleted: (data.tasksCompleted as number | undefined) ?? 0,
    referralCode: String(data.referralCode ?? ''),
    referredBy: (data.referredBy as string | null) ?? null,
    signupSource: (data.signupSource as SignupSource | null) ?? null,
    referralCount: (data.referralCount as number | undefined) ?? 0,
    qualifiedReferralCount: (data.qualifiedReferralCount as number | undefined) ?? 0,
    referralEarningsKobo: (data.referralEarningsKobo as number | undefined) ?? 0,
    riskScore: (data.riskScore as number | undefined) ?? 0,
    riskBand: (data.riskBand as RiskBand) ?? 'LOW',
    flags: (data.flags as AccountFlag[]) ?? [],
    createdAt: toIsoRequired(data.createdAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
    lastSeenAt: toIsoRequired(data.lastSeenAt, nowIso()),
  };
}
