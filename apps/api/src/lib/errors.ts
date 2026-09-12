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
  INTERNAL: 500,
};

export const unauthenticated = (detail?: string) =>
  new AppError(ERROR_CODES.UNAUTHENTICATED, { detail });
export const forbidden = (detail?: string) => new AppError(ERROR_CODES.FORBIDDEN, { detail });
export const notFound = (what = 'that', detail?: string) =>
  new AppError(ERROR_CODES.NOT_FOUND, { message: `We could not find ${what}.`, detail });
export const validationFailed = (fields: Record<string, string>, detail?: string) =>
  new AppError(ERROR_CODES.VALIDATION_FAILED, { fields, detail });
export const internal = (detail: string, cause?: unknown) =>
  new AppError(ERROR_CODES.INTERNAL, { detail, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
