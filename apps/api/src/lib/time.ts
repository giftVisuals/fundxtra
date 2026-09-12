import { Timestamp } from 'firebase-admin/firestore';
import type { IsoDate } from '@fundxtra/shared';

/**
 * Time helpers.
 *
 * Firestore stores `Timestamp`; every API boundary speaks ISO-8601 strings.
 * Converting in one place stops `Timestamp` objects leaking into JSON responses
 * as `{_seconds, _nanoseconds}`.
 */

export const nowIso = (): IsoDate => new Date().toISOString();

export function toIso(value: unknown): IsoDate | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'object' && value !== null && '_seconds' in value) {
    const seconds = (value as { _seconds: number })._seconds;
    return new Date(seconds * 1000).toISOString();
  }
  return null;
}

/** `toIso` with a guaranteed string, for fields that are never null. */
export function toIsoRequired(value: unknown, fallback: IsoDate = nowIso()): IsoDate {
  return toIso(value) ?? fallback;
}

/**
 * Start of "today" in Africa/Lagos (UTC+1, no DST).
 * Daily figures must roll over at Nigerian midnight, not UTC midnight, or a
 * user's "today's earnings" would reset at 1am local time.
 */
export const PLATFORM_UTC_OFFSET_HOURS = 1;

export function startOfPlatformDay(reference: Date = new Date()): Date {
  const shifted = new Date(reference.getTime() + PLATFORM_UTC_OFFSET_HOURS * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - PLATFORM_UTC_OFFSET_HOURS * 3_600_000);
}

/** `YYYY-MM-DD` in platform-local time. Used for daily-limit bucket keys. */
export function platformDayKey(reference: Date = new Date()): string {
  const shifted = new Date(reference.getTime() + PLATFORM_UTC_OFFSET_HOURS * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function isPast(value: IsoDate | Date | null | undefined): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

export function isFuture(value: IsoDate | Date | null | undefined): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}
