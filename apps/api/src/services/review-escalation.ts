import type { Task, TaskSubmission } from '@fundxtra/shared';
import { formatNaira } from '@fundxtra/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { sendBotPhoto } from '../lib/telegram-bot';
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
    await sendBotPhoto({
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
