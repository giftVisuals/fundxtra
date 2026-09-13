import { Timestamp } from 'firebase-admin/firestore';
import { LIMITS, type SystemSettings } from '@fundxtra/shared';
import { COLLECTIONS, DOC_IDS, db } from '../lib/firebase';
import { env } from '../config/env';
import { nowIso, toIso, toIsoRequired } from '../lib/time';
import { logger } from '../lib/logger';

/**
 * System settings.
 *
 * Read on nearly every request, so the document is cached in memory for a short
 * window. The TTL is short enough that flipping withdrawals off takes effect
 * within seconds, and every write invalidates the cache immediately, so an
 * admin toggling a switch sees it apply at once on the instance they used.
 */

const CACHE_TTL_MS = 15_000;

let cached: { value: SystemSettings; expiresAt: number } | null = null;

export function defaultSettings(): SystemSettings {
  return {
    withdrawals: {
      /*
        Cash withdrawals are open by default; airtime, data, Stars and Premium
        are not, because those need a fulfilment provider and NasfamPay's API
        does not exist yet — they show as "coming soon" instead of pretending.

        Open does not mean automatic: `requireManualApproval` below stays true,
        so every request waits for an admin. No money leaves without a person
        approving it, and an admin can close the portal entirely from Settings.
      */
      enabled: true,
      maintenanceMessage:
        'Withdrawals open shortly. Your balance is safe and will be waiting for you.',
      opensAt: null,
      closesAt: null,
      minAmountKobo: LIMITS.MIN_CASH_WITHDRAWAL_KOBO,
      maxAmountKobo: LIMITS.MAX_CASH_WITHDRAWAL_KOBO,
      dailyLimitKobo: LIMITS.DAILY_WITHDRAWAL_LIMIT_KOBO,
      platformDailyPayoutKobo: LIMITS.PLATFORM_DAILY_PAYOUT_CEILING_KOBO,
      feeKobo: 0,
      requireManualApproval: true,
    },
    rewards: {
      airtimeEnabled: false,
      dataEnabled: false,
      starsEnabled: false,
      premiumEnabled: false,
      minAirtimeKobo: LIMITS.MIN_AIRTIME_KOBO,
      minDataKobo: LIMITS.MIN_DATA_KOBO,
      activeProvider: env.REWARD_PROVIDER,
    },
    referrals: {
      enabled: true,
      rewardKobo: LIMITS.REFERRAL_REWARD_KOBO,
      joinBonusKobo: LIMITS.REFERRAL_JOIN_BONUS_KOBO,
      lateClaimDays: 7,
    },
    tasks: {
      maxRewardKobo: LIMITS.MAX_TASK_REWARD_KOBO,
      earningEnabled: true,
      // On by default, but dormant without GROQ_API_KEY — so nothing changes
      // for an installation that has not configured a reviewer.
      autoReviewEnabled: true,
    },
    platform: {
      maintenanceMode: false,
      maintenanceMessage: 'Fundxtra is being updated. Please check back shortly.',
      botUsername: env.TELEGRAM_BOT_USERNAME,
      supportHandle: '@fundxtracarebot',
      publicStatsEnabled: true,
    },
    updatedBy: null,
    updatedAt: nowIso(),
  };
}

/** Merge stored values over the defaults, so a new setting never reads undefined. */
function hydrate(data: Record<string, unknown> | undefined): SystemSettings {
  const base = defaultSettings();
  if (!data) return base;

  const section = <K extends keyof SystemSettings>(key: K): SystemSettings[K] => {
    const stored = data[key as string];
    if (!stored || typeof stored !== 'object') return base[key];
    return { ...(base[key] as object), ...(stored as object) } as SystemSettings[K];
  };

  return {
    withdrawals: section('withdrawals'),
    rewards: section('rewards'),
    referrals: section('referrals'),
    tasks: section('tasks'),
    platform: section('platform'),
    updatedBy: (data.updatedBy as string | null) ?? null,
    updatedAt: toIsoRequired(data.updatedAt, base.updatedAt),
  };
}

export async function getSettings(options: { fresh?: boolean } = {}): Promise<SystemSettings> {
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const snapshot = await db()
      .collection(COLLECTIONS.systemSettings)
      .doc(DOC_IDS.settings)
      .get();
    const value = hydrate(snapshot.data());
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (error) {
    logger.error({ err: error }, 'Failed to read system settings; falling back to defaults');
    // Failing closed: the defaults have withdrawals and every reward disabled,
    // so a settings outage cannot accidentally open a money path.
    return defaultSettings();
  }
}

export async function updateSettings(
  patch: Record<string, unknown>,
  actorId: string,
): Promise<SystemSettings> {
  const ref = db().collection(COLLECTIONS.systemSettings).doc(DOC_IDS.settings);
  await ref.set(
    { ...patch, updatedBy: actorId, updatedAt: Timestamp.now() },
    { merge: true },
  );
  cached = null;
  return getSettings({ fresh: true });
}

export function invalidateSettingsCache(): void {
  cached = null;
}

/**
 * Whether withdrawals are open right now.
 *
 * The scheduled window, when set, takes precedence over the manual switch: an
 * admin can schedule "open Friday 9am, close Sunday 6pm" and not have to
 * remember to flip the toggle. The reason string is what users are shown.
 */
export function withdrawalAvailability(settings: SystemSettings): {
  open: boolean;
  reason: string | null;
  opensAt: string | null;
} {
  const { enabled, maintenanceMessage, opensAt, closesAt } = settings.withdrawals;
  const now = Date.now();

  const opensAtMs = opensAt ? new Date(opensAt).getTime() : null;
  const closesAtMs = closesAt ? new Date(closesAt).getTime() : null;

  if (opensAtMs && now < opensAtMs) {
    return { open: false, reason: 'Withdrawals open soon.', opensAt: toIso(opensAt) };
  }
  if (closesAtMs && now > closesAtMs) {
    return { open: false, reason: maintenanceMessage, opensAt: null };
  }
  if (!enabled) {
    return { open: false, reason: maintenanceMessage, opensAt: toIso(opensAt) };
  }
  return { open: true, reason: null, opensAt: null };
}
