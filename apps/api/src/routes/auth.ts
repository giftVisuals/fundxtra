import { Router } from 'express';
import {
  changePinSchema,
  createPinSchema,
  telegramAuthSchema,
  toSignupSource,
  verifyPinSchema,
  type UserProfile,
} from '@fundxtra/shared';
import { env, hasTelegram } from '../config/env';
import { unauthenticated } from '../lib/errors';
import { newUuid } from '../lib/ids';
import { issueSession } from '../lib/session';
import { verifyInitData, type TelegramUser } from '../lib/telegram-auth';
import { RATE_LIMITS } from '../lib/rate-limit';
import { authenticated, loadAdmin, requireSession } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { ok } from '../middleware/respond';
import { parsed, validateBody } from '../middleware/validate';
import { changePin, checkPin, createPin, getPinStatus } from '../services/auth';
import { attributeReferral, qualifyReferral } from '../services/referrals';
import { recordSecurityEvent } from '../services/security';
import { getSettings } from '../services/settings';
import { buildDashboard, findOrCreateUser, markOnboarded, requireUser, toProfile } from '../services/users';
import { resolveAdmin } from '../services/admins';

/**
 * Authentication routes.
 *
 * The flow the product specifies, and where each step is enforced:
 *
 *   1. User starts the bot and opens the Mini App.
 *   2. Telegram hands the frontend `initData`.
 *   3. POST /auth/telegram  — the signature is verified *server-side* here.
 *   4. The user is found or created from the verified Telegram id.
 *   5. First-timers are told `needsPin`, and POST /auth/pin sets it.
 *   6. GET /auth/session marks onboarding complete, which is the moment a
 *      pending referral qualifies and the referrer is paid ₦100.
 *
 * The frontend's copy of the Telegram user object is never trusted: only the
 * object embedded in the HMAC-verified payload is read.
 */

export const authRouter = Router();

interface AuthResponse {
  token: string;
  expiresAt: string;
  needsPin: boolean;
  pinLocked: boolean;
  lockedUntil: string | null;
  user: UserProfile;
  isAdmin: boolean;
  adminRole: string | null;
}

authRouter.post(
  '/telegram',
  rateLimit(RATE_LIMITS.auth, { name: 'auth', by: 'ip' }),
  validateBody(telegramAuthSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, telegramAuthSchema);
      const telegramUser = await authenticateTelegram(input.initData, req.clientIp, input.startParam);

      /*
        One `?start=` payload, two possible meanings.

        A reserved word like `website` names the channel the person arrived
        through; anything else is treated as a referral code. Checked in that
        order, and against a fixed list, so a channel name can never be looked
        up as a referrer — and so the landing page can be measured without
        asking anyone where they came from or inventing a number.
      */
      const startPayload = telegramUser.startParam ?? input.startParam ?? null;
      const signupSource = toSignupSource(startPayload);

      const { user, created } = await findOrCreateUser(telegramUser.user, { signupSource });

      // Referral attribution happens on first contact only.
      if (created && startPayload && !signupSource) {
        await attributeReferral(user, startPayload);
      }

      const settings = await getSettings();
      const pinStatus = await getPinStatus(user.id);
      const admin = await resolveAdmin(user.telegramId, user.username);

      // The session is issued un-PIN-verified. Nothing that moves money is
      // reachable until POST /auth/pin/verify upgrades it.
      const session = issueSession({
        userId: user.id,
        telegramId: user.telegramId,
        username: user.username,
        pinVerified: false,
        sessionId: newUuid(),
      });

      recordSecurityEvent({
        type: 'SESSION_ISSUED',
        userId: user.id,
        telegramId: user.telegramId,
        ip: req.clientIp,
        message: created ? 'First session for a new user' : 'Session issued',
        metadata: { created, isAdmin: Boolean(admin) },
      });

      const payload: AuthResponse = {
        token: session.token,
        expiresAt: session.expiresAt,
        needsPin: !pinStatus.hasPin,
        pinLocked: pinStatus.locked,
        lockedUntil: pinStatus.lockedUntil,
        user: toProfile(user, settings.platform.botUsername),
        isAdmin: Boolean(admin),
        adminRole: admin?.role ?? null,
      };
      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Verify the Telegram payload.
 *
 * `ALLOW_DEV_AUTH` exists so the UI can be built without a bot token, and is
 * fenced three ways: the env flag must be on, NODE_ENV must not be production,
 * and no bot token may be configured. It also refuses to mint the primary
 * admin's id, so a misconfigured staging box cannot hand out owner access.
 */
async function authenticateTelegram(
  initData: string,
  ip: string,
  startParam?: string,
): Promise<{ user: TelegramUser; startParam: string | null }> {
  if (hasTelegram) {
    const result = verifyInitData(initData, env.TELEGRAM_BOT_TOKEN as string);
    if (!result.ok) {
      recordSecurityEvent({
        type: result.reason === 'EXPIRED' ? 'INITDATA_EXPIRED' : 'INITDATA_INVALID',
        ip,
        message: `Telegram initData rejected: ${result.reason}`,
        metadata: { reason: result.reason, detail: result.detail },
      });
      throw unauthenticated(`initData rejected: ${result.reason} — ${result.detail}`);
    }
    return { user: result.data.user, startParam: result.data.startParam };
  }

  if (env.ALLOW_DEV_AUTH && env.NODE_ENV !== 'production') {
    const devUser = parseDevAuth(initData);
    if (devUser) {
      return { user: devUser, startParam: startParam ?? null };
    }
  }

  throw unauthenticated(
    'TELEGRAM_BOT_TOKEN is not configured, so Telegram authentication cannot be verified',
  );
}

/** `dev:<telegramId>:<firstName>:<username>` — development only. */
function parseDevAuth(initData: string): TelegramUser | null {
  if (!initData.startsWith('dev:')) return null;
  const [, id, firstName, username] = initData.split(':');
  if (!id || !/^\d+$/.test(id)) return null;
  // Never let dev auth impersonate the platform owner.
  if (id === env.PRIMARY_ADMIN_TELEGRAM_ID) return null;
  return {
    id: Number.parseInt(id, 10),
    first_name: firstName || 'Dev User',
    username: username || undefined,
  };
}

/** PIN status for the unlock screen. */
authRouter.get('/pin/status', requireSession, async (req, res, next) => {
  try {
    if (!req.session) throw unauthenticated();
    const status = await getPinStatus(req.session.sub);
    ok(res, status);
  } catch (error) {
    next(error);
  }
});

/** First-time PIN creation. Upgrades the session to PIN-verified. */
authRouter.post(
  '/pin',
  ...authenticated,
  rateLimit(RATE_LIMITS.pin, { name: 'pin-create', by: 'user' }),
  validateBody(createPinSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, createPinSchema);

      await createPin(user.id, input.pin);

      const session = issueSession({
        userId: user.id,
        telegramId: user.telegramId,
        username: user.username,
        pinVerified: true,
        sessionId: newUuid(),
      });
      ok(res, { token: session.token, expiresAt: session.expiresAt });
    } catch (error) {
      next(error);
    }
  },
);

/** PIN unlock for a returning user. */
authRouter.post(
  '/pin/verify',
  ...authenticated,
  rateLimit(RATE_LIMITS.pin, { name: 'pin-verify', by: 'user' }),
  validateBody(verifyPinSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, verifyPinSchema);

      await checkPin(user.id, input.pin);

      const session = issueSession({
        userId: user.id,
        telegramId: user.telegramId,
        username: user.username,
        pinVerified: true,
        sessionId: newUuid(),
      });
      ok(res, { token: session.token, expiresAt: session.expiresAt });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/pin/change',
  ...authenticated,
  rateLimit(RATE_LIMITS.pin, { name: 'pin-change', by: 'user' }),
  validateBody(changePinSchema),
  async (req, res, next) => {
    try {
      const user = req.user!;
      const input = parsed(res, changePinSchema);
      await changePin(user.id, input.currentPin, input.newPin);
      ok(res, { changed: true });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The dashboard payload, and the referral qualification gate.
 *
 * Reaching this endpoint with a PIN set is exactly the condition the spec
 * defines as a qualified referral: started Fundxtra, created a PIN, reached the
 * dashboard. `markOnboarded` reports whether *this* call was the transition,
 * so `qualifyReferral` runs once — and even if it did not, the ledger's
 * idempotency key would refuse a second ₦100.
 */
authRouter.get('/session', ...authenticated, loadAdmin, async (req, res, next) => {
  try {
    const sessionUser = req.user!;

    /*
      Onboarding is recorded here, but it no longer pays the referrer.
      Qualification moved to the first completed task: setting a PIN is
      fifteen seconds of work, which made a referral reward collectable by
      anybody with a few throwaway Telegram accounts. See
      services/completions.ts.
    */
    if (sessionUser.hasPin) {
      await markOnboarded(sessionUser.id);
    }

    // Re-read: qualification may have changed this user's own counters, and a
    // stale profile here would show the wrong balance on first load.
    const user = await requireUser(sessionUser.id);
    const dashboard = await buildDashboard(user);

    ok(res, {
      ...dashboard,
      isAdmin: Boolean(req.admin),
      admin: req.admin
        ? {
            role: req.admin.role,
            displayName: req.admin.displayName,
            permissions: req.admin.extraPermissions,
          }
        : null,
      pinVerified: Boolean(req.session?.pinVerified),
    });
  } catch (error) {
    next(error);
  }
});

/** Refresh a session that is still valid, preserving the PIN-verified flag. */
authRouter.post('/refresh', ...authenticated, async (req, res, next) => {
  try {
    const user = req.user!;
    const session = issueSession({
      userId: user.id,
      telegramId: user.telegramId,
      username: user.username,
      pinVerified: Boolean(req.session?.pinVerified),
      sessionId: req.session?.sid || newUuid(),
    });
    ok(res, { token: session.token, expiresAt: session.expiresAt });
  } catch (error) {
    next(error);
  }
});

/** Support contact, so the client never hardcodes the handle. */
authRouter.get('/support', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    ok(res, {
      handle: settings.platform.supportHandle,
      url: `https://t.me/${settings.platform.supportHandle.replace(/^@/, '')}`,
      pinHelp: 'Forgot your PIN? Contact Fundxtra Support.',
    });
  } catch (error) {
    next(error);
  }
});
