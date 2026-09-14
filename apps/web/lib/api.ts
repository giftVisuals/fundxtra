import { GENERIC_ERROR_MESSAGE, type ApiResponse } from '@fundxtra/shared';
import { config } from './config';

/**
 * API client.
 *
 * One place owns the envelope, the bearer token and error translation, so no
 * component ever parses a response shape or decides what to show a user on
 * failure.
 *
 * The session token is held in memory, not in `localStorage`. That is a
 * deliberate trade: a Mini App session is short-lived and Telegram re-supplies
 * `initData` on every open, so persisting a bearer token buys almost nothing
 * and would leave it readable by any script that ever reaches the page.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A field-level message for a form, if the server supplied one. */
  fieldError(name: string): string | undefined {
    return this.fields?.[name];
  }

  get isAuthError(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.status === 401;
  }

  get needsPin(): boolean {
    return this.code === 'PIN_REQUIRED';
  }

  /** The platform is closed for maintenance; the whole app must lock down. */
  get isMaintenance(): boolean {
    return this.code === 'MAINTENANCE';
  }
}

let sessionToken: string | null = null;
/** Invoked when the server rejects the session, so the app can re-authenticate. */
let onUnauthenticated: (() => void) | null = null;
/** Invoked when the server reports a lockdown, so the app can close itself. */
let onMaintenance: ((message: string) => void) | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/**
 * Register what happens when any request comes back MAINTENANCE.
 *
 * It is global because a lockdown is global: an admin can flip the switch
 * while someone is mid-scroll, and the next request they make must close the
 * whole app rather than draw one failed panel inside a dashboard that is no
 * longer allowed to exist.
 */
export function setMaintenanceHandler(handler: ((message: string) => void) | null): void {
  onMaintenance = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the bearer token, for public endpoints. */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Multipart upload; `body` must be a FormData. */
  multipart?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    anonymous = false,
    signal,
    multipart = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const headers: Record<string, string> = {};
  if (!multipart && body !== undefined) headers['content-type'] = 'application/json';
  if (!anonymous && sessionToken) headers.authorization = `Bearer ${sessionToken}`;

  // A request that hangs forever is worse than one that fails: inside Telegram
  // the user has no browser spinner to tell them anything is happening.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers,
      body: multipart ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'That took too long. Please check your connection and try again.', 0);
    }
    throw new ApiError(
      'NETWORK',
      'We could not reach Fundxtra. Please check your connection.',
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    // A non-JSON body means something upstream failed (a proxy, a cold start).
    throw new ApiError('INTERNAL', GENERIC_ERROR_MESSAGE, response.status);
  }

  if (!response.ok || !payload || payload.ok === false) {
    const error = payload && payload.ok === false ? payload.error : null;
    const apiError = new ApiError(
      error?.code ?? 'INTERNAL',
      error?.message ?? GENERIC_ERROR_MESSAGE,
      response.status,
      error?.fields,
      error?.requestId,
    );
    // 401 means the session is gone; let the app re-run the Telegram handshake
    // rather than showing an error the user cannot act on.
    if (apiError.isAuthError) onUnauthenticated?.();
    if (apiError.isMaintenance) onMaintenance?.(apiError.message);
    throw apiError;
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    apiRequest<T>(path, { method: 'POST', body: formData, multipart: true, timeoutMs: 45_000 }),
};

/** Turn any thrown value into copy that is safe to render. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return GENERIC_ERROR_MESSAGE;
}

export function errorRequestId(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}
