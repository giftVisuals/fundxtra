import { logger } from './logger';
import { sendOwnerBriefIfDue, sendStaleWorkAlertIfNeeded } from '../services/briefing';

/**
 * The one recurring job the platform has.
 *
 * An in-process timer rather than a separate scheduled service, deliberately.
 * The API already runs as a single replica (see nixpacks.toml), so there is
 * exactly one of these, and adding a second deployment to run one function a
 * day would be more moving parts for an owner who is trying to have fewer.
 *
 * Everything it calls is idempotent and records what it has sent in Firestore
 * rather than in memory. That is what makes this safe: a deploy restarts the
 * process and the timer along with it, and without persisted state a busy
 * deployment day would send the morning brief five times — which is how a
 * useful alert becomes a muted one.
 *
 * The tick is frequent and the work is cheap: each pass usually reads one
 * document, decides it has nothing to do, and stops. It only costs anything on
 * the pass that actually sends something.
 *
 * If this ever needs to scale past one replica, the state documents these jobs
 * claim are already the lock — the claim is a write, so the loser of a race
 * finds the day already claimed and does nothing.
 */

const TICK_MS = 10 * 60_000;

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): void {
  if (timer) return;

  timer = setInterval(() => {
    void runScheduledWork();
  }, TICK_MS);

  // Never hold the process open for a timer: a shutdown should be a shutdown.
  timer.unref?.();

  logger.info({ everyMinutes: TICK_MS / 60_000 }, 'Scheduler started');
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/**
 * One pass. Exported so a test, or an operator, can make it happen now rather
 * than waiting for the tick.
 */
export async function runScheduledWork(): Promise<void> {
  // Sequential, not parallel: both read the same collections, and there is no
  // deadline here worth the extra concurrent reads.
  try {
    await sendOwnerBriefIfDue();
  } catch (error) {
    logger.error({ err: error }, 'Owner brief pass failed');
  }

  try {
    await sendStaleWorkAlertIfNeeded();
  } catch (error) {
    logger.error({ err: error }, 'Stale work pass failed');
  }
}
