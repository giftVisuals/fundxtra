import { Router } from 'express';
import {
  paginationSchema,
  redeemAirtimeSchema,
  redeemDataSchema,
  redeemPremiumSchema,
  redeemStarsSchema,
  withdrawalRequestSchema,
  type Kobo,
} from '@fundxtra/shared';
import { RATE_LIMITS } from '../lib/rate-limit';
import { authenticated, pinProtected } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { ok } from '../middleware/respond';
import { parsed, pathParam, query, validateBody, validateQuery } from '../middleware/validate';
import { checkPin } from '../services/auth';
import { getTransactionReceipt, listUserTransactions } from '../services/ledger';
import { listRewardCatalogue, listUserRedemptions, redeem } from '../services/rewards';
import { getSettings, withdrawalAvailability } from '../services/settings';
import { cancelWithdrawal, listUserWithdrawals, requestWithdrawal } from '../services/withdrawals';

/**
 * Wallet, withdrawal and reward routes.
 *
 * Every money-out endpoint is PIN-protected *and* re-verifies the PIN supplied
 * in the request body. The session flag proves the user unlocked the app at
 * some point; the body PIN proves the person authorising this specific payment
 * is present right now, which is what matters if a phone is handed over
 * unlocked.
 */

export const walletRouter = Router();

/** One combined balance, plus what is currently in flight. */
walletRouter.get('/', ...authenticated, async (req, res, next) => {
  try {
    const user = req.user!;
    const settings = await getSettings();
    const availability = withdrawalAvailability(settings);

    ok(res, {
      balanceKobo: user.balanceKobo,
      pendingOutKobo: user.pendingOutKobo,
      lifetimeEarnedKobo: user.lifetimeEarnedKobo,
      lifetimePaidOutKobo: user.lifetimePaidOutKobo,
      withdrawals: {
        open: availability.open,
        notice: availability.reason,
        opensAt: availability.opensAt,
        minAmountKobo: settings.withdrawals.minAmountKobo,
        maxAmountKobo: settings.withdrawals.maxAmountKobo,
        dailyLimitKobo: settings.withdrawals.dailyLimitKobo,
        feeKobo: settings.withdrawals.feeKobo,
      },
    });
  } catch (error) {
    next(error);
  }
});

walletRouter.get(
  '/transactions',
  ...authenticated,
  validateQuery(paginationSchema),
  async (req, res, next) => {
    try {
      const { limit, cursor } = query<{ limit: number; cursor?: string }>(res);
      const page = await listUserTransactions(req.user!.id, { limit, cursor });
      ok(res, page);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * One transaction, with everything a receipt prints.
 *
 * Authenticated but not PIN-gated: reading your own history is not a money
 * movement, and demanding a PIN to look at a receipt would push people to
 * screenshot the list instead. Ownership is enforced in the service, which
 * answers "not found" for someone else's id rather than confirming it exists.
 */
walletRouter.get('/transactions/:transactionId', ...authenticated, async (req, res, next) => {
  try {
    const transactionId = pathParam(req, 'transactionId');
    ok(res, await getTransactionReceipt(req.user!.id, transactionId));
  } catch (error) {
    next(error);
  }
});

walletRouter.get('/withdrawals', ...authenticated, async (req, res, next) => {
  try {
    ok(res, { withdrawals: await listUserWithdrawals(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

walletRouter.post(
  '/withdrawals',
  ...pinProtected,
  rateLimit(RATE_LIMITS.payout, { name: 'withdrawal', by: 'user' }),
  validateBody(withdrawalRequestSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, withdrawalRequestSchema);

      // Re-verify the PIN for this specific payment, with the same lockout as
      // the unlock screen.
      await checkPin(user.id, input.pin);

      const withdrawal = await requestWithdrawal({
        user,
        amountKobo: input.amountKobo as Kobo,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
      });
      ok(res, { withdrawal }, 201);
    } catch (error) {
      next(error);
    }
  },
);

walletRouter.post('/withdrawals/:withdrawalId/cancel', ...pinProtected, async (req, res, next) => {
  try {
    const withdrawal = await cancelWithdrawal(req.user!.id, pathParam(req, 'withdrawalId'));
    ok(res, { withdrawal });
  } catch (error) {
    next(error);
  }
});

/** The reward catalogue, with an honest availability flag per item. */
walletRouter.get('/rewards', ...authenticated, async (_req, res, next) => {
  try {
    const catalogue = await listRewardCatalogue();
    ok(res, catalogue);
  } catch (error) {
    next(error);
  }
});

walletRouter.get('/redemptions', ...authenticated, async (req, res, next) => {
  try {
    ok(res, { redemptions: await listUserRedemptions(req.user!.id) });
  } catch (error) {
    next(error);
  }
});

walletRouter.post(
  '/rewards/airtime',
  ...pinProtected,
  rateLimit(RATE_LIMITS.payout, { name: 'redeem-airtime', by: 'user' }),
  validateBody(redeemAirtimeSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, redeemAirtimeSchema);
      await checkPin(user.id, input.pin);

      const outcome = await redeem({
        user,
        kind: 'AIRTIME',
        target: input.phone,
        network: input.network,
        amountKobo: input.amountKobo as Kobo,
      });
      ok(res, outcome, 201);
    } catch (error) {
      next(error);
    }
  },
);

walletRouter.post(
  '/rewards/data',
  ...pinProtected,
  rateLimit(RATE_LIMITS.payout, { name: 'redeem-data', by: 'user' }),
  validateBody(redeemDataSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, redeemDataSchema);
      await checkPin(user.id, input.pin);

      const outcome = await redeem({
        user,
        kind: 'DATA',
        productId: input.productId,
        target: input.phone,
      });
      ok(res, outcome, 201);
    } catch (error) {
      next(error);
    }
  },
);

walletRouter.post(
  '/rewards/stars',
  ...pinProtected,
  rateLimit(RATE_LIMITS.payout, { name: 'redeem-stars', by: 'user' }),
  validateBody(redeemStarsSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, redeemStarsSchema);
      await checkPin(user.id, input.pin);

      const outcome = await redeem({
        user,
        kind: 'TELEGRAM_STARS',
        productId: input.productId,
        target: input.telegramUsername,
      });
      ok(res, outcome, 201);
    } catch (error) {
      next(error);
    }
  },
);

walletRouter.post(
  '/rewards/premium',
  ...pinProtected,
  rateLimit(RATE_LIMITS.payout, { name: 'redeem-premium', by: 'user' }),
  validateBody(redeemPremiumSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, redeemPremiumSchema);
      await checkPin(user.id, input.pin);

      const outcome = await redeem({
        user,
        kind: 'TELEGRAM_PREMIUM',
        productId: input.productId,
        target: input.telegramUsername,
      });
      ok(res, outcome, 201);
    } catch (error) {
      next(error);
    }
  },
);
