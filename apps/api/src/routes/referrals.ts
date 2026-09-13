import { Router } from 'express';
import { claimReferralSchema, ERROR_CODES } from '@fundxtra/shared';
import { AppError } from '../lib/errors';
import { RATE_LIMITS } from '../lib/rate-limit';
import { authenticated } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { ok } from '../middleware/respond';
import { parsed, validateBody } from '../middleware/validate';
import {
  claimReferralCode,
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
      /*
        Whether this user can still add a code, and what it is worth. Sent with
        the summary so the app never has to ask a second question to decide
        whether to show the box.
      */
      codeClaim: {
        available:
          settings.referrals.enabled &&
          !user.referredBy &&
          user.lifetimeEarnedKobo === 0 &&
          (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000 <=
            settings.referrals.lateClaimDays,
        bonusKobo: settings.referrals.joinBonusKobo,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Add a referral code after signing up without one.
 *
 * Rate limited per user: the code is somebody else's and is short, so an
 * unthrottled endpoint is a way to hunt for valid ones.
 */
referralsRouter.post(
  '/claim',
  ...authenticated,
  rateLimit(RATE_LIMITS.pin, { name: 'referral-claim', by: 'user' }),
  validateBody(claimReferralSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, claimReferralSchema);
      const outcome = await claimReferralCode(req.user!, input.code);

      if (!outcome.claimed) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          fields: { code: refusalMessage(outcome.reason) },
          detail: outcome.reason,
        });
      }

      ok(res, outcome);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Why a code was refused, in words the person reading it can act on.
 *
 * Deliberately does not distinguish "no such code" from "that code is yours" —
 * both say the code cannot be used. Telling someone which of the two it was
 * turns this endpoint into a way to test whether a guessed code exists.
 */
function refusalMessage(reason: string | undefined): string {
  switch (reason) {
    case 'ALREADY_ATTRIBUTED':
      return 'You already have a referral code on your account.';
    case 'ALREADY_EARNED':
      return 'A code can only be added before you start earning.';
    case 'WINDOW_CLOSED':
      return 'It is too late to add a code to this account.';
    case 'DISABLED':
      return 'Referrals are closed at the moment.';
    default:
      return 'That code cannot be used.';
  }
}
