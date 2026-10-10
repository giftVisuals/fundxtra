import type { Task, TaskSubmission } from '@fundxtra/shared';
import { formatNaira } from '@fundxtra/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { editPhotoCaption, sendBotPhoto } from '../lib/telegram-bot';
import { KeyedCache } from '../lib/cache';
import { fetchProof } from './uploads';
import type { ScreenshotReview } from './screenshot-review';

/**
 * Send a screenshot the reviewer could not judge to the owner's Telegram, with
 * two buttons.
 *
 * The admin queue is a fine page and it is not the problem. The problem is
 * what a person does with a backlog: open it and try to clear all of it at
 * once, because users are waiting. Pagination is no comfort to somebody
 * determined to approve a thousand things in one sitting.
 *
 * So the uncertain ones come to the owner one at a time, in the chat they
 * already have open, each with the picture and two buttons. Deciding costs one
 * tap, and reading the queue costs nothing at all, because there is no queue
 * to read — the work arrives instead of being fetched.
 *
 * Sent to the primary admin only. This is the owner's escalation path, not a
 * shared inbox: a decision surface where two people can tap the same button is
 * a decision surface that pays twice.
 */

/**
 * Which Telegram message is showing which submission.
 *
 * So that deciding a submission *anywhere* — the admin console, the automatic
 * reviewer, another device — can go back and close the message asking for a
 * decision. A "needs your eyes" card still sitting in the chat with live
 * buttons under something already approved is both noise and a trap: the
 * obvious thing to do with it is tap it.
 *
 * In memory, not in the database. The alternative is a write per escalation
 * and another on every review, to tidy up a chat message — and a restart
 * costing a tidy-up is a far better trade than that. A message left behind
 * still refuses the second decision when tapped.
 */
const escalations = new KeyedCache<{ chatId: string; messageId: number }>(
  24 * 60 * 60_000,
  2_000,
  'escalations',
);

/** Remember a message so a later decision can close it. */
export function rememberEscalation(submissionId: string, chatId: string, messageId: number): void {
  escalations.set(submissionId, { chatId, messageId });
}

/** Which message, if any, is showing this submission. For tests. */
export function peekEscalation(submissionId: string): { chatId: string; messageId: number } | null {
  return escalations.get(submissionId);
}

/**
 * Close out the Telegram card for a submission that has now been decided.
 *
 * Rewrites the caption to the outcome and removes the buttons. Silent when
 * there is no card: most submissions are never escalated, and this runs after
 * every review.
 */
export async function closeEscalation(
  submissionId: string,
  outcome: { approved: boolean; rewardKobo: number },
): Promise<void> {
  const card = escalations.get(submissionId);
  if (!card) return;
  // Dropped first, so a failure to edit cannot leave this retrying forever.
  escalations.invalidate(submissionId);

  try {
    await editPhotoCaption({
      chatId: card.chatId,
      messageId: card.messageId,
      caption: outcome.approved
        ? `✅ <b>Approved</b> — ${formatNaira(outcome.rewardKobo)} paid to the user.`
        : '❌ <b>Rejected</b> — nothing was deducted, and the user has been told.',
    });
  } catch (error) {
    logger.debug({ err: error, submissionId }, 'Could not close the escalation card');
  }
}

export async function escalateForReview(options: {
  submission: TaskSubmission;
  task: Task;
  review: ScreenshotReview;
}): Promise<boolean> {
  const ownerId = env.PRIMARY_ADMIN_TELEGRAM_ID;
  if (!ownerId || !options.submission.proofPath) return false;

  const proof = await fetchProof(options.submission.proofPath);
  if (!proof) {
    logger.warn(
      { submissionId: options.submission.id },
      'Could not fetch the proof to escalate it',
    );
    return false;
  }

  const caption = buildCaption(options);

  try {
    const message = await sendBotPhoto({
      chatId: ownerId,
      bytes: proof.bytes,
      filename: `submission-${options.submission.id}.png`,
      caption,
      replyMarkup: {
        inline_keyboard: [
          [
            { text: `✅ Approve ${formatNaira(options.submission.rewardKobo)}`, callback_data: `rev:a:${options.submission.id}` },
            { text: '❌ Reject', callback_data: `rev:r:${options.submission.id}` },
          ],
        ],
      },
    });
    if (typeof message?.message_id === 'number') {
      rememberEscalation(options.submission.id, ownerId, message.message_id);
    }
    logger.info({ submissionId: options.submission.id }, 'Submission escalated to the owner');
    return true;
  } catch (error) {
    // Never fatal. The submission is already saved and still sits in the admin
    // queue; failing to notify must not fail the user's submission.
    logger.warn({ err: error, submissionId: options.submission.id }, 'Could not escalate for review');
    return false;
  }
}

function buildCaption(options: {
  submission: TaskSubmission;
  task: Task;
  review: ScreenshotReview;
}): string {
  const { submission, task, review } = options;
  const who = submission.username ? `@${submission.username}` : submission.userTelegramId;

  const lines = [
    `🔍 <b>Needs your eyes</b>`,
    '',
    `<b>${escape(task.title)}</b> · ${formatNaira(submission.rewardKobo)}`,
    `From ${escape(who)}`,
  ];

  if (task.reviewCriteria) {
    lines.push('', `<i>Must show:</i> ${escape(task.reviewCriteria)}`);
  }

  if (review.observed) {
    lines.push('', `<i>AI saw:</i> ${escape(review.observed)}`);
  }
  if (review.escalationReason) {
    lines.push(`<i>Why you:</i> ${escape(review.escalationReason)}`);
  }

  return lines.join('\n');
}

/** Telegram's HTML mode needs these three escaped, and only these. */
function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
