/**
 * Money in Fundxtra.
 *
 * Every monetary value that crosses a boundary (Firestore, HTTP, the ledger) is
 * an **integer number of kobo**. 100 kobo = ₦1. Floating point naira is never
 * stored, summed, or compared, because `0.1 + 0.2 !== 0.3` is not an acceptable
 * property for a system that owes people money.
 *
 * Naming convention: any variable holding kobo ends in `Kobo`.
 */

/** An integer number of kobo. 100 kobo = ₦1. */
export type Kobo = number;

/** The largest amount the platform will represent: ₦1,000,000,000. */
export const MAX_KOBO: Kobo = 100_000_000_000;

export const KOBO_PER_NAIRA = 100;

/** Amounts at or above ₦10,000 are eligible for compact display. */
const COMPACT_THRESHOLD_KOBO: Kobo = 1_000_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** True when `value` is a safe, integral, in-range kobo amount (may be negative). */
export function isKobo(value: unknown): value is Kobo {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= -MAX_KOBO &&
    value <= MAX_KOBO
  );
}

/** Throws unless `value` is a valid kobo amount. Returns it narrowed. */
export function assertKobo(value: unknown, label = 'amount'): Kobo {
  if (!isKobo(value)) {
    throw new MoneyError(`${label} must be an integer number of kobo within range`);
  }
  return value;
}

/** Throws unless `value` is a valid, strictly positive kobo amount. */
export function assertPositiveKobo(value: unknown, label = 'amount'): Kobo {
  const kobo = assertKobo(value, label);
  if (kobo <= 0) throw new MoneyError(`${label} must be greater than zero`);
  return kobo;
}

/**
 * Convert whole or fractional naira to kobo.
 * Rounds half-up to the nearest kobo so that admin-entered values like `150.005`
 * resolve deterministically instead of inheriting binary float drift.
 */
export function nairaToKobo(naira: number): Kobo {
  if (typeof naira !== 'number' || !Number.isFinite(naira)) {
    throw new MoneyError('naira must be a finite number');
  }
  const scaled = naira * KOBO_PER_NAIRA;
  // Nudge by a *relative* epsilon before rounding. Values a hair under a .5
  // boundary purely because of binary representation (1.005 is stored as
  // 1.00499999999999989, so `1.005 * 100` is 100.49999999999999) must still
  // round half-up, or admin-entered amounts would silently lose a kobo.
  const nudged = scaled + Math.sign(scaled) * Math.abs(scaled) * 8 * Number.EPSILON;
  return assertKobo(Math.round(nudged), 'naira');
}

/** Convert kobo to a naira number. For display and API output only — never for arithmetic. */
export function koboToNaira(kobo: Kobo): number {
  return assertKobo(kobo) / KOBO_PER_NAIRA;
}

/** Sum kobo amounts, validating the result stays in range. */
export function addKobo(...amounts: Kobo[]): Kobo {
  let total = 0;
  for (const amount of amounts) total += assertKobo(amount);
  return assertKobo(total, 'sum');
}

/** `a - b`, validated. */
export function subtractKobo(a: Kobo, b: Kobo): Kobo {
  return assertKobo(assertKobo(a) - assertKobo(b), 'difference');
}

/** Multiply kobo by a unitless count (e.g. reward × completions). */
export function multiplyKobo(kobo: Kobo, factor: number): Kobo {
  if (!Number.isFinite(factor)) throw new MoneyError('factor must be finite');
  return assertKobo(Math.round(assertKobo(kobo) * factor), 'product');
}

const NAIRA_SIGN = '₦';

export interface FormatNairaOptions {
  /** Show `.00` even for whole naira. Default: false. */
  alwaysShowKobo?: boolean;
  /** Include the ₦ sign. Default: true. */
  showSign?: boolean;
  /** Render 1_250_000 as "₦1.25M". Default: false. */
  compact?: boolean;
  /** Render a leading `+` for positive amounts (ledger rows). Default: false. */
  signed?: boolean;
}

/**
 * Format kobo as Nigerian Naira for display.
 *
 * `formatNaira(485000)` -> "₦4,850"
 * `formatNaira(485050)` -> "₦4,850.50"
 * `formatNaira(-30000, { signed: true })` -> "-₦300"
 */
export function formatNaira(kobo: Kobo, options: FormatNairaOptions = {}): string {
  const { alwaysShowKobo = false, showSign = true, compact = false, signed = false } = options;
  const safe = isKobo(kobo) ? kobo : 0;
  const negative = safe < 0;
  const absolute = Math.abs(safe);

  let body: string;
  if (compact && absolute >= COMPACT_THRESHOLD_KOBO) {
    body = compactNaira(absolute);
  } else {
    const whole = Math.trunc(absolute / KOBO_PER_NAIRA);
    const remainder = absolute % KOBO_PER_NAIRA;
    const grouped = whole.toLocaleString('en-NG');
    body =
      remainder > 0 || alwaysShowKobo
        ? `${grouped}.${remainder.toString().padStart(2, '0')}`
        : grouped;
  }

  const prefix = negative ? '-' : signed ? '+' : '';
  return `${prefix}${showSign ? NAIRA_SIGN : ''}${body}`;
}

/** "1.25M" / "31.4K" for headline statistics. Input is absolute kobo. */
function compactNaira(absoluteKobo: Kobo): string {
  const naira = absoluteKobo / KOBO_PER_NAIRA;
  const units: Array<[number, string]> = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (naira >= size) {
      const scaled = naira / size;
      // Two decimals below 100 (31.45K reads precisely), none above (125K).
      const digits = scaled >= 100 ? 0 : 2;
      return `${trimTrailingZeros(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return Math.round(naira).toLocaleString('en-NG');
}

function trimTrailingZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/** Compact whole-number formatter for non-money counts (users, tasks). */
export function formatCount(value: number, compact = false): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.trunc(value);
  if (!compact || Math.abs(rounded) < 10_000) return rounded.toLocaleString('en-NG');
  return compactNaira(rounded * KOBO_PER_NAIRA);
}

/**
 * Parse user/admin input like "1,500", "₦1,500.50", " 300 " into kobo.
 * Returns `null` for anything that is not a clean amount, so callers can show a
 * field-level error rather than silently coercing to 0.
 */
export function parseNairaInput(input: string): Kobo | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s,₦]/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  try {
    return nairaToKobo(Number(cleaned));
  } catch {
    return null;
  }
}

/** Percentage of `part` within `total`, clamped to 0..100. Safe when total is 0. */
export function percentageOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}
