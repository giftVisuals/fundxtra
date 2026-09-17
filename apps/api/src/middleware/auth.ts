import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, hasPermission, type Permission } from '@fundxtra/shared';
import { AppError, channelRequired, forbidden, maintenance, unauthenticated } from '../lib/errors';
import { bearerToken, verifySession, type SessionClaims } from '../lib/session';
import { assertUsable, findUser, invalidateUser } from '../services/users';
import { isPrimaryAdmin, resolveAdmin, touchAdmin } from '../services/admins';
import { getSettings } from '../services/settings';
import { channelInvite, channelMembership } from '../services/channel';
import { recordSecurityEvent } from '../services/security';

/**
 * Authentication and authorisation.
 *
 * The chain is deliberately ordered so that nothing downstream has to think
 * about trust:
 *
 *   requireSession  -> a valid, unexpired JWT exists
 *   loadUser        -> the user is re-read from Firestore (never from the token)
 *   requirePin      -> the PIN was entered in this session
 *   requireAdmin    -> admin status is resolved from the database, per request
 *
 * Admin status and balance are never carried in the token. That is the point:
 * a token cannot claim authority it was not issued, and revoking an admin takes
 * effect on their next request rather than when their session happens to expire.
 */

export const requireSession: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req.header('authorization'));
  if (!token) {
    next(unauthenticated('No bearer token supplied'));
    return;
  }
  try {
    req.session = verifySession(token);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Load the user from Firestore and reject unusable accounts.
 *
 * Served from a few seconds of cache for GET requests, which is what makes a
 * screen that fires three calls at once cost one read instead of three.
 *
 * Anything that is not a GET reads fresh and clears the cache twice: once
 * before, so the request that moves money sees the true balance, and once
 * after it has finished, so whatever it wrote cannot be served stale to the
 * next reader. That pair is the entire safety argument for caching a document
 * that holds a balance — the TTL is only there for what this misses.
 */
export const loadUser: RequestHandler = async (req, res, next) => {
  try {
    if (!req.session) throw unauthenticated('Session missing');

    const userId = req.session.sub;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';

    if (mutating) {
      invalidateUser(userId);
      res.on('finish', () => {
        invalidateUser(userId);
      });
    }

    const user = await findUser(userId, { fresh: mutating });
    if (!user) throw unauthenticated(`Session subject ${userId} no longer exists`);

    assertUsable(user);
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/** Require that the PIN was verified in this session. */
export const requirePin: RequestHandler = (req, _res, next) => {
  if (!req.session?.pinVerified) {
    next(new AppError(ERROR_CODES.PIN_REQUIRED, { detail: 'Session is not PIN-verified' }));
    return;
  }
  next();
};

/** The standard authenticated stack. */
export const authenticated: RequestHandler[] = [requireSession, loadUser];

/** Authenticated *and* PIN-verified — required for anything that moves money. */
export const pinProtected: RequestHandler[] = [requireSession, loadUser, requirePin];

/**
 * Resolve admin status from the database on every request.
 * Attaches `req.admin` when the caller is an admin; does not reject.
 */
export const loadAdmin: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.session) {
      next();
      return;
    }
    const admin = await resolveAdmin(req.session.telegramId, req.session.username);
    if (admin) {
      req.admin = admin;
      touchAdmin(admin.telegramId);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.admin) {
    recordSecurityEvent({
      type: 'FORBIDDEN_ACCESS',
      userId: req.user?.id ?? req.session?.sub ?? null,
      telegramId: req.session?.telegramId ?? null,
      ip: req.clientIp,
      message: 'Non-admin attempted to reach an admin route',
      metadata: { path: req.originalUrl.split('?')[0] },
    });
    next(forbidden('Caller is not an admin'));
    return;
  }
  next();
};

/** Declare the permission a route needs, rather than comparing role strings. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const admin = req.admin;
    if (!admin) {
      next(forbidden('Caller is not an admin'));
      return;
    }
    if (!hasPermission(admin.role, admin.extraPermissions, permission)) {
      recordSecurityEvent({
        type: 'FORBIDDEN_ACCESS',
        userId: admin.telegramId,
        telegramId: admin.telegramId,
        ip: req.clientIp,
        message: `Admin lacks the "${permission}" permission`,
        metadata: { role: admin.role, permission },
      });
      next(forbidden(`Missing permission: ${permission}`));
      return;
    }
    next();
  };
}

/** The admin stack: session, user, admin resolution, admin requirement. */
export const adminOnly: RequestHandler[] = [requireSession, loadUser, loadAdmin, requireAdmin];

/**
 * Is this caller an admin, wherever the question is asked?
 *
 * `req.admin` is only populated where `loadAdmin` has run, which is the admin
 * router and a handful of named routes. The app-wide gates below sit in front
 * of routers that resolve their own session *later*, so at that point
 * `req.admin` is undefined for everybody — including the owner. Reading it
 * alone is what made maintenance mode lock the admin out of their own app: the
 * dashboard let them in, and then every panel behind it was refused.
 *
 * So the session is read from the bearer token here when the middleware chain
 * has not produced one yet. The primary admin is recognised from the token
 * alone; anyone else costs one read, and only while a gate is actually closed.
 */
export async function callerIsAdmin(req: Request): Promise<boolean> {
  if (req.admin) return true;

  const session = req.session ?? sessionFromHeader(req);
  if (!session) return false;

  // Free: the owner's id is a constant, not a row.
  if (isPrimaryAdmin(session.telegramId)) return true;

  const admin = await resolveAdmin(session.telegramId, session.username);
  return Boolean(admin);
}

/** The session a request carries, without rejecting one that carries none. */
function sessionFromHeader(req: Request): SessionClaims | null {
  const token = bearerToken(req.header('authorization'));
  if (!token) return null;
  try {
    return verifySession(token);
  } catch {
    // An invalid token is not this middleware's error to raise; the route's
    // own `requireSession` will reject it with the right code.
    return null;
  }
}

/**
 * Block non-admin traffic during maintenance.
 *
 * Maintenance mode is a full lockdown, not a banner: while it is on, a
 * non-admin gets nothing from this API — no dashboard, no balance, no task
 * list, no session at all. The one thing they do get is the reason, carried in
 * the MAINTENANCE code and in whatever message the admin typed in Settings, so
 * the app can lock its screen and say why instead of showing a broken
 * dashboard full of failed panels.
 *
 * Admins keep working throughout, because the lockdown is usually theirs to
 * lift — and an outage that also locks out the only person who can end it is
 * an outage nobody can end.
 */
export const maintenanceGate: RequestHandler = async (req, _res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.platform.maintenanceMode || (await callerIsAdmin(req))) {
      next();
      return;
    }
    next(maintenance(settings.platform.maintenanceMessage));
  } catch (error) {
    next(error);
  }
};

/**
 * Require membership of the Telegram channel, when an admin has made it
 * required.
 *
 * Sits beside the maintenance gate and works the same way, with the same
 * exemption: an admin is never blocked. Locking the owner or the person
 * reviewing screenshots out of the platform because they are not subscribed
 * to its announcements would be a self-inflicted outage.
 *
 * A request with no session passes through untouched — it is not this
 * middleware's job to reject it, and the route behind it will. Only a
 * definite "not a member" blocks; see services/channel.ts for why.
 */
export const channelGate: RequestHandler = async (req, _res, next) => {
  try {
    const settings = await getSettings();
    const invite = channelInvite(settings);
    if (!invite?.required) {
      next();
      return;
    }

    const session = req.session ?? sessionFromHeader(req);
    if (!session) {
      next();
      return;
    }

    /*
      Membership before admin status, deliberately.

      Membership is answered from memory for anyone already known to be in the
      channel, so the common case — a member making a request — touches neither
      Telegram nor Firestore. Asking "are you an admin?" first would put a
      database read in front of every request on the platform, which is a cost
      this codebase has already had to dig itself out of once.

      So the admin lookup happens only where it changes the outcome: someone
      who would otherwise be blocked.
    */
    const state = await channelMembership(session.telegramId, invite.handle);
    if (state !== 'MISSING') {
      next();
      return;
    }

    if (await callerIsAdmin(req)) {
      next();
      return;
    }
    next(channelRequired(`${session.telegramId} is not in ${invite.handle}`));
  } catch (error) {
    next(error);
  }
};
