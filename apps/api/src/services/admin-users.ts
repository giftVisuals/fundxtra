import { Timestamp } from 'firebase-admin/firestore';
import {
  formatNaira,
  type Admin,
  type Kobo,
  type SignupSource,
  type User,
  type UserStatus,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { startOfPlatformDay } from '../lib/time';
import { auditUserBalance, idempotencyKey, listUserTransactions, postEntry } from './ledger';
import { recordAudit } from './audit';
import { mapUser, requireUser, setUserStatus } from './users';
import { listReferrals } from './referrals';
import { listUserWithdrawals, pendingWithdrawalTotals } from './withdrawals';
import { listUserRedemptions } from './rewards';
import { getSignupSourceCounts } from './stats';
import { newUuid } from '../lib/ids';

/**
 * Admin-side user management.
 *
 * The rule that shapes this file: **no silent financial changes.** A balance
 * adjustment requires a reason, writes an audit record *before* the money
 * moves, and produces a normal ledger entry tagged with the acting admin. An
 * admin can therefore be asked "why is this user's balance ₦5,000 higher than
 * their earnings?" and the answer is always in the data.
 */

export interface AdminUserDetail {
  user: User;
  transactions: Awaited<ReturnType<typeof listUserTransactions>>;
  referrals: Awaited<ReturnType<typeof listReferrals>>;
  withdrawals: Awaited<ReturnType<typeof listUserWithdrawals>>;
  redemptions: Awaited<ReturnType<typeof listUserRedemptions>>;
  balanceAudit: Awaited<ReturnType<typeof auditUserBalance>>;
}

/** Everything an admin needs to investigate one account. */
export async function getUserDetail(userId: string): Promise<AdminUserDetail> {
  const user = await requireUser(userId);
  const [transactions, referrals, withdrawals, redemptions, balanceAudit] = await Promise.all([
    listUserTransactions(userId, { limit: 50 }),
    listReferrals(userId, { limit: 50 }),
    listUserWithdrawals(userId, 50),
    listUserRedemptions(userId, 50),
    auditUserBalance(userId),
  ]);

  return { user, transactions, referrals, withdrawals, redemptions, balanceAudit };
}

/**
 * Search users.
 *
 * Firestore has no substring index, so search resolves an exact Telegram id,
 * username or referral code rather than pretending to do fuzzy matching. That
 * is honest about the constraint and it is what an admin actually needs when
 * working from a support ticket. Browsing without a query is a paged list.
 */
export async function searchUsers(options: {
  q?: string | undefined;
  status?: UserStatus | undefined;
  flagged?: boolean | undefined;
  limit?: number;
  cursor?: string | undefined;
}): Promise<{ items: User[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const collection = db().collection(COLLECTIONS.users);

  if (options.q) {
    const term = options.q.trim();
    const candidates: User[] = [];

    if (/^\d+$/.test(term)) {
      const byId = await collection.doc(term).get();
      if (byId.exists) candidates.push(mapUser(byId.id, byId.data() ?? {}));
    }

    const username = term.replace(/^@/, '').toLowerCase();
    const [byUsername, byCode] = await Promise.all([
      collection.where('username', '==', username).limit(5).get(),
      collection.where('referralCode', '==', term.toUpperCase()).limit(5).get(),
    ]);

    for (const doc of [...byUsername.docs, ...byCode.docs]) {
      if (!candidates.some((entry) => entry.id === doc.id)) {
        candidates.push(mapUser(doc.id, doc.data()));
      }
    }
    return { items: candidates, nextCursor: null };
  }

  let query = collection as unknown as import('firebase-admin/firestore').Query;
  if (options.status) query = query.where('status', '==', options.status);
  if (options.flagged) query = query.where('riskScore', '>', 0);
  query = query.orderBy(options.flagged ? 'riskScore' : 'createdAt', 'desc').limit(limit + 1);

  if (options.cursor) {
    const cursorDoc = await collection.doc(options.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, limit);
  const last = docs[docs.length - 1];

  return {
    items: docs.map((doc) => mapUser(doc.id, doc.data())),
    nextCursor: snapshot.docs.length > limit && last ? last.id : null,
  };
}

/**
 * Manually adjust a balance.
 *
 * The audit record is written first and awaited. If it fails, nothing moves —
 * an unrecorded financial change is not an acceptable outcome, so the ordering
 * makes it impossible.
 */
export async function adjustBalance(input: {
  userId: string;
  amountKobo: number;
  reason: string;
  actor: Admin;
  ip?: string | null;
}): Promise<{ transactionId: string; balanceAfterKobo: Kobo }> {
  const user = await requireUser(input.userId);
  const direction = input.amountKobo > 0 ? 'CREDIT' : 'DEBIT';
  const magnitude = Math.abs(input.amountKobo);

  await recordAudit({
    action: 'BALANCE_ADJUSTED',
    actor: input.actor,
    targetType: 'user',
    targetId: user.id,
    summary: `${direction === 'CREDIT' ? 'Credited' : 'Debited'} ${formatNaira(magnitude)} ${
      direction === 'CREDIT' ? 'to' : 'from'
    } ${user.firstName}`,
    before: { balanceKobo: user.balanceKobo },
    after: { balanceKobo: user.balanceKobo + input.amountKobo },
    reason: input.reason,
    ip: input.ip ?? null,
  });

  const result = await postEntry({
    userId: user.id,
    type: 'ADMIN_ADJUSTMENT',
    amountKobo: magnitude,
    direction,
    description: `Adjustment: ${input.reason}`,
    // Unique per adjustment: two identical corrections are two real events, and
    // a shared key would silently swallow the second.
    idempotencyKey: idempotencyKey('adjustment', user.id, newUuid()),
    actorAdminId: input.actor.telegramId,
    // A correction may legitimately take a spent balance negative rather than
    // leaving the platform to absorb it.
    allowNegativeBalance: direction === 'DEBIT',
    metadata: { reason: input.reason, adminId: input.actor.telegramId },
  });

  logger.warn(
    { userId: user.id, amountKobo: input.amountKobo, adminId: input.actor.telegramId },
    'Balance manually adjusted',
  );
  return { transactionId: result.transaction.id, balanceAfterKobo: result.balanceAfterKobo };
}

export async function changeUserStatus(input: {
  userId: string;
  status: UserStatus;
  reason: string;
  actor: Admin;
  ip?: string | null;
}): Promise<User> {
  const user = await requireUser(input.userId);
  if (user.status === input.status) return user;

  const action =
    input.status === 'SUSPENDED'
      ? 'USER_SUSPENDED'
      : input.status === 'BANNED'
        ? 'USER_BANNED'
        : user.status === 'BANNED'
          ? 'USER_UNBANNED'
          : 'USER_UNSUSPENDED';

  await recordAudit({
    action,
    actor: input.actor,
    targetType: 'user',
    targetId: user.id,
    summary: `${user.firstName} set to ${input.status}`,
    before: { status: user.status },
    after: { status: input.status },
    reason: input.reason,
    ip: input.ip ?? null,
  });

  await setUserStatus(user.id, input.status);
  return { ...user, status: input.status };
}

/**
 * Platform-wide figures for the admin dashboard.
 *
 * Uses aggregate counts rather than loading documents, so the dashboard cost
 * does not grow with the user base. Financial totals still need a scan of the
 * users collection, which is acceptable at this scale and is the honest way to
 * report a number that must be exact.
 */
export async function adminDashboard(): Promise<{
  users: { total: number; active: number; suspended: number; banned: number; newToday: number };
  tasks: { active: number; paused: number; expired: number; pendingSubmissions: number };
  finance: {
    totalBalanceKobo: Kobo;
    totalEarnedKobo: Kobo;
    totalPaidOutKobo: Kobo;
    pendingWithdrawalsKobo: Kobo;
    pendingWithdrawalCount: number;
    activeCampaignBudgetKobo: Kobo;
    activeCampaignRemainingKobo: Kobo;
  };
  referrals: { total: number; qualified: number; pending: number; payoutKobo: Kobo };
  risk: { flaggedUsers: number; highRiskUsers: number };
  /** Signups per channel, from the reserved `?start=` payloads. */
  signupSources: Record<SignupSource, number>;
}> {
  const firestore = db();
  const startOfToday = Timestamp.fromDate(startOfPlatformDay());

  const [
    totalUsers, activeUsers, suspendedUsers, bannedUsers, newToday,
    activeTasks, pausedTasks, expiredTasks, pendingSubmissions,
    qualifiedReferrals, pendingReferrals,
    flaggedUsers, highRiskUsers,
    pendingWithdrawals,
    signupSources,
    userDocs, taskDocs,
  ] = await Promise.all([
    firestore.collection(COLLECTIONS.users).count().get(),
    firestore.collection(COLLECTIONS.users).where('status', '==', 'ACTIVE').count().get(),
    firestore.collection(COLLECTIONS.users).where('status', '==', 'SUSPENDED').count().get(),
    firestore.collection(COLLECTIONS.users).where('status', '==', 'BANNED').count().get(),
    firestore.collection(COLLECTIONS.users).where('createdAt', '>=', startOfToday).count().get(),
    firestore.collection(COLLECTIONS.tasks).where('status', '==', 'ACTIVE').count().get(),
    firestore.collection(COLLECTIONS.tasks).where('status', '==', 'PAUSED').count().get(),
    firestore.collection(COLLECTIONS.tasks).where('status', '==', 'EXPIRED').count().get(),
    firestore
      .collection(COLLECTIONS.taskSubmissions)
      .where('status', '==', 'PENDING_REVIEW')
      .count()
      .get(),
    firestore.collection(COLLECTIONS.referrals).where('status', '==', 'QUALIFIED').count().get(),
    firestore.collection(COLLECTIONS.referrals).where('status', '==', 'PENDING').count().get(),
    firestore.collection(COLLECTIONS.users).where('riskScore', '>', 0).count().get(),
    firestore.collection(COLLECTIONS.users).where('riskScore', '>=', 60).count().get(),
    pendingWithdrawalTotals(),
    getSignupSourceCounts(),
    firestore.collection(COLLECTIONS.users).get(),
    firestore.collection(COLLECTIONS.tasks).where('status', '==', 'ACTIVE').get(),
  ]);

  let totalBalanceKobo = 0;
  let totalEarnedKobo = 0;
  let totalPaidOutKobo = 0;
  let referralPayoutKobo = 0;
  for (const doc of userDocs.docs) {
    totalBalanceKobo += (doc.get('balanceKobo') as number | undefined) ?? 0;
    totalEarnedKobo += (doc.get('lifetimeEarnedKobo') as number | undefined) ?? 0;
    totalPaidOutKobo += (doc.get('lifetimePaidOutKobo') as number | undefined) ?? 0;
    referralPayoutKobo += (doc.get('referralEarningsKobo') as number | undefined) ?? 0;
  }

  let activeCampaignBudgetKobo = 0;
  let activeCampaignRemainingKobo = 0;
  for (const doc of taskDocs.docs) {
    const budget = (doc.get('budgetKobo') as number | undefined) ?? 0;
    const spent = (doc.get('spentKobo') as number | undefined) ?? 0;
    activeCampaignBudgetKobo += budget;
    activeCampaignRemainingKobo += Math.max(0, budget - spent);
  }

  return {
    users: {
      total: totalUsers.data().count,
      active: activeUsers.data().count,
      suspended: suspendedUsers.data().count,
      banned: bannedUsers.data().count,
      newToday: newToday.data().count,
    },
    tasks: {
      active: activeTasks.data().count,
      paused: pausedTasks.data().count,
      expired: expiredTasks.data().count,
      pendingSubmissions: pendingSubmissions.data().count,
    },
    finance: {
      totalBalanceKobo,
      totalEarnedKobo,
      totalPaidOutKobo,
      pendingWithdrawalsKobo: pendingWithdrawals.kobo,
      pendingWithdrawalCount: pendingWithdrawals.count,
      activeCampaignBudgetKobo,
      activeCampaignRemainingKobo,
    },
    referrals: {
      total: qualifiedReferrals.data().count + pendingReferrals.data().count,
      qualified: qualifiedReferrals.data().count,
      pending: pendingReferrals.data().count,
      payoutKobo: referralPayoutKobo,
    },
    risk: {
      flaggedUsers: flaggedUsers.data().count,
      highRiskUsers: highRiskUsers.data().count,
    },
    signupSources,
  };
}

/** Guard so an admin cannot act on an account that does not exist. */
export async function assertUserExists(userId: string): Promise<User> {
  try {
    return await requireUser(userId);
  } catch {
    throw new AppError('NOT_FOUND', { message: 'We could not find that account.' });
  }
}
