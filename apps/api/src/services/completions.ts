import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ERROR_CODES,
  type Kobo,
  type SubmissionStatus,
  type Task,
  type TaskSubmission,
  type User,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { millisOf, runOrderedQuery } from '../lib/query-fallback';
import { AppError, notFound } from '../lib/errors';
import { newSubmissionId } from '../lib/ids';
import { logger } from '../lib/logger';
import { nowIso, toIso, toIsoRequired } from '../lib/time';
import { checkChatMembership } from '../lib/telegram-bot';
import { idempotencyKey, postEntryIn } from './ledger';
import { recordSecurityEvent } from './security';
import { getSettings } from './settings';
import { bumpStats } from './stats';
import { flagUser } from './users';
import {
  commitPendingIn,
  completionId,
  mapTask,
  releaseBudgetIn,
  requireTask,
  reserveBudgetIn,
  taskAvailability,
} from './tasks';

/**
 * Task completion and verification.
 *
 * The central rule, stated once and enforced structurally: **a reward is only
 * ever credited by a Firestore transaction that also creates the
 * `taskCompletions/{userId}__{taskId}` document.** That document's id is
 * derived from the pair, so `create()` fails on a second attempt and the whole
 * transaction — credit included — is rolled back. A user cannot be paid twice
 * for one task, whether they double-tapped, retried on a flaky connection, or
 * raced two requests deliberately.
 *
 * Manual tasks never credit on submission. They reserve budget, park in
 * PENDING_REVIEW, and credit only inside the admin's approval transaction.
 */

export interface CompletionOutcome {
  state: 'CREDITED' | 'PENDING_REVIEW';
  rewardKobo: Kobo;
  transactionId?: string;
  submissionId?: string;
  balanceAfterKobo?: Kobo;
  /** Remaining campaign budget, so the UI can update without a refetch. */
  remainingBudgetKobo: Kobo;
  message: string;
}

export interface CompleteTaskArgs {
  user: User;
  taskId: string;
  proofPath?: string | undefined;
  answer?: string | undefined;
  dwellSeconds?: number | undefined;
}

export async function completeTask(args: CompleteTaskArgs): Promise<CompletionOutcome> {
  const settings = await getSettings();
  if (!settings.tasks.earningEnabled) {
    throw new AppError(ERROR_CODES.TASK_UNAVAILABLE, { detail: 'task earning is globally paused' });
  }

  const task = await requireTask(args.taskId);

  const availability = taskAvailability(task);
  if (!availability.available) {
    throw new AppError(
      availability.reason === 'BUDGET_EXHAUSTED' || availability.reason === 'COMPLETIONS_EXHAUSTED'
        ? ERROR_CODES.TASK_BUDGET_EXHAUSTED
        : ERROR_CODES.TASK_UNAVAILABLE,
      { detail: `task ${task.id}: ${availability.reason}` },
    );
  }

  // Cheap pre-check for a clearer error than a transaction abort. The real
  // guarantee is the deterministic completion id inside the transaction.
  await assertNotAlreadyCompleted(args.user.id, task);

  // A completion submitted implausibly fast is a bot signal, not proof of
  // fraud — flag for review, do not block.
  if (
    task.minimumDwellSeconds > 0 &&
    typeof args.dwellSeconds === 'number' &&
    args.dwellSeconds < task.minimumDwellSeconds
  ) {
    recordSecurityEvent({
      type: 'SUSPICIOUS_VELOCITY',
      userId: args.user.id,
      message: `Task completed in ${args.dwellSeconds}s, below the ${task.minimumDwellSeconds}s minimum`,
      metadata: { taskId: task.id, dwellSeconds: args.dwellSeconds },
    });
    void flagUser(args.user.id, 'TASK_VELOCITY', 8);
  }

  switch (task.verification) {
    case 'TELEGRAM_MEMBERSHIP':
      return completeWithTelegramVerification(args.user, task);
    case 'SCREENSHOT':
      if (!args.proofPath) {
        throw new AppError(ERROR_CODES.TASK_PROOF_REQUIRED);
      }
      return submitForReview(args.user, task, { proofPath: args.proofPath, answer: args.answer ?? null });
    case 'MANUAL_REVIEW':
      if (!args.answer || args.answer.trim().length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          fields: { answer: 'Please provide the requested details' },
        });
      }
      return submitForReview(args.user, task, { proofPath: args.proofPath ?? null, answer: args.answer });
    case 'HONOUR':
      return creditCompletion(args.user, task, { verification: 'HONOUR' });
    default:
      throw new AppError(ERROR_CODES.TASK_UNAVAILABLE, {
        detail: `unknown verification method on task ${task.id}`,
      });
  }
}

async function assertNotAlreadyCompleted(userId: string, task: Task): Promise<void> {
  const [completions, pending] = await Promise.all([
    db()
      .collection(COLLECTIONS.taskCompletions)
      .where('userId', '==', userId)
      .where('taskId', '==', task.id)
      .count()
      .get(),
    db()
      .collection(COLLECTIONS.taskSubmissions)
      .where('userId', '==', userId)
      .where('taskId', '==', task.id)
      .where('status', '==', 'PENDING_REVIEW')
      .count()
      .get(),
  ]);

  if (completions.data().count >= task.perUserLimit) {
    throw new AppError(ERROR_CODES.TASK_ALREADY_COMPLETED);
  }
  if (pending.data().count > 0) {
    throw new AppError(ERROR_CODES.TASK_ALREADY_COMPLETED, {
      message: 'Your submission is already waiting for review.',
    });
  }
}

/**
 * Telegram-verified completion.
 *
 * Membership is checked against the Bot API before anything is written. A
 * configuration fault (the bot is not an admin of the target chat) is never
 * treated as success: it is recorded on the task for the admin and the user is
 * told verification is unavailable, which keeps the platform from paying out on
 * a broken campaign.
 */
async function completeWithTelegramVerification(
  user: User,
  task: Task,
): Promise<CompletionOutcome> {
  if (!task.telegramChatId) {
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
      detail: `task ${task.id} has no telegramChatId`,
    });
  }

  const outcome = await checkChatMembership(task.telegramChatId, user.telegramId);

  if (outcome.state === 'CONFIGURATION_ERROR') {
    await db()
      .collection(COLLECTIONS.tasks)
      .doc(task.id)
      .update({ verificationWarning: outcome.adminMessage, updatedAt: Timestamp.now() });
    logger.error(
      { taskId: task.id, advice: outcome.adminMessage },
      'Task verification is misconfigured; refusing to credit',
    );
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, { detail: outcome.adminMessage });
  }

  if (outcome.state === 'UNAVAILABLE') {
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, { detail: outcome.adminMessage });
  }

  if (outcome.state === 'NOT_JOINED') {
    throw new AppError(ERROR_CODES.VERIFICATION_FAILED, {
      message: task.telegramChatLabel
        ? `We could not see you in ${task.telegramChatLabel} yet. Join, then tap verify again.`
        : 'We could not confirm you joined yet. Join, then tap verify again.',
      detail: `membership status: ${outcome.status}`,
    });
  }

  // Clear a stale warning now that verification demonstrably works.
  if (task.verificationWarning) {
    void db()
      .collection(COLLECTIONS.tasks)
      .doc(task.id)
      .update({ verificationWarning: null })
      .catch(() => undefined);
  }

  return creditCompletion(user, task, { verification: 'TELEGRAM_MEMBERSHIP' });
}

/**
 * Credit a verified completion.
 *
 * Everything below happens in one transaction: budget reservation, the
 * uniqueness-enforcing completion document, the ledger credit and the user's
 * counter. Any one of them failing rolls back all of them.
 */
async function creditCompletion(
  user: User,
  task: Task,
  options: { verification: Task['verification']; submissionId?: string },
): Promise<CompletionOutcome> {
  const firestore = db();
  const completionRef = firestore
    .collection(COLLECTIONS.taskCompletions)
    .doc(completionId(user.id, task.id));

  try {
    const result = await firestore.runTransaction(async (tx) => {
      // Re-read the task inside the transaction: its budget may have been
      // claimed by someone else between the availability check and here.
      const taskSnapshot = await tx.get(firestore.collection(COLLECTIONS.tasks).doc(task.id));
      if (!taskSnapshot.exists) throw notFound('that task');
      const fresh = mapTask(taskSnapshot.id, taskSnapshot.data() ?? {});

      const reservation = reserveBudgetIn(tx, fresh, { pending: false });

      const entry = await postEntryIn(tx, {
        userId: user.id,
        type: 'TASK_REWARD',
        amountKobo: reservation.rewardKobo,
        description: fresh.title,
        reference: fresh.id,
        // Keyed on the pair, so a replay cannot produce a second credit even if
        // the completion document were somehow absent.
        idempotencyKey: idempotencyKey('task', user.id, fresh.id),
        metadata: { taskId: fresh.id, verification: options.verification },
      });

      // The uniqueness constraint. `create` fails if this pair already exists,
      // which aborts the credit above with it.
      tx.create(completionRef, {
        taskId: fresh.id,
        userId: user.id,
        rewardKobo: reservation.rewardKobo,
        transactionId: entry.transaction.id,
        verification: options.verification,
        submissionId: options.submissionId ?? null,
        completedAt: Timestamp.now(),
      });

      tx.update(firestore.collection(COLLECTIONS.users).doc(user.id), {
        tasksCompleted: FieldValue.increment(1),
        updatedAt: Timestamp.now(),
      });

      return { reservation, entry };
    });

    bumpStats({
      totalTasksCompleted: 1,
      totalRewardsEarnedKobo: result.reservation.rewardKobo,
      ...(result.reservation.autoPaused
        ? { activeCampaigns: -1, activeCampaignBudgetKobo: -task.budgetKobo }
        : {}),
    });

    if (result.reservation.autoPaused) {
      logger.info({ taskId: task.id }, 'Task auto-completed: budget or completion cap reached');
    }

    return {
      state: 'CREDITED',
      rewardKobo: result.reservation.rewardKobo,
      transactionId: result.entry.transaction.id,
      balanceAfterKobo: result.entry.balanceAfterKobo,
      remainingBudgetKobo: result.reservation.remainingAfterKobo,
      message: 'Reward added to your balance.',
    };
  } catch (error) {
    // Firestore ALREADY_EXISTS on the completion document means a concurrent
    // request won the race. That is the guard working, not a server fault.
    if ((error as { code?: number }).code === 6) {
      recordSecurityEvent({
        type: 'IDEMPOTENT_REPLAY',
        userId: user.id,
        message: 'Duplicate task completion blocked',
        metadata: { taskId: task.id },
      });
      throw new AppError(ERROR_CODES.TASK_ALREADY_COMPLETED);
    }
    throw error;
  }
}

/**
 * Park a manual task in the review queue.
 *
 * Budget is reserved now — a pending submission has a claim on the campaign —
 * but no money moves until an admin approves.
 */
async function submitForReview(
  user: User,
  task: Task,
  input: { proofPath: string | null; answer: string | null },
): Promise<CompletionOutcome> {
  const firestore = db();
  const submissionId = newSubmissionId();

  const result = await firestore.runTransaction(async (tx) => {
    const taskSnapshot = await tx.get(firestore.collection(COLLECTIONS.tasks).doc(task.id));
    if (!taskSnapshot.exists) throw notFound('that task');
    const fresh = mapTask(taskSnapshot.id, taskSnapshot.data() ?? {});

    const reservation = reserveBudgetIn(tx, fresh, { pending: true });

    tx.create(firestore.collection(COLLECTIONS.taskSubmissions).doc(submissionId), {
      taskId: fresh.id,
      taskTitle: fresh.title,
      userId: user.id,
      userTelegramId: user.telegramId,
      username: user.username,
      status: 'PENDING_REVIEW' as SubmissionStatus,
      rewardKobo: reservation.rewardKobo,
      proofPath: input.proofPath,
      answer: input.answer,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      transactionId: null,
      submittedAt: Timestamp.now(),
    });

    return reservation;
  });

  logger.info({ submissionId, taskId: task.id, userId: user.id }, 'Task submission queued');

  return {
    state: 'PENDING_REVIEW',
    rewardKobo: result.rewardKobo,
    submissionId,
    remainingBudgetKobo: result.remainingAfterKobo,
    message: 'Submitted. A reviewer will check it, usually within 24 hours.',
  };
}

export interface ReviewOutcome {
  status: SubmissionStatus;
  rewardKobo: Kobo;
  transactionId: string | null;
}

/**
 * Approve or reject a submission.
 *
 * Approval credits the reward and converts the pending reservation into a
 * committed completion, in one transaction with the same
 * `taskCompletions/{user}__{task}` uniqueness guard — so approving the same
 * submission twice (a double-clicked admin button) cannot pay twice.
 *
 * Rejection releases the reserved budget back to the campaign, which can
 * reactivate a task that had auto-paused.
 */
export async function reviewSubmission(input: {
  submissionId: string;
  decision: 'APPROVE' | 'REJECT';
  reason?: string | undefined;
  reviewerId: string;
}): Promise<ReviewOutcome> {
  const firestore = db();
  const submissionRef = firestore.collection(COLLECTIONS.taskSubmissions).doc(input.submissionId);

  try {
    const result = await firestore.runTransaction(async (tx) => {
      const submissionSnapshot = await tx.get(submissionRef);
      if (!submissionSnapshot.exists) throw notFound('that submission');

      const submission = mapSubmission(submissionSnapshot.id, submissionSnapshot.data() ?? {});
      if (submission.status !== 'PENDING_REVIEW') {
        throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, {
          message: 'That submission has already been reviewed.',
          detail: `submission ${submission.id} is ${submission.status}`,
        });
      }

      const taskSnapshot = await tx.get(firestore.collection(COLLECTIONS.tasks).doc(submission.taskId));
      if (!taskSnapshot.exists) throw notFound('that task');
      const task = mapTask(taskSnapshot.id, taskSnapshot.data() ?? {});

      const now = Timestamp.now();

      if (input.decision === 'REJECT') {
        releaseBudgetIn(tx, task);
        tx.update(submissionRef, {
          status: 'REJECTED' as SubmissionStatus,
          reviewedBy: input.reviewerId,
          reviewedAt: now,
          rejectionReason: input.reason ?? 'Proof did not show the task was completed',
        });
        return { status: 'REJECTED' as SubmissionStatus, rewardKobo: submission.rewardKobo, transactionId: null };
      }

      const entry = await postEntryIn(tx, {
        userId: submission.userId,
        type: 'TASK_REWARD',
        amountKobo: submission.rewardKobo,
        description: submission.taskTitle,
        reference: submission.taskId,
        idempotencyKey: idempotencyKey('task', submission.userId, submission.taskId),
        actorAdminId: input.reviewerId,
        metadata: { taskId: submission.taskId, submissionId: submission.id, verification: 'REVIEWED' },
      });

      tx.create(
        firestore.collection(COLLECTIONS.taskCompletions).doc(completionId(submission.userId, submission.taskId)),
        {
          taskId: submission.taskId,
          userId: submission.userId,
          rewardKobo: submission.rewardKobo,
          transactionId: entry.transaction.id,
          verification: task.verification,
          submissionId: submission.id,
          completedAt: now,
        },
      );

      commitPendingIn(tx, submission.taskId);

      tx.update(firestore.collection(COLLECTIONS.users).doc(submission.userId), {
        tasksCompleted: FieldValue.increment(1),
        updatedAt: now,
      });

      tx.update(submissionRef, {
        status: 'APPROVED' as SubmissionStatus,
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        transactionId: entry.transaction.id,
      });

      return {
        status: 'APPROVED' as SubmissionStatus,
        rewardKobo: submission.rewardKobo,
        transactionId: entry.transaction.id,
      };
    });

    if (result.status === 'APPROVED') {
      bumpStats({ totalTasksCompleted: 1, totalRewardsEarnedKobo: result.rewardKobo });
    }
    logger.info(
      { submissionId: input.submissionId, decision: input.decision, reviewerId: input.reviewerId },
      'Submission reviewed',
    );
    return result;
  } catch (error) {
    if ((error as { code?: number }).code === 6) {
      throw new AppError(ERROR_CODES.TASK_ALREADY_COMPLETED, {
        message: 'This user has already been credited for that task.',
      });
    }
    throw error;
  }
}

export async function listSubmissions(options: {
  status?: SubmissionStatus;
  taskId?: string;
  userId?: string;
  limit?: number;
  cursor?: string | undefined;
}): Promise<{ items: TaskSubmission[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const collection = db().collection(COLLECTIONS.taskSubmissions);

  let base = collection as unknown as import('firebase-admin/firestore').Query;
  if (options.status) base = base.where('status', '==', options.status);
  if (options.taskId) base = base.where('taskId', '==', options.taskId);
  if (options.userId) base = base.where('userId', '==', options.userId);
  let query = base.orderBy('submittedAt', 'desc').limit(limit + 1);

  if (options.cursor) {
    const cursorDoc = await collection.doc(options.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  // The review queue is how proofs get approved; it must not vanish because
  // an index is still building. See lib/query-fallback.ts.
  const snapshot = await runOrderedQuery({
    base,
    ordered: query,
    limit: limit + 1,
    timestampOf: (data) => millisOf(data.submittedAt),
    label: 'submission queue, newest first',
  });
  const docs = snapshot.docs.slice(0, limit);
  const hasMore = snapshot.docs.length > limit;
  const last = docs[docs.length - 1];

  return {
    items: docs.map((doc) => mapSubmission(doc.id, doc.data())),
    nextCursor: hasMore && last ? last.id : null,
  };
}

export async function findSubmission(submissionId: string): Promise<TaskSubmission | null> {
  const snapshot = await db().collection(COLLECTIONS.taskSubmissions).doc(submissionId).get();
  return snapshot.exists ? mapSubmission(snapshot.id, snapshot.data() ?? {}) : null;
}

export function mapSubmission(id: string, data: Record<string, unknown>): TaskSubmission {
  return {
    id,
    taskId: String(data.taskId ?? ''),
    taskTitle: String(data.taskTitle ?? ''),
    userId: String(data.userId ?? ''),
    userTelegramId: String(data.userTelegramId ?? ''),
    username: (data.username as string | null) ?? null,
    status: (data.status as SubmissionStatus) ?? 'PENDING_REVIEW',
    rewardKobo: (data.rewardKobo as number | undefined) ?? 0,
    proofPath: (data.proofPath as string | null) ?? null,
    answer: (data.answer as string | null) ?? null,
    reviewedBy: (data.reviewedBy as string | null) ?? null,
    reviewedAt: toIso(data.reviewedAt),
    rejectionReason: (data.rejectionReason as string | null) ?? null,
    transactionId: (data.transactionId as string | null) ?? null,
    submittedAt: toIsoRequired(data.submittedAt, nowIso()),
  };
}
