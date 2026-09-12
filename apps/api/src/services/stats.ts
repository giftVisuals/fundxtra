import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { PublicStats } from '@fundxtra/shared';
import { COLLECTIONS, DOC_IDS, db } from '../lib/firebase';
import { logger } from '../lib/logger';
import { nowIso, toIsoRequired } from '../lib/time';

/**
 * Platform statistics.
 *
 * Maintained incrementally with `FieldValue.increment` by the services that
 * cause each change, rather than recomputed by scanning collections. A
 * collection scan would grow linearly with the user base and is not something
 * the public landing page should trigger.
 *
 * `sufficientData` is the honesty switch. Below the thresholds the public site
 * shows an early-stage state instead of numbers — the brief was explicit that
 * we do not fabricate statistics, and "3 users, ₦0 paid out" is not the kind of
 * number a marketing page benefits from either.
 */

const MIN_USERS_FOR_PUBLIC_DISPLAY = 25;
const MIN_TASKS_FOR_PUBLIC_DISPLAY = 50;

function statsRef() {
  return db().collection(COLLECTIONS.counters).doc(DOC_IDS.publicStats);
}

export type StatsDelta = Partial<{
  totalUsers: number;
  totalTasksCompleted: number;
  totalPaidOutKobo: number;
  totalRewardsEarnedKobo: number;
  activeCampaigns: number;
  activeCampaignBudgetKobo: number;
  totalReferralsQualified: number;
}>;

/**
 * Apply a delta. Fire-and-forget: statistics are a reporting concern and must
 * never fail a user's action. Misses are recoverable with `recomputeStats`.
 */
export function bumpStats(delta: StatsDelta): void {
  const payload: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value === 'number' && value !== 0) payload[key] = FieldValue.increment(value);
  }
  if (Object.keys(payload).length === 1) return;

  void statsRef()
    .set(payload, { merge: true })
    .catch((error: unknown) => {
      logger.warn({ err: error, delta }, 'Failed to update platform statistics');
    });
}

export async function getPublicStats(): Promise<PublicStats> {
  const empty: PublicStats = {
    totalUsers: 0,
    totalTasksCompleted: 0,
    totalPaidOutKobo: 0,
    totalRewardsEarnedKobo: 0,
    activeCampaigns: 0,
    activeCampaignBudgetKobo: 0,
    totalReferralsQualified: 0,
    sufficientData: false,
    updatedAt: nowIso(),
  };

  try {
    const snapshot = await statsRef().get();
    const data = snapshot.data();
    if (!data) return empty;

    const number = (key: string): number => {
      const value = data[key];
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    };

    const totalUsers = number('totalUsers');
    const totalTasksCompleted = number('totalTasksCompleted');

    return {
      totalUsers,
      totalTasksCompleted,
      totalPaidOutKobo: number('totalPaidOutKobo'),
      totalRewardsEarnedKobo: number('totalRewardsEarnedKobo'),
      activeCampaigns: number('activeCampaigns'),
      activeCampaignBudgetKobo: number('activeCampaignBudgetKobo'),
      totalReferralsQualified: number('totalReferralsQualified'),
      sufficientData:
        totalUsers >= MIN_USERS_FOR_PUBLIC_DISPLAY &&
        totalTasksCompleted >= MIN_TASKS_FOR_PUBLIC_DISPLAY,
      updatedAt: toIsoRequired(data.updatedAt),
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to read platform statistics');
    return empty;
  }
}

/**
 * Recompute every counter from source collections and overwrite the cache.
 *
 * Admin-triggered, not scheduled: it scans whole collections, so it belongs
 * behind a button an operator presses when they suspect drift, not on a timer.
 */
export async function recomputeStats(): Promise<PublicStats> {
  const firestore = db();
  const [users, completions, transactions, tasks, referrals] = await Promise.all([
    firestore.collection(COLLECTIONS.users).count().get(),
    firestore.collection(COLLECTIONS.taskCompletions).count().get(),
    firestore.collection(COLLECTIONS.transactions).get(),
    firestore.collection(COLLECTIONS.tasks).where('status', '==', 'ACTIVE').get(),
    firestore.collection(COLLECTIONS.referrals).where('status', '==', 'QUALIFIED').count().get(),
  ]);

  let totalPaidOutKobo = 0;
  let totalRewardsEarnedKobo = 0;
  for (const doc of transactions.docs) {
    const status = doc.get('status');
    if (status === 'FAILED' || status === 'REVERSED') continue;
    const amount = (doc.get('amountKobo') as number | undefined) ?? 0;
    if (doc.get('direction') === 'CREDIT') totalRewardsEarnedKobo += amount;
    else totalPaidOutKobo += Math.abs(amount);
  }

  let activeCampaignBudgetKobo = 0;
  for (const doc of tasks.docs) {
    activeCampaignBudgetKobo += (doc.get('budgetKobo') as number | undefined) ?? 0;
  }

  const value = {
    totalUsers: users.data().count,
    totalTasksCompleted: completions.data().count,
    totalPaidOutKobo,
    totalRewardsEarnedKobo,
    activeCampaigns: tasks.size,
    activeCampaignBudgetKobo,
    totalReferralsQualified: referrals.data().count,
    updatedAt: Timestamp.now(),
  };

  await statsRef().set(value);
  logger.info({ stats: value }, 'Platform statistics recomputed');
  return getPublicStats();
}
