import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES, ERROR_MESSAGES, GENERIC_ERROR_MESSAGE, type ApiFailure } from '@fundxtra/shared';
import { AppError, isAppError, isZodError, zodFieldErrors } from '../lib/errors';
import { isProduction } from '../config/env';

/**
 * The single error boundary.
 *
 * Users get the stable, friendly copy from the shared error table plus a
 * request id they can quote to support. Diagnostics go to the log. `detail` is
 * attached to the response only for authenticated admins, which is what lets
 * operators troubleshoot without turning every user-facing error into a stack
 * trace.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = normalise(error);
  const isServerError = appError.status >= 500;

  req.log[isServerError ? 'error' : 'warn'](
    {
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      code: appError.code,
      status: appError.status,
      detail: appError.detail,
      userId: req.user?.id,
      path: req.originalUrl.split('?')[0],
    },
    isServerError ? 'Unhandled request failure' : 'Request rejected',
  );

  const body: ApiFailure = {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      requestId: req.requestId,
    },
  };
  if (appError.fields) body.error.fields = appError.fields;

  // Admins (and local development) get the diagnostic detail; users never do.
  if (appError.detail && (req.admin || !isProduction)) {
    (body.error as Record<string, unknown>).detail = appError.detail;
  }

  res.status(appError.status).json(body);
}

function normalise(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (isZodError(error)) {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: zodFieldErrors(error),
      detail: error.message,
    });
  }

  // Same CJS/ESM caveat as Zod: MoneyError is thrown inside @fundxtra/shared.
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'MoneyError'
  ) {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, {
      detail: `Money validation failed: ${(error as Error).message}`,
    });
  }

  // Firestore surfaces numeric gRPC codes; map the ones we can act on.
  const code = (error as { code?: number | string }).code;
  if (code === 6) {
    return new AppError(ERROR_CODES.DUPLICATE_REQUEST, { detail: 'Firestore ALREADY_EXISTS' });
  }
  if (code === 5) {
    return new AppError(ERROR_CODES.NOT_FOUND, { detail: 'Firestore NOT_FOUND' });
  }
  if (code === 8 || code === 4) {
    return new AppError(ERROR_CODES.RATE_LIMITED, {
      detail: 'Firestore resource exhausted or deadline exceeded',
    });
  }
  /*
    The codes below used to fall through to INTERNAL, which is how a missing
    composite index reached a user as "Something went wrong" with no way for
    anyone — including the operator — to tell a setup gap from a bug.

    Firestore's own message for code 9 contains a URL that creates the exact
    index required, so it is kept verbatim in `detail`: that field is returned
    only to admins and in development, and it is always logged.
  */
  if (code === 9) {
    const message = error instanceof Error ? error.message : String(error);
    // FAILED_PRECONDITION is overwhelmingly a missing index here, but not
    // exclusively, so the distinction is made on the message rather than
    // assumed from the code.
    return new AppError(
      /index/i.test(message)
        ? ERROR_CODES.DATABASE_SETUP_REQUIRED
        : ERROR_CODES.DATABASE_UNAVAILABLE,
      { detail: message },
    );
  }
  if (code === 7 || code === 16) {
    return new AppError(ERROR_CODES.DATABASE_UNAVAILABLE, {
      detail: `Firestore rejected the service credentials (gRPC ${String(code)}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
  if (code === 14) {
    return new AppError(ERROR_CODES.DATABASE_UNAVAILABLE, {
      detail: 'Firestore is unavailable (gRPC 14)',
    });
  }

  return new AppError(ERROR_CODES.INTERNAL, {
    message: GENERIC_ERROR_MESSAGE,
    detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    cause: error,
  });
}

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiFailure = {
    ok: false,
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: ERROR_MESSAGES.NOT_FOUND,
      requestId: req.requestId,
    },
  };
  res.status(404).json(body);
}
