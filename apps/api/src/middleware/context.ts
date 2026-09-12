import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Admin, User } from '@fundxtra/shared';
import type { SessionClaims } from '../lib/session';
import { logger, type Logger } from '../lib/logger';

/**
 * Request context.
 *
 * Everything downstream reads identity from here, never from the request body.
 * `req.user` and `req.admin` are populated only by the auth middleware after
 * server-side verification, so a handler cannot be tricked into trusting a
 * client-supplied user id or admin flag.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      session?: SessionClaims;
      user?: User;
      admin?: Admin;
      clientIp: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.header('x-request-id') || randomUUID()).slice(0, 64);
  // Railway sits behind a proxy; trust proxy is enabled on the app so
  // `req.ip` already reflects X-Forwarded-For.
  req.clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  req.log = logger.child({ requestId: req.requestId });
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** Access log. Emitted on response finish so it carries the status and duration. */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id,
        ip: req.clientIp,
      },
      'request',
    );
  });
  next();
}
