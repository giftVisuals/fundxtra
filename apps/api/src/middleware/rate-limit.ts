import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '@fundxtra/shared';
import { AppError } from '../lib/errors';
import { rateLimiter, type RateLimitResult } from '../lib/rate-limit';
import { recordSecurityEvent } from '../services/security';

/**
 * Rate limiting middleware.
 *
 * Authenticated routes key on the user id, so one abusive account cannot
 * exhaust the budget for everyone behind the same carrier NAT — a real concern
 * for a Nigerian mobile-first product where many users share an egress IP.
 * Unauthenticated routes fall back to IP.
 */

export type KeySource = 'ip' | 'user' | 'user-or-ip';

export function rateLimit(
  policy: { limit: number; windowSeconds: number },
  options: { name: string; by?: KeySource } = { name: 'general' },
): RequestHandler {
  const by = options.by ?? 'user-or-ip';

  return (req: Request, res: Response, next: NextFunction) => {
    const identity =
      by === 'ip'
        ? req.clientIp
        : by === 'user'
          ? req.user?.id ?? req.session?.sub ?? req.clientIp
          : req.user?.id ?? req.session?.sub ?? req.clientIp;

    const key = `${options.name}:${identity}`;
    const result: RateLimitResult = rateLimiter.consume(key, policy.limit, policy.windowSeconds);

    res.setHeader('x-ratelimit-limit', String(policy.limit));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, result.remaining)));

    if (!result.allowed) {
      res.setHeader('retry-after', String(result.retryAfterSeconds));
      recordSecurityEvent({
        type: 'RATE_LIMITED',
        userId: req.user?.id ?? null,
        ip: req.clientIp,
        message: `Rate limit "${options.name}" exceeded`,
        metadata: { policy: options.name, limit: policy.limit },
      });
      next(
        new AppError(ERROR_CODES.RATE_LIMITED, {
          detail: `retry after ${result.retryAfterSeconds}s`,
        }),
      );
      return;
    }
    next();
  };
}
