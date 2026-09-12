import type { PublicStats } from '@fundxtra/shared';
import { config } from './config';

/**
 * Server-side fetching for the marketing site.
 *
 * Runs on the server with a short revalidation window rather than in the
 * browser, so the landing page paints with real numbers already in the HTML —
 * no spinner on first view, and no flash of zeroes before the statistics
 * arrive.
 *
 * Every call degrades to null rather than throwing. The marketing site must
 * render if the API is down: a visitor deciding whether to trust Fundxtra
 * should not be met with an error page because a backend deploy is in
 * progress.
 */

export interface PublicConfig {
  brand: { name: string; tagline: string; supportHandle: string; supportUrl: string };
  startEarningUrl: string;
  botUsername: string;
  referral: { rewardKobo: number; enabled: boolean };
  withdrawal: { minAmountKobo: number; open: boolean };
  maxTaskRewardKobo: number;
  rewards: {
    cash: boolean;
    airtime: boolean;
    data: boolean;
    telegramStars: boolean;
    telegramPremium: boolean;
  };
  pricing: {
    telegramStars: Array<{ stars: number; priceKobo: number }>;
    telegramPremium: Array<{ months: number; priceKobo: number }>;
  };
  maintenance: { active: boolean; message: string | null };
}

export interface PublicAnnouncement {
  id: string;
  title: string;
  body: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  ctaLabel: string | null;
  ctaUrl: string | null;
  createdAt: string;
}

/** Statistics refresh every 5 minutes; the catalogue every 15. */
const STATS_REVALIDATE_SECONDS = 300;
const CONFIG_REVALIDATE_SECONDS = 900;

async function fetchPublic<T>(path: string, revalidate: number): Promise<T | null> {
  try {
    const response = await fetch(`${config.apiUrl}/public${path}`, {
      next: { revalidate },
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok: boolean; data?: T };
    return payload.ok && payload.data !== undefined ? payload.data : null;
  } catch {
    // Network failure, cold start, DNS: the page still renders.
    return null;
  }
}

export async function getPublicStats(): Promise<PublicStats | null> {
  const result = await fetchPublic<{ stats: PublicStats | null; enabled: boolean }>(
    '/stats',
    STATS_REVALIDATE_SECONDS,
  );
  if (!result || !result.enabled) return null;
  return result.stats;
}

export async function getPublicConfig(): Promise<PublicConfig | null> {
  return fetchPublic<PublicConfig>('/config', CONFIG_REVALIDATE_SECONDS);
}

export async function getPublicAnnouncements(): Promise<PublicAnnouncement[]> {
  const result = await fetchPublic<{ announcements: PublicAnnouncement[] }>(
    '/announcements',
    STATS_REVALIDATE_SECONDS,
  );
  return result?.announcements ?? [];
}

/**
 * Fallback platform facts.
 *
 * Used when the API is unreachable. These are *product rules*, not
 * statistics — the ₦100 referral reward and the ₦300 minimum withdrawal are
 * fixed commitments, so showing them from a constant is accurate. Statistics
 * are never faked this way: when the API is down, the numbers simply do not
 * render.
 */
export function fallbackConfig(): PublicConfig {
  return {
    brand: {
      name: 'Fundxtra',
      tagline: 'Complete tasks. Earn rewards. Refer friends.',
      supportHandle: config.supportHandle,
      supportUrl: `https://t.me/${config.supportHandle.replace(/^@/, '')}`,
    },
    startEarningUrl: `https://t.me/${config.botUsername}`,
    botUsername: `@${config.botUsername}`,
    referral: { rewardKobo: 10_000, enabled: true },
    withdrawal: { minAmountKobo: 30_000, open: false },
    maxTaskRewardKobo: 100_000,
    rewards: {
      cash: true,
      airtime: false,
      data: false,
      telegramStars: false,
      telegramPremium: false,
    },
    pricing: {
      telegramStars: [
        { stars: 50, priceKobo: 130_000 },
        { stars: 100, priceKobo: 240_000 },
        { stars: 250, priceKobo: 550_000 },
        { stars: 500, priceKobo: 1_068_300 },
        { stars: 1_000, priceKobo: 2_120_000 },
      ],
      telegramPremium: [
        { months: 3, priceKobo: 1_700_000 },
        { months: 6, priceKobo: 2_260_000 },
        { months: 12, priceKobo: 4_070_000 },
      ],
    },
    maintenance: { active: false, message: null },
  };
}
