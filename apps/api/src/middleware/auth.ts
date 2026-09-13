import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES, hasPermission, type Permission } from '@fundxtra/shared';
import { AppError, forbidden, unauthenticated } from '../lib/errors';
import { bearerToken, verifySession } from '../lib/session';
import { assertUsable, findUser, invalidateUser } from '../services/users';
import { resolveAdmin, touchAdmin } from '../services/admins';
import { getSettings } from '../services/settings';
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
 * Block non-admin traffic during maintenance.
 * Admins keep working so they can fix whatever caused the maintenance.
 */
export const maintenanceGate: RequestHandler = async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.platform.maintenanceMode || req.admin) {
      next();
      return;
    }
    res.status(503).json({
      ok: false,
      error: {
        code: 'MAINTENANCE',
        message: settings.platform.maintenanceMessage,
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
};
