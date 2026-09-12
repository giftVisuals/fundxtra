/** ISO-8601 UTC timestamp string. All API boundaries use strings, not Firestore Timestamps. */
export type IsoDate = string;

export interface Paginated<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when the list is exhausted. */
  nextCursor: string | null;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    /** Always user-safe. Technical detail is logged server-side only. */
    message: string;
    /** Field-level messages for form validation. */
    fields?: Record<string, string>;
    /** Correlation id for support to look the incident up in logs. */
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
