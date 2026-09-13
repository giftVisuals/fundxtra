import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ERROR_CODES,
  LIMITS,
  assertPositiveKobo,
  isTaskSlug,
  percentageOf,
  toTaskSlug,
  type CreateTaskInput,
  type Kobo,
  type Task,
  type TaskBudgetView,
  type TaskCategory,
  type TaskListItem,
  type TaskStatus,
  type TaskSponsor,
  type VerificationMethod,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { SharedCache, Throttle } from '../lib/cache';
import { AppError, notFound } from '../lib/errors';
import { deterministicId, newTaskId } from '../lib/ids';
import { logger } from '../lib/logger';
import { millisOf, runFilteredQuery } from '../lib/query-fallback';
import { isFuture, isPast, nowIso, toIso, toIsoRequired } from '../lib/time';
import { probeChatAccess } from '../lib/telegram-bot';
import { getSettings } from './settings';
import { bumpStats } from './stats';

/**
 * Tasks and campaign budgets.
 *
 * The budget is the safety mechanism that stops a campaign from paying out more
 * than the sponsor funded, so it is handled with the same care as the ledger:
 *
 * - `spentKobo` counts **approved completions plus pending submissions**. A
 *   screenshot awaiting review already has a claim on the budget; if it did not,
 *   an admin could approve a queue of submissions that collectively exceed the
 *   funded amount.
 * - Budget is reserved inside the same Firestore transaction that records the
 *   completion or submission, so two users claiming the last reward cannot both
 *   succeed.
 * - A task auto-pauses the moment its remaining budget can no longer cover one
 *   more reward, or its completion cap is reached.
 * - The ₦1,000 per-task ceiling is enforced here, server-side. The admin UI also
 *   shows it, but the UI is not what enforces it.
 */

export interface TaskAvailability {
  available: boolean;
  reason?:
    | 'NOT_ACTIVE'
    | 'NOT_STARTED'
    | 'ENDED'
    | 'BUDGET_EXHAUSTED'
    | 'COMPLETIONS_EXHAUSTED';
}

/** Whether a task can accept one more completion right now. */
/**
 * The live campaign list, shared by everybody.
 *
 * This is the single biggest read in the platform and it is the *same answer*
 * for every user — campaigns do not differ by who is asking, only the per-user
 * state layered on top does. Read per request, twenty campaigns cost twenty
 * reads every time anyone opens the Earn tab; ten thousand users doing that
 * once an hour is two hundred thousand reads an hour for a list that changed
 * maybe twice a day.
 *
 * Cached for a minute instead. A campaign that appears up to sixty seconds
 * late is not a problem anybody can perceive; the parts that must be exact —
 * whether the budget is spent, whether this user already completed it — are
 * re-read inside the completion transaction, which is the only place being
 * wrong would cost money.
 *
 * Anything that edits a campaign calls `invalidateTaskCache`, so admin changes
 * show up immediately rather than a minute later.
 */
const taskListCache = new SharedCache<{ id: string; data: Record<string, unknown> }[]>(
  60_000,
  'tasks',
);

/**
 * How many campaigns are live, from the shared cache.
 *
 * Every dashboard shows this and it is identical for everyone, so it has no
 * business being its own query per user.
 */
export async function countActiveTasks(): Promise<number> {
  const docs = await listLiveTaskDocs();
  return docs.filter((doc) => doc.data.status === 'ACTIVE').length;
}

export function invalidateTaskCache(): void {
  taskListCache.invalidate();
}

async function listLiveTaskDocs(): Promise<{ id: string; data: Record<string, unknown> }[]> {
  return taskListCache.get(async () => {
    const snapshot = await db()
      .collection(COLLECTIONS.tasks)
      .where('status', 'in', ['ACTIVE', 'COMPLETED'])
      .limit(120)
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  });
}

export function taskAvailability(task: Task): TaskAvailability {
  // COMPLETED specifically means "fully claimed" in this system, so it earns
  // the accurate, encouraging message ("this campaign is fully claimed, more
  // tasks are on the way") rather than the generic "no longer available".
  if (task.status === 'COMPLETED') return { available: false, reason: 'BUDGET_EXHAUSTED' };
  if (task.status !== 'ACTIVE') return { available: false, reason: 'NOT_ACTIVE' };
  if (task.startsAt && isFuture(task.startsAt)) return { available: false, reason: 'NOT_STARTED' };
  if (task.endsAt && isPast(task.endsAt)) return { available: false, reason: 'ENDED' };

  const claimed = task.completionCount + task.pendingCount;
  if (claimed >= task.maxCompletions) {
    return { available: false, reason: 'COMPLETIONS_EXHAUSTED' };
  }
  if (task.budgetKobo - task.spentKobo < task.rewardKobo) {
    return { available: false, reason: 'BUDGET_EXHAUSTED' };
  }
  return { available: true };
}

export function budgetView(task: Task): TaskBudgetView {
  const remainingKobo = Math.max(0, task.budgetKobo - task.spentKobo);
  return {
    rewardKobo: task.rewardKobo,
    budgetKobo: task.budgetKobo,
    spentKobo: task.spentKobo,
    remainingKobo,
    completionCount: task.completionCount,
    maxCompletions: task.maxCompletions,
    percentClaimed: percentageOf(task.spentKobo, task.budgetKobo),
  };
}

export async function findTask(taskId: string): Promise<Task | null> {
  const snapshot = await db().collection(COLLECTIONS.tasks).doc(taskId).get();
  return snapshot.exists ? mapTask(snapshot.id, snapshot.data() ?? {}) : null;
}

export async function requireTask(taskId: string): Promise<Task> {
  const task = await findTask(taskId);
  if (!task) throw notFound('that task', `task ${taskId} not found`);
  return task;
}

/**
 * Create a campaign.
 *
 * `maxCompletions` is derived from budget / reward rather than taken from the
 * client, so the two can never contradict each other. Telegram-verified tasks
 * are probed immediately and any access problem is stored on the task as an
 * admin-facing warning.
 */
export async function createTask(
  input: CreateTaskInput,
  createdBy: string,
): Promise<Task> {
  const settings = await getSettings();
  const ceiling = Math.min(settings.tasks.maxRewardKobo, LIMITS.MAX_TASK_REWARD_KOBO);

  const rewardKobo = assertPositiveKobo(input.rewardKobo, 'reward');
  if (rewardKobo > ceiling) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { rewardKobo: `The maximum reward per task is ${ceiling / 100} naira` },
      detail: `reward ${rewardKobo} exceeds ceiling ${ceiling}`,
    });
  }

  const budgetKobo = assertPositiveKobo(input.budgetKobo, 'budget');
  if (budgetKobo < rewardKobo) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { budgetKobo: 'The budget must cover at least one reward' },
    });
  }

  const maxCompletions = Math.floor(budgetKobo / rewardKobo);

  let verificationWarning: string | null = null;
  let telegramChatLabel = input.telegramChatLabel ?? null;
  if (input.verification === 'TELEGRAM_MEMBERSHIP' && input.telegramChatId) {
    const probe = await probeChatAccess(input.telegramChatId);
    verificationWarning = probe.warning;
    if (!telegramChatLabel && probe.title) telegramChatLabel = probe.title;
  }

  /*
    The link id doubles as the document id.

    That is what makes "two tasks cannot share an id" a property of the
    database: `create()` on an existing document fails, so two admins saving
    the same id at the same instant cannot both succeed. A uniqueness check
    followed by a write would race.

    Left blank, it is derived from the title, and a numeric suffix is appended
    only if that derived id is taken — an admin who typed nothing should not be
    told to pick a different id, while an admin who typed one explicitly must
    be, rather than having their choice silently altered.
  */
  const explicitSlug = input.slug?.trim() ?? '';
  let taskId = explicitSlug || toTaskSlug(input.title);
  if (!isTaskSlug(taskId)) {
    // A title of only punctuation or non-Latin script can derive to nothing.
    taskId = `task-${newTaskId().slice(0, 8).toLowerCase()}`;
  }

  const collection = db().collection(COLLECTIONS.tasks);
  if (!explicitSlug) {
    const base = taskId;
    for (let suffix = 2; suffix <= 50; suffix += 1) {
      const existing = await collection.doc(taskId).get();
      if (!existing.exists) break;
      taskId = `${base}-${String(suffix)}`.slice(0, 32);
    }
  }

  const now = Timestamp.now();
  const sponsor: TaskSponsor | null = input.sponsorName
    ? { name: input.sponsorName, logoUrl: input.sponsorLogoUrl ?? null, verified: false }
    : null;

  const record = {
    title: input.title,
    description: input.description,
    instructions: input.instructions,
    category: input.category,
    status: input.status as TaskStatus,
    rewardKobo,
    budgetKobo,
    spentKobo: 0,
    maxCompletions,
    completionCount: 0,
    pendingCount: 0,
    perUserLimit: input.perUserLimit,
    verification: input.verification,
    requiresProof: input.verification === 'SCREENSHOT',
    targetUrl: input.targetUrl ?? null,
    telegramChatId: input.telegramChatId ?? null,
    telegramChatLabel,
    verificationWarning,
    sponsor,
    startsAt: input.startsAt ? Timestamp.fromDate(new Date(input.startsAt)) : null,
    endsAt: input.endsAt ? Timestamp.fromDate(new Date(input.endsAt)) : null,
    minimumDwellSeconds: input.minimumDwellSeconds,
    sortWeight: input.sortWeight,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await collection.doc(taskId).create(record);
  } catch (error) {
    // ALREADY_EXISTS. The message names the field so the admin form can point
    // at it, and says what to do rather than only what went wrong.
    if ((error as { code?: number }).code === 6) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        fields: {
          slug: `The link id "${taskId}" is already used by another task. Choose a different one.`,
        },
        detail: `duplicate task slug ${taskId}`,
      });
    }
    throw error;
  }

  if (record.status === 'ACTIVE') {
    bumpStats({ activeCampaigns: 1, activeCampaignBudgetKobo: budgetKobo });
  }
  // Admin edits must show up now, not when the cache happens to expire.
  invalidateTaskCache();
  logger.info({ taskId, rewardKobo, budgetKobo, maxCompletions }, 'Task created');
  return mapTask(taskId, record);
}

/**
 * Update a campaign.
 *
 * Reward and budget may only be *raised*. Lowering either after users have
 * started completing the task would either strand approved completions or
 * retroactively change what someone was promised.
 */
export async function updateTask(
  taskId: string,
  patch: Record<string, unknown>,
): Promise<Task> {
  const firestore = db();
  const ref = firestore.collection(COLLECTIONS.tasks).doc(taskId);
  const settings = await getSettings();
  const ceiling = Math.min(settings.tasks.maxRewardKobo, LIMITS.MAX_TASK_REWARD_KOBO);

  const updated = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound('that task');
    const current = mapTask(snapshot.id, snapshot.data() ?? {});

    const update: Record<string, unknown> = { updatedAt: Timestamp.now() };

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;

      if (key === 'rewardKobo') {
        const reward = assertPositiveKobo(value as number, 'reward');
        if (reward > ceiling) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            fields: { rewardKobo: `The maximum reward per task is ${ceiling / 100} naira` },
          });
        }
        if (current.completionCount > 0 && reward < current.rewardKobo) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            fields: {
              rewardKobo: 'The reward cannot be reduced once users have completed this task',
            },
          });
        }
        update.rewardKobo = reward;
        continue;
      }

      if (key === 'budgetKobo') {
        const budget = assertPositiveKobo(value as number, 'budget');
        if (budget < current.spentKobo) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            fields: { budgetKobo: 'The budget cannot be set below what has already been spent' },
          });
        }
        update.budgetKobo = budget;
        continue;
      }

      if (key === 'startsAt' || key === 'endsAt') {
        update[key] = value ? Timestamp.fromDate(new Date(value as string)) : null;
        continue;
      }

      if (key === 'sponsorName') {
        update.sponsor = value
          ? {
              name: value as string,
              logoUrl: (patch.sponsorLogoUrl as string | null) ?? current.sponsor?.logoUrl ?? null,
              verified: current.sponsor?.verified ?? false,
            }
          : null;
        continue;
      }
      if (key === 'sponsorLogoUrl') continue; // folded into `sponsor` above

      update[key] = value;
    }

    // Keep the completion cap consistent with whichever of the two changed.
    const nextReward = (update.rewardKobo as number | undefined) ?? current.rewardKobo;
    const nextBudget = (update.budgetKobo as number | undefined) ?? current.budgetKobo;
    update.maxCompletions = Math.max(
      current.completionCount,
      Math.floor(nextBudget / nextReward),
    );

    tx.update(ref, update);
    return mapTask(taskId, { ...(snapshot.data() ?? {}), ...update });
  });

  invalidateTaskCache();
  return updated;
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
  const task = await requireTask(taskId);
  await db()
    .collection(COLLECTIONS.tasks)
    .doc(taskId)
    .update({ status, updatedAt: Timestamp.now() });

  const wasActive = task.status === 'ACTIVE';
  const isActive = status === 'ACTIVE';
  if (wasActive !== isActive) {
    bumpStats({
      activeCampaigns: isActive ? 1 : -1,
      activeCampaignBudgetKobo: isActive ? task.budgetKobo : -task.budgetKobo,
    });
  }
  invalidateTaskCache();
  return { ...task, status };
}

/**
 * Reserve budget for one completion, inside a caller-owned transaction.
 *
 * `pending` reserves against an unreviewed submission; a non-pending call
 * commits the spend outright. Either way the budget moves at the same instant
 * as the record that justifies it, and the task auto-pauses when it can no
 * longer fund another reward.
 */
export interface BudgetReservation {
  rewardKobo: Kobo;
  remainingAfterKobo: Kobo;
  autoPaused: boolean;
}

export function reserveBudgetIn(
  tx: import('firebase-admin/firestore').Transaction,
  task: Task,
  options: { pending: boolean },
): BudgetReservation {
  const availability = taskAvailability(task);
  if (!availability.available) {
    throw new AppError(
      availability.reason === 'BUDGET_EXHAUSTED' || availability.reason === 'COMPLETIONS_EXHAUSTED'
        ? ERROR_CODES.TASK_BUDGET_EXHAUSTED
        : ERROR_CODES.TASK_UNAVAILABLE,
      { detail: `task ${task.id} unavailable: ${availability.reason}` },
    );
  }

  const spentAfter = task.spentKobo + task.rewardKobo;
  const remainingAfter = task.budgetKobo - spentAfter;
  const claimedAfter = task.completionCount + task.pendingCount + 1;

  // Pause when the next reward can no longer be funded, or the cap is reached.
  const autoPaused =
    remainingAfter < task.rewardKobo || claimedAfter >= task.maxCompletions;

  const update: Record<string, unknown> = {
    spentKobo: FieldValue.increment(task.rewardKobo),
    updatedAt: Timestamp.now(),
  };
  if (options.pending) {
    update.pendingCount = FieldValue.increment(1);
  } else {
    update.completionCount = FieldValue.increment(1);
  }
  if (autoPaused) update.status = 'COMPLETED' as TaskStatus;

  tx.update(db().collection(COLLECTIONS.tasks).doc(task.id), update);

  return { rewardKobo: task.rewardKobo, remainingAfterKobo: Math.max(0, remainingAfter), autoPaused };
}

/** Convert a pending reservation into a committed completion (on approval). */
export function commitPendingIn(
  tx: import('firebase-admin/firestore').Transaction,
  taskId: string,
): void {
  tx.update(db().collection(COLLECTIONS.tasks).doc(taskId), {
    pendingCount: FieldValue.increment(-1),
    completionCount: FieldValue.increment(1),
    updatedAt: Timestamp.now(),
  });
}

/** Release a reservation back to the budget (on rejection). */
export function releaseBudgetIn(
  tx: import('firebase-admin/firestore').Transaction,
  task: Task,
): void {
  const update: Record<string, unknown> = {
    spentKobo: FieldValue.increment(-task.rewardKobo),
    pendingCount: FieldValue.increment(-1),
    updatedAt: Timestamp.now(),
  };
  // Releasing budget can make a paused campaign viable again.
  if (task.status === 'COMPLETED' && task.completionCount < task.maxCompletions) {
    update.status = 'ACTIVE' as TaskStatus;
  }
  tx.update(db().collection(COLLECTIONS.tasks).doc(task.id), update);
}

/**
 * Sweep tasks whose end date has passed.
 *
 * Called from the task list endpoint, which means it used to run on every
 * single Earn-tab open — a full scan of active campaigns per user per visit,
 * for a job whose entire purpose is to notice something that happens at most
 * once per campaign. Once every five minutes across the whole process says the
 * same thing: a campaign stays listed for a few minutes past its end date, and
 * `taskAvailability` already refuses to let anybody complete it in the
 * meantime, so nothing can be earned from the delay.
 */
const expirySweep = new Throttle(5 * 60_000);

/** Lower bound for "has an end date at all". See the sweep below. */
const EPOCH = Timestamp.fromMillis(0);

export async function expireFinishedTasks(): Promise<number> {
  if (!expirySweep.claim('sweep')) return 0;
  return runExpirySweep();
}

/** The sweep itself, unthrottled — for the admin trigger and for tests. */
export async function runExpirySweep(): Promise<number> {
  const now = Timestamp.now();
  const collection = db().collection(COLLECTIONS.tasks);

  // The task list calls this on every load, so a missing composite index here
  // would take the whole earn screen down rather than just delay a sweep.
  const { docs } = await runFilteredQuery({
    /*
      The lower bound is not redundant. Firestore orders null below every other
      type, so `endsAt <= now` on its own also matches every campaign with no
      end date at all — which would expire exactly the campaigns that are meant
      to run forever. Two range filters on the same field are allowed, and the
      pair says what was always meant: has an end date, and it has passed.
    */
    narrow: collection
      .where('status', '==', 'ACTIVE')
      .where('endsAt', '>', EPOCH)
      .where('endsAt', '<=', now)
      .limit(50),
    base: collection.where('status', '==', 'ACTIVE'),
    matches: (doc) => {
      const endsAt = doc.get('endsAt');
      return endsAt != null && millisOf(endsAt) <= now.toMillis();
    },
    label: 'tasks.expireFinishedTasks',
  });

  // The fallback has no limit of its own; the sweep stays one batch either way.
  const expiring = docs.slice(0, 50);
  if (expiring.length === 0) return 0;

  const batch = db().batch();
  for (const doc of expiring) {
    batch.update(doc.ref, { status: 'EXPIRED' as TaskStatus, updatedAt: Timestamp.now() });
  }
  await batch.commit();
  invalidateTaskCache();
  logger.info({ count: expiring.length }, 'Expired finished tasks');
  return expiring.length;
}

export interface UserTaskState {
  userState: TaskListItem['userState'];
  rejectionReason: string | null;
}

/**
 * Build the task list for a user, annotated with their own state.
 *
 * Completions and submissions are fetched once for the user and joined in
 * memory rather than queried per task, so the list costs three reads regardless
 * of how many campaigns are live.
 */
export async function listTasksForUser(userId: string): Promise<TaskListItem[]> {
  const firestore = db();

  const [taskDocs, completionSnapshot, submissionSnapshot] = await Promise.all([
    listLiveTaskDocs(),
    firestore.collection(COLLECTIONS.taskCompletions).where('userId', '==', userId).get(),
    firestore.collection(COLLECTIONS.taskSubmissions).where('userId', '==', userId).get(),
  ]);

  const completionsByTask = new Map<string, number>();
  for (const doc of completionSnapshot.docs) {
    const taskId = doc.get('taskId') as string;
    completionsByTask.set(taskId, (completionsByTask.get(taskId) ?? 0) + 1);
  }

  const submissionByTask = new Map<string, { status: string; reason: string | null }>();
  for (const doc of submissionSnapshot.docs) {
    const taskId = doc.get('taskId') as string;
    const status = doc.get('status') as string;
    const existing = submissionByTask.get(taskId);
    // A pending submission is the most relevant state; otherwise keep the last.
    if (!existing || status === 'PENDING_REVIEW') {
      submissionByTask.set(taskId, {
        status,
        reason: (doc.get('rejectionReason') as string | null) ?? null,
      });
    }
  }

  const items: TaskListItem[] = [];
  for (const doc of taskDocs) {
    const task = mapTask(doc.id, doc.data);
    const availability = taskAvailability(task);
    const completions = completionsByTask.get(task.id) ?? 0;
    const submission = submissionByTask.get(task.id);

    let userState: TaskListItem['userState'];
    let rejectionReason: string | null = null;

    if (completions >= task.perUserLimit) {
      userState = 'COMPLETED';
    } else if (submission?.status === 'PENDING_REVIEW') {
      userState = 'PENDING_REVIEW';
    } else if (submission?.status === 'REJECTED') {
      userState = 'REJECTED';
      rejectionReason = submission.reason;
    } else if (!availability.available) {
      userState = 'UNAVAILABLE';
    } else {
      userState = 'AVAILABLE';
    }

    // Hide campaigns the user can neither do nor learn anything from.
    if (userState === 'UNAVAILABLE' && task.status !== 'ACTIVE') continue;

    items.push({
      id: task.id,
      title: task.title,
      description: task.description,
      category: task.category,
      rewardKobo: task.rewardKobo,
      verification: task.verification,
      requiresProof: task.requiresProof,
      targetUrl: task.targetUrl,
      telegramChatLabel: task.telegramChatLabel,
      instructions: task.instructions,
      sponsor: task.sponsor,
      budget: budgetView(task),
      endsAt: task.endsAt,
      minimumDwellSeconds: task.minimumDwellSeconds,
      userState,
      rejectionReason,
    });
  }

  // Available first, then by admin weight, then by reward.
  const rank: Record<TaskListItem['userState'], number> = {
    AVAILABLE: 0, REJECTED: 1, PENDING_REVIEW: 2, COMPLETED: 3, UNAVAILABLE: 4,
  };
  items.sort(
    (a, b) => rank[a.userState] - rank[b.userState] || b.rewardKobo - a.rewardKobo,
  );
  return items;
}

export async function listAllTasks(options: { status?: TaskStatus } = {}): Promise<Task[]> {
  let query = db().collection(COLLECTIONS.tasks).orderBy('createdAt', 'desc');
  if (options.status) query = query.where('status', '==', options.status);
  const snapshot = await query.limit(200).get();
  return snapshot.docs.map((doc) => mapTask(doc.id, doc.data()));
}

/** Deterministic completion id — the uniqueness constraint per (user, task). */
export function completionId(userId: string, taskId: string, attempt = 1): string {
  return attempt <= 1
    ? deterministicId(userId, taskId)
    : deterministicId(userId, taskId, String(attempt));
}

export function mapTask(id: string, data: Record<string, unknown>): Task {
  return {
    id,
    title: String(data.title ?? ''),
    description: String(data.description ?? ''),
    instructions: (data.instructions as string[]) ?? [],
    category: (data.category as TaskCategory) ?? 'OTHER',
    status: (data.status as TaskStatus) ?? 'DRAFT',
    rewardKobo: (data.rewardKobo as number | undefined) ?? 0,
    budgetKobo: (data.budgetKobo as number | undefined) ?? 0,
    spentKobo: (data.spentKobo as number | undefined) ?? 0,
    maxCompletions: (data.maxCompletions as number | undefined) ?? 0,
    completionCount: (data.completionCount as number | undefined) ?? 0,
    pendingCount: (data.pendingCount as number | undefined) ?? 0,
    perUserLimit: (data.perUserLimit as number | undefined) ?? 1,
    verification: (data.verification as VerificationMethod) ?? 'SCREENSHOT',
    requiresProof: Boolean(data.requiresProof),
    targetUrl: (data.targetUrl as string | null) ?? null,
    telegramChatId: (data.telegramChatId as string | null) ?? null,
    telegramChatLabel: (data.telegramChatLabel as string | null) ?? null,
    verificationWarning: (data.verificationWarning as string | null) ?? null,
    sponsor: (data.sponsor as TaskSponsor | null) ?? null,
    startsAt: toIso(data.startsAt),
    endsAt: toIso(data.endsAt),
    minimumDwellSeconds: (data.minimumDwellSeconds as number | undefined) ?? 0,
    sortWeight: (data.sortWeight as number | undefined) ?? 100,
    createdBy: String(data.createdBy ?? ''),
    createdAt: toIsoRequired(data.createdAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
  };
}
