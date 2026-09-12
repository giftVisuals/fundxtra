import { Router } from 'express';
import {
  BRAND,
  LIMITS,
  TELEGRAM_PREMIUM_PLANS,
  TELEGRAM_STARS_BUNDLES,
} from '@fundxtra/shared';
import { RATE_LIMITS } from '../lib/rate-limit';
import { rateLimit } from '../middleware/rate-limit';
import { ok } from '../middleware/respond';
import { listLiveAnnouncements } from '../services/announcements';
import { getSettings } from '../services/settings';
import { getPublicStats } from '../services/stats';

/**
 * Public, unauthenticated routes for the marketing site.
 *
 * Statistics come from the database, never from a hardcoded number. When the
 * platform is too young for the figures to be meaningful, `sufficientData` is
 * false and the site is expected to render an early-stage state instead — the
 * brief was explicit that statistics are not to be fabricated, and this is the
 * mechanism that makes that a property of the API rather than a promise.
 */

export const publicRouter = Router();

publicRouter.get(
  '/stats',
  rateLimit(RATE_LIMITS.publicApi, { name: 'public-stats', by: 'ip' }),
  async (_req, res, next) => {
    try {
      const [stats, settings] = await Promise.all([getPublicStats(), getSettings()]);

      // An admin can switch public statistics off entirely.
      if (!settings.platform.publicStatsEnabled) {
        ok(res, { stats: null, enabled: false });
        return;
      }
      ok(res, { stats, enabled: true });
    } catch (error) {
      next(error);
    }
  },
);

publicRouter.get(
  '/announcements',
  rateLimit(RATE_LIMITS.publicApi, { name: 'public-announcements', by: 'ip' }),
  async (_req, res, next) => {
    try {
      const announcements = await listLiveAnnouncements('PUBLIC');
      ok(res, {
        announcements: announcements.map((announcement) => ({
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          level: announcement.level,
          ctaLabel: announcement.ctaLabel,
          ctaUrl: announcement.ctaUrl,
          createdAt: announcement.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Platform facts the marketing site renders: reward pricing, limits, the bot
 * handle and which reward methods are actually live. Serving these rather than
 * duplicating them in the frontend is what keeps the public site from
 * advertising a reward that is switched off.
 */
publicRouter.get(
  '/config',
  rateLimit(RATE_LIMITS.publicApi, { name: 'public-config', by: 'ip' }),
  async (_req, res, next) => {
    try {
      const settings = await getSettings();
      const botUsername = settings.platform.botUsername.replace(/^@/, '');

      ok(res, {
        brand: {
          name: BRAND.name,
          tagline: BRAND.tagline,
          supportHandle: settings.platform.supportHandle,
          supportUrl: `https://t.me/${settings.platform.supportHandle.replace(/^@/, '')}`,
        },
        startEarningUrl: `https://t.me/${botUsername}`,
        botUsername: `@${botUsername}`,
        referral: {
          rewardKobo: settings.referrals.rewardKobo,
          enabled: settings.referrals.enabled,
        },
        withdrawal: {
          minAmountKobo: settings.withdrawals.minAmountKobo,
          open: settings.withdrawals.enabled,
        },
        maxTaskRewardKobo: LIMITS.MAX_TASK_REWARD_KOBO,
        rewards: {
          cash: true,
          airtime: settings.rewards.airtimeEnabled,
          data: settings.rewards.dataEnabled,
          telegramStars: settings.rewards.starsEnabled,
          telegramPremium: settings.rewards.premiumEnabled,
        },
        pricing: {
          telegramStars: TELEGRAM_STARS_BUNDLES.map((bundle) => ({
            stars: bundle.stars,
            priceKobo: bundle.priceKobo,
          })),
          telegramPremium: TELEGRAM_PREMIUM_PLANS.map((plan) => ({
            months: plan.months,
            priceKobo: plan.priceKobo,
          })),
        },
        maintenance: settings.platform.maintenanceMode
          ? { active: true, message: settings.platform.maintenanceMessage }
          : { active: false, message: null },
      });
    } catch (error) {
      next(error);
    }
  },
);
