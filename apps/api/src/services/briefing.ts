import { Timestamp } from 'firebase-admin/firestore';
import { formatNaira, type Kobo } from '@fundxtra/shared';
import { env } from '../config/env';
import { COLLECTIONS, db } from '../lib/firebase';
import { logger } from '../lib/logger';
import { millisOf, runFilteredQuery, runOrderedQuery } from '../lib/query-fallback';
import { platformDayKey, startOfPlatformDay } from '../lib/time';
import { sendBotMessage } from '../lib/telegram-bot';
import { adminDashboard } from './admin-users';

/**
 * The owner's daily brief.
 *
 * Fundxtra runs itself except for one loop: a person approves screenshots and
 * sends bank transfers. Once that loop is delegated, the owner's real risk
 * stops being a bug and becomes not knowing — that the queue has not been
 * touched in three days, that yesterday's payouts were four times normal, that
 * the float is smaller than what is owed.
 *
 * So the numbers come to them, in the chat they already have open, once a day.
 * No dashboard to remember to open, which is the only kind of monitoring a
 * busy person actually keeps up with.
 *
 * Deliberately short. A message with six numbers gets read; a message with
 * thirty gets skimmed, and then not read at all.
 */

/** Platform-local hour the brief is sent. Morning, before the day's work. */
const BRIEF_HOUR = 8;

const STATE_DOC = 'ownerBrief';

export interface OwnerBrief {
  pendingSubmissions: number;
  pendingWithdrawalCount: number;
  pendingWithdrawalsKobo: Kobo;
  paidYesterdayKobo: Kobo;
  paidYesterdayCount: number;
  paidTodayKobo: Kobo;
  owedToUsersKobo: Kobo;
  newUsersToday: number;
  flaggedUsers: number;
  /** Hours since the oldest unreviewed submission arrived, or null if none. */
  oldestSubmissionHours: number | null;
}

export async function buildOwnerBrief(): Promise<OwnerBrief> {
  const [dashboard, payouts, oldest] = await Promise.all([
    adminDashboard(),
    sumRecentPayouts(),
    oldestPendingSubmissionHours(),
  ]);

  return {
    pendingSubmissions: dashboard.tasks.pendingSubmissions,
    pendingWithdrawalCount: dashboard.finance.pendingWithdrawalCount,
    pendingWithdrawalsKobo: dashboard.finance.pendingWithdrawalsKobo,
    paidYesterdayKobo: payouts.yesterdayKobo,
    paidYesterdayCount: payouts.yesterdayCount,
    paidTodayKobo: payouts.todayKobo,
    owedToUsersKobo: dashboard.finance.totalBalanceKobo,
    newUsersToday: dashboard.users.newToday,
    flaggedUsers: dashboard.risk.flaggedUsers,
    oldestSubmissionHours: oldest,
  };
}

/**
 * The brief as a Telegram message.
 *
 * Written so the first line answers "is anything waiting for me?" — because on
 * most days that is the only line that gets read.
 */
export function formatOwnerBrief(brief: OwnerBrief): string {
  const waiting = brief.pendingSubmissions + brief.pendingWithdrawalCount;

  const lines: string[] = [
    waiting === 0
      ? '✅ <b>Nothing waiting</b>'
      : `🔔 <b>${String(waiting)} waiting for someone</b>`,
    '',
    `📸 Screenshots to review: <b>${String(brief.pendingSubmissions)}</b>`,
  ];

  // Only mentioned when it is a problem. A number that appears every day stops
  // being read; one that appears only when it matters keeps its meaning.
  if (brief.oldestSubmissionHours !== null && brief.oldestSubmissionHours >= 24) {
    lines.push(`   ⚠️ oldest has waited ${String(Math.floor(brief.oldestSubmissionHours))} hours`);
  }

  lines.push(
    `💸 Withdrawals to pay: <b>${String(brief.pendingWithdrawalCount)}</b> · ${formatNaira(brief.pendingWithdrawalsKobo)}`,
    '',
    `Paid yesterday: <b>${formatNaira(brief.paidYesterdayKobo)}</b> across ${String(brief.paidYesterdayCount)}`,
    `Paid so far today: ${formatNaira(brief.paidTodayKobo)}`,
    '',
    `Owed to users: <b>${formatNaira(brief.owedToUsersKobo)}</b>`,
    `New users today: ${String(brief.newUsersToday)}`,
  );

  if (brief.flaggedUsers > 0) {
    lines.push(`Flagged accounts: ${String(brief.flaggedUsers)}`);
  }

  return lines.join('\n');
}

/**
 * Send today's brief, if it is due and has not gone already.
 *
 * "Already sent" is recorded in Firestore rather than held in memory, because
 * the API restarts on every deploy and a brief that arrives three times on a
 * busy deployment day is a brief that gets muted.
 */
export async function sendOwnerBriefIfDue(now = new Date()): Promise<boolean> {
  const ownerId = env.PRIMARY_ADMIN_TELEGRAM_ID;
  if (!ownerId) return false;

  const today = platformDayKey(now);
  const hour = platformHour(now);
  if (hour < BRIEF_HOUR) return false;

  const ref = db().collection(COLLECTIONS.systemSettings).doc(STATE_DOC);
  const snapshot = await ref.get();
  if ((snapshot.get('lastSentOn') as string | undefined) === today) return false;

  /*
    Claimed before the brief is built, not after it is sent. Building it takes
    a moment, and the failure worth avoiding is two briefs, not zero — if the
    send then fails, tomorrow's arrives as usual and nothing is stuck.
  */
  await ref.set({ lastSentOn: today, claimedAt: Timestamp.now() }, { merge: true });

  try {
    const brief = await buildOwnerBrief();
    await sendBotMessage(ownerId, formatOwnerBrief(brief));
    logger.info({ day: today }, 'Owner brief sent');
    return true;
  } catch (error) {
    logger.error({ err: error, day: today }, 'Could not send the owner brief');
    return false;
  }
}

/** Platform-local hour, 0-23. */
function platformHour(now: Date): number {
  const sinceMidnight = now.getTime() - startOfPlatformDay(now).getTime();
  return Math.floor(sinceMidnight / 3_600_000);
}

/**
 * What has actually been paid out, today and yesterday.
 *
 * One query covering both days rather than two: the split is trivial in
 * memory, and this runs against the same index the payout ceiling uses.
 */
async function sumRecentPayouts(): Promise<{
  todayKobo: Kobo;
  yesterdayKobo: Kobo;
  yesterdayCount: number;
}> {
  const todayStart = startOfPlatformDay();
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const collection = db().collection(COLLECTIONS.withdrawals);

  const { docs } = await runFilteredQuery({
    narrow: collection
      .where('status', '==', 'COMPLETED')
      .where('reviewedAt', '>=', Timestamp.fromDate(yesterdayStart)),
    base: collection.where('status', '==', 'COMPLETED'),
    matches: (doc) => millisOf(doc.get('reviewedAt')) >= yesterdayStart.getTime(),
    label: 'briefing.sumRecentPayouts',
    cap: 2_000,
  });

  let todayKobo = 0;
  let yesterdayKobo = 0;
  let yesterdayCount = 0;

  for (const doc of docs) {
    const at = millisOf(doc.get('reviewedAt'));
    const amount = (doc.get('amountKobo') as number | undefined) ?? 0;
    if (at >= todayStart.getTime()) {
      todayKobo += amount;
    } else {
      yesterdayKobo += amount;
      yesterdayCount += 1;
    }
  }

  return { todayKobo, yesterdayKobo, yesterdayCount };
}

/**
 * Tell the owner when work has gone stale.
 *
 * The daily brief says what is waiting. This says what has been waiting *too
 * long* — a different signal, and the one that matters when the person doing
 * the work has gone quiet without saying so. A user whose screenshot has sat
 * for three days has been abandoned, whatever the queue length says.
 *
 * Sent at most once a day, and only when something is actually wrong. An alert
 * that arrives on a good day teaches people to ignore it on a bad one.
 */
const STALE_SUBMISSION_HOURS = 36;
const STALE_WITHDRAWAL_HOURS = 48;
const STALE_STATE_DOC = 'staleWorkAlert';

export async function sendStaleWorkAlertIfNeeded(now = new Date()): Promise<boolean> {
  const ownerId = env.PRIMARY_ADMIN_TELEGRAM_ID;
  if (!ownerId) return false;

  /*
    The "already sent today" check comes first, and that ordering is the whole
    cost of this function.

    It ran the other way round: both queues were scanned, and only then did it
    notice it had already alerted. The scheduler ticks every ten minutes, so a
    queue of five thousand pending items meant scanning it a hundred and
    forty-four times a day to send at most one message. One cheap read now
    answers "is there anything to do?", and the expensive part never runs on
    the other hundred and forty-three ticks.
  */
  const today = platformDayKey(now);
  const ref = db().collection(COLLECTIONS.systemSettings).doc(STALE_STATE_DOC);
  const snapshot = await ref.get();
  if ((snapshot.get('lastSentOn') as string | undefined) === today) return false;

  const [submissionHours, withdrawalHours] = await Promise.all([
    oldestPendingSubmissionHours(),
    oldestPendingWithdrawalHours(),
  ]);

  const staleSubmission = submissionHours !== null && submissionHours >= STALE_SUBMISSION_HOURS;
  const staleWithdrawal = withdrawalHours !== null && withdrawalHours >= STALE_WITHDRAWAL_HOURS;
  if (!staleSubmission && !staleWithdrawal) return false;

  await ref.set({ lastSentOn: today, claimedAt: Timestamp.now() }, { merge: true });

  const lines = ['⏳ <b>Work is sitting unattended</b>', ''];
  if (staleSubmission && submissionHours !== null) {
    lines.push(
      `📸 A screenshot has waited <b>${String(Math.floor(submissionHours))} hours</b> for review.`,
    );
  }
  if (staleWithdrawal && withdrawalHours !== null) {
    lines.push(
      `💸 A withdrawal has waited <b>${String(Math.floor(withdrawalHours))} hours</b> to be paid.`,
    );
  }
  lines.push('', 'Users are waiting on a person. Worth a nudge.');

  try {
    await sendBotMessage(ownerId, lines.join('\n'));
    logger.warn({ submissionHours, withdrawalHours }, 'Stale work alert sent to the owner');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Could not send the stale work alert');
    return false;
  }
}

/**
 * How long the oldest unreviewed submission has been waiting.
 *
 * One row, not five hundred. This used to fetch a capped page of the pending
 * queue and pick the minimum out of it in memory, which cost a read per
 * pending item and — worse — could miss the genuinely oldest one entirely once
 * the queue passed the cap, which is exactly when the answer matters.
 *
 * Asking the database for the single oldest row is one read at any queue size,
 * and it is right at every size.
 */
async function oldestPendingSubmissionHours(): Promise<number | null> {
  return oldestPendingAge({
    collection: COLLECTIONS.taskSubmissions,
    status: 'PENDING_REVIEW',
    timestampField: 'submittedAt',
    label: 'briefing.oldestPendingSubmission',
  });
}

/** How long the oldest unpaid withdrawal has been waiting. */
async function oldestPendingWithdrawalHours(): Promise<number | null> {
  return oldestPendingAge({
    collection: COLLECTIONS.withdrawals,
    status: 'PENDING',
    timestampField: 'requestedAt',
    label: 'briefing.oldestPendingWithdrawal',
  });
}

async function oldestPendingAge(options: {
  collection: string;
  status: string;
  timestampField: string;
  label: string;
}): Promise<number | null> {
  const collection = db().collection(options.collection);
  const base = collection.where('status', '==', options.status);

  const snapshot = await runOrderedQuery({
    base,
    ordered: base.orderBy(options.timestampField, 'asc').limit(1),
    limit: 1,
    // The fallback sorts newest-first, so it is negated to find the oldest.
    timestampOf: (data) => -millisOf(data[options.timestampField]),
    label: options.label,
  });

  const doc = snapshot.docs[0];
  if (!doc) return null;

  const at = millisOf(doc.get(options.timestampField));
  return at > 0 ? (Date.now() - at) / 3_600_000 : null;
}
