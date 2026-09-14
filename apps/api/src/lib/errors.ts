import { ERROR_CODES, ERROR_MESSAGES, GENERIC_ERROR_MESSAGE, type ErrorCode } from '@fundxtra/shared';

/**
 * The only error type routes are allowed to throw.
 *
 * `message` is always the user-safe copy from the shared error table; anything
 * diagnostic goes in `detail`, which is logged but never serialised to a
 * non-admin client. That split is what keeps raw backend errors off users'
 * screens without blinding operators.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  /** Internal diagnostics. Logged; returned only to admins. */
  readonly detail?: string;
  override readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    options: {
      status?: number;
      message?: string;
      fields?: Record<string, string>;
      detail?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code] ?? 400;
    if (options.fields) this.fields = options.fields;
    if (options.detail) this.detail = options.detail;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  PIN_REQUIRED: 401,
  PIN_INVALID: 401,
  PIN_LOCKED: 423,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_BANNED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  DUPLICATE_REQUEST: 409,
  TASK_ALREADY_COMPLETED: 409,
  RATE_LIMITED: 429,
  PROVIDER_NOT_CONFIGURED: 503,
  VERIFICATION_UNAVAILABLE: 503,
  // 503, not 500: the service is temporarily unable to answer because of its
  // own configuration or a dependency, and the caller is right to retry.
  DATABASE_SETUP_REQUIRED: 503,
  DATABASE_UNAVAILABLE: 503,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

export const unauthenticated = (detail?: string) =>
  new AppError(ERROR_CODES.UNAUTHENTICATED, { detail });
export const forbidden = (detail?: string) => new AppError(ERROR_CODES.FORBIDDEN, { detail });
export const notFound = (what = 'that', detail?: string) =>
  new AppError(ERROR_CODES.NOT_FOUND, { message: `We could not find ${what}.`, detail });
export const validationFailed = (fields: Record<string, string>, detail?: string) =>
  new AppError(ERROR_CODES.VALIDATION_FAILED, { fields, detail });
/**
 * The platform is closed for maintenance.
 *
 * The message is the one an admin typed in Settings, so it carries whatever
 * they chose to tell people. 503 is the honest status: the service exists and
 * the caller should come back.
 */
export const maintenance = (message: string, detail?: string) =>
  new AppError(ERROR_CODES.MAINTENANCE, { message, detail });

export const internal = (detail: string, cause?: unknown) =>
  new AppError(ERROR_CODES.INTERNAL, { detail, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Structural check for a Zod error.
 *
 * `instanceof ZodError` is unreliable across the CJS/ESM boundary: the API
 * compiles to CommonJS and resolves `zod/index.cjs`, while `@fundxtra/shared`
 * can be loaded as ESM (in the bundler, in the web app, in vitest) and resolve
 * `zod/index.mjs` — two distinct classes for the same error. An `instanceof`
 * check then silently fails and every validation error becomes a 500.
 *
 * Matching on the shape avoids that whole class of bug.
 */
export function isZodError(
  error: unknown,
): error is { name: string; issues: Array<{ path: Array<string | number>; message: string }>; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

/** Collapse Zod issues into one message per field, for form display. */
export function zodFieldErrors(error: {
  issues: Array<{ path: Array<string | number>; message: string }>;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'value';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}
