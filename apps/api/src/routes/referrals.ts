import { Router } from 'express';
import { authenticated } from '../middleware/auth';
import { ok } from '../middleware/respond';
import {
  getReferralSummary,
  listReferrals,
  qualificationExplanation,
} from '../services/referrals';
import { getSettings } from '../services/settings';

export const referralsRouter = Router();

/**
 * Referral overview.
 *
 * Returns the qualification steps alongside the numbers, so the Mini App shows
 * the same explanation of when ₦100 is earned as the public site — the copy
 * lives in one place and cannot drift between surfaces.
 */
referralsRouter.get('/', ...authenticated, async (req, res, next) => {
  try {
    const user = req.user!;
    const [summary, settings] = await Promise.all([getReferralSummary(user), getSettings()]);
    const referrals = await listReferrals(user.id, { limit: 50 });

    ok(res, {
      summary,
      referrals: referrals.map((referral) => ({
        id: referral.id,
        firstName: referral.referredFirstName,
        username: referral.referredUsername,
        status: referral.status,
        rewardKobo: referral.rewardKobo,
        createdAt: referral.createdAt,
        qualifiedAt: referral.qualifiedAt,
      })),
      qualification: qualificationExplanation(settings.referrals.rewardKobo),
      enabled: settings.referrals.enabled,
    });
  } catch (error) {
    next(error);
  }
});
