import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError } from '../lib/errors';
import { ERROR_CODES } from '@fundxtra/shared';

/**
 * Schema validation middleware.
 *
 * Handlers read the *parsed* value from `res.locals`, not the raw body, so a
 * route physically cannot reach untrusted input: if the schema stripped or
 * coerced a field, the handler only ever sees the clean version.
 */

export interface Validated<TBody = unknown, TQuery = unknown> {
  body: TBody;
  query: TQuery;
}

export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.body = schema.parse(req.body ?? {});
      next();
    } catch (error) {
      next(toAppError(error));
    }
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.query = schema.parse(req.query ?? {});
      next();
    } catch (error) {
      next(toAppError(error));
    }
  };
}

/** Typed accessors, so handlers do not litter casts everywhere. */
export function body<T>(res: Response): T {
  return res.locals.body as T;
}

export function query<T>(res: Response): T {
  return res.locals.query as T;
}

export function parsed<T extends ZodTypeAny>(res: Response, _schema: T): z.infer<T> {
  return res.locals.body as z.infer<T>;
}

function toAppError(error: unknown): unknown {
  if (!(error instanceof ZodError)) return error;
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'value';
    if (!fields[path]) fields[path] = issue.message;
  }
  return new AppError(ERROR_CODES.VALIDATION_FAILED, { fields });
}
