import { nairaToKobo, type Kobo } from './money';

/** Public brand surface. */
export const BRAND = {
  name: 'Fundxtra',
  tagline: 'Complete tasks. Earn rewards. Refer friends.',
  description:
    'Fundxtra is a Telegram-first rewards platform. Complete sponsored tasks, earn Naira rewards, refer friends, then withdraw as cash or redeem for airtime, data, Telegram Stars and Telegram Premium.',
  publicUrl: 'https://fundxtra.name.ng',
  supportHandle: '@fundxtracarebot',
  supportUrl: 'https://t.me/fundxtracarebot',
  currency: 'NGN',
  currencySymbol: '₦',
  locale: 'en-NG',
} as const;

/**
 * Product rules. These are the *defaults*; anything an admin can change lives in
 * `systemSettings/global` and is read through the settings service at runtime.
 * The hard caps below are enforced server-side regardless of settings.
 */
export const LIMITS = {
  /** Hard ceiling on the reward of a single task. Enforced in the API, not the UI. */
  MAX_TASK_REWARD_KOBO: nairaToKobo(1_000) as Kobo,
  /** Minimum a task may pay, so campaigns cannot create dust rewards. */
  MIN_TASK_REWARD_KOBO: nairaToKobo(5) as Kobo,
  /** Default minimum cash withdrawal. */
  MIN_CASH_WITHDRAWAL_KOBO: nairaToKobo(300) as Kobo,
  /** Default maximum single cash withdrawal. */
  MAX_CASH_WITHDRAWAL_KOBO: nairaToKobo(200_000) as Kobo,
  /** Default rolling 24h withdrawal ceiling per user. */
  DAILY_WITHDRAWAL_LIMIT_KOBO: nairaToKobo(200_000) as Kobo,
  /**
   * A circuit breaker on the whole platform, not one user.
   *
   * The limit above is per person, which protects against one account
   * draining the float. It does nothing about the case that matters once
   * payouts are delegated: many payouts in one day, whether from a mistake, a
   * compromised admin account, or a campaign that was priced wrong. This is a
   * ceiling on everything that can be marked paid in a single day, and only a
   * super admin can raise it.
   */
  PLATFORM_DAILY_PAYOUT_CEILING_KOBO: nairaToKobo(500_000) as Kobo,
  /** Default minimum airtime redemption. */
  MIN_AIRTIME_KOBO: nairaToKobo(100) as Kobo,
  /** Default minimum data redemption. */
  MIN_DATA_KOBO: nairaToKobo(100) as Kobo,
  /** Reward for one qualified referral. */
  REFERRAL_REWARD_KOBO: nairaToKobo(100) as Kobo,
  /** Paid to someone who adds a referral code after signing up without one. */
  REFERRAL_JOIN_BONUS_KOBO: nairaToKobo(50) as Kobo,
  /** PIN shape. */
  PIN_LENGTH: 4,
  /** Failed PIN attempts before a temporary lock. */
  MAX_PIN_ATTEMPTS: 5,
  /** Lock duration after exhausting attempts. */
  PIN_LOCK_MINUTES: 15,
  /** Largest accepted screenshot upload. */
  MAX_PROOF_BYTES: 5 * 1024 * 1024,
  /**
   * Largest receipt image the bot will relay back to its own user.
   *
   * The app paints these itself at a known size — a real one is around 300KB —
   * so this is a ceiling on a malformed or hostile request, not a working
   * limit anybody should ever meet.
   */
  MAX_RECEIPT_BYTES: 3 * 1024 * 1024,
  /** Session lifetime for a Mini App JWT. */
  SESSION_TTL_MINUTES: 12 * 60,
  /** How long Telegram `initData` stays acceptable (replay window). */
  INITDATA_MAX_AGE_SECONDS: 15 * 60,
} as const;

export const ACCEPTED_PROOF_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Obvious PINs we refuse at creation time. */
/**
 * PINs refused at setup.
 *
 * Derived rather than hand-listed, because a hand-listed set drifts into
 * inconsistency: an earlier version of this file blocked 1010, 0101, 1212 and
 * 2121 while allowing 2020, 3030, 4040 and 2323 — the same pattern answered
 * two different ways, which is impossible to explain to a user told their PIN
 * is "too easy to guess".
 *
 * Three categories, and only three:
 *
 * 1. **One digit four times** — 0000 through 9999.
 * 2. **Four consecutive digits**, ascending or descending, including the wrap
 *    at 7890 and 0987.
 * 3. **A short list of notoriously common codes** that are neither: 1004 is
 *    the single most common PIN in leaked datasets, 2580 is the straight line
 *    down a phone keypad.
 *
 * Alternating pairs like 3030 are deliberately *allowed*. They are no weaker
 * than any other arbitrary pair, and the real protection against guessing a
 * 4-digit secret is not a denylist — it is rate limiting and the temporary
 * lock after repeated failures, both enforced server-side. A denylist only
 * needs to remove the handful of codes a stranger would try first.
 */
function buildBlockedPins(): readonly string[] {
  const blocked = new Set<string>();

  for (let digit = 0; digit <= 9; digit += 1) {
    blocked.add(String(digit).repeat(4));
  }

  // Runs, treating the digits as a ring so 7890 and 0987 are covered.
  for (let start = 0; start <= 9; start += 1) {
    const up = [0, 1, 2, 3].map((offset) => (start + offset) % 10).join('');
    const down = [0, 1, 2, 3].map((offset) => (start - offset + 10) % 10).join('');
    blocked.add(up);
    blocked.add(down);
  }

  for (const notorious of ['1004', '2580']) {
    blocked.add(notorious);
  }

  return Object.freeze([...blocked].sort());
}

export const BLOCKED_PINS: readonly string[] = buildBlockedPins();

/**
 * Where a signup came from.
 *
 * A `?start=` payload on a bot link is normally a user's referral code. These
 * reserved words are not: they mark the channel the person arrived through, so
 * "how many people joined from the website" is answerable without asking every
 * user or inventing a number.
 *
 * They are safe to reserve because a generated referral code cannot equal one:
 * codes are drawn from an uppercase alphabet that excludes I, O, 0 and 1, and
 * these are matched case-insensitively against this list *before* any referral
 * lookup, so a source can never be mistaken for a referrer.
 */
export const SIGNUP_SOURCES = {
  website: 'Website',
  x: 'X / Twitter',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram channel',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  flyer: 'Flyer / QR code',
} as const;

export type SignupSource = keyof typeof SIGNUP_SOURCES;

export const SIGNUP_SOURCE_CODES = Object.keys(SIGNUP_SOURCES) as SignupSource[];

/** True when a `?start=` payload names a channel rather than a referrer. */
export function isSignupSource(payload: string): payload is SignupSource {
  return Object.prototype.hasOwnProperty.call(SIGNUP_SOURCES, payload.trim().toLowerCase());
}

/** Normalises a payload to a source code, or null when it is not one. */
export function toSignupSource(payload: string | null | undefined): SignupSource | null {
  if (!payload) return null;
  const lower = payload.trim().toLowerCase();
  return isSignupSource(lower) ? (lower as SignupSource) : null;
}

/**
 * True when a candidate referral code would collide with a reserved word.
 *
 * Referral code generation must reject these. Two of the source names —
 * WHATSAPP and TELEGRAM — are eight characters drawn entirely from the
 * referral alphabet, so they are reachable by chance. The odds are about one
 * in a trillion, and the consequence is not small: the payload is read as a
 * channel *before* any referrer lookup, so that user would silently never be
 * credited for a single referral. Guaranteed by construction instead of left
 * to probability.
 */
export function isReservedReferralCode(candidate: string): boolean {
  return isSignupSource(candidate);
}

/** The Telegram ID that always holds SUPER_ADMIN, independent of the database. */
export const PRIMARY_ADMIN_TELEGRAM_ID = '6438544386';

/**
 * Telegram Stars price list, in kobo.
 *
 * These are the *planned* consumer prices. Fulfilment is deliberately not wired
 * to any provider yet — see `docs/PROVIDERS.md`. A bundle stays `available: false`
 * until a real provider is configured, so the UI can show the catalogue honestly
 * without implying instant delivery.
 */
export const TELEGRAM_STARS_BUNDLES = [
  { stars: 50, priceKobo: nairaToKobo(1_300) },
  { stars: 100, priceKobo: nairaToKobo(2_400) },
  { stars: 250, priceKobo: nairaToKobo(5_500) },
  { stars: 500, priceKobo: nairaToKobo(10_683) },
  { stars: 1_000, priceKobo: nairaToKobo(21_200) },
] as const;

/** Telegram Premium price list, in kobo. */
export const TELEGRAM_PREMIUM_PLANS = [
  { months: 3, priceKobo: nairaToKobo(17_000) },
  { months: 6, priceKobo: nairaToKobo(22_600) },
  { months: 12, priceKobo: nairaToKobo(40_700) },
] as const;

/** Nigerian mobile networks supported for airtime and data. */
export const NETWORKS = ['MTN', 'GLO', 'AIRTEL', '9MOBILE'] as const;
export type Network = (typeof NETWORKS)[number];

/**
 * Nigerian banks, for cash withdrawal details.
 * `code` uses the widely-shared NIBSS institution codes. Account *name*
 * resolution is intentionally left to the payout provider once one is selected —
 * we never guess an account name.
 */
export const NIGERIAN_BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: '044', name: 'Access Bank' },
  { code: '063', name: 'Access Bank (Diamond)' },
  { code: '035A', name: 'ALAT by Wema' },
  { code: '023', name: 'Citibank Nigeria' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '084', name: 'Enterprise Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'First City Monument Bank' },
  { code: '058', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '50211', name: 'Kuda Microfinance Bank' },
  { code: '565', name: 'Carbon' },
  { code: '526', name: 'Parallex Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '100', name: 'SunTrust Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '50515', name: 'Moniepoint Microfinance Bank' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
];

/** Stable, user-facing error codes. The API never leaks raw exceptions. */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PIN_REQUIRED: 'PIN_REQUIRED',
  PIN_INVALID: 'PIN_INVALID',
  PIN_LOCKED: 'PIN_LOCKED',
  PIN_ALREADY_SET: 'PIN_ALREADY_SET',
  PIN_WEAK: 'PIN_WEAK',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  TASK_UNAVAILABLE: 'TASK_UNAVAILABLE',
  TASK_ALREADY_COMPLETED: 'TASK_ALREADY_COMPLETED',
  TASK_BUDGET_EXHAUSTED: 'TASK_BUDGET_EXHAUSTED',
  TASK_PROOF_REQUIRED: 'TASK_PROOF_REQUIRED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  VERIFICATION_UNAVAILABLE: 'VERIFICATION_UNAVAILABLE',
  WITHDRAWALS_CLOSED: 'WITHDRAWALS_CLOSED',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_FAILED: 'PROVIDER_FAILED',
  /**
   * The database needs a composite index that does not exist yet. Separated
   * from INTERNAL because it is a one-time setup step with a known fix, not a
   * bug — and an operator who sees this code knows exactly what to do, while
   * INTERNAL tells them nothing.
   */
  DATABASE_SETUP_REQUIRED: 'DATABASE_SETUP_REQUIRED',
  /** The database rejected the server's credentials, or is unreachable. */
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Copy shown to users for each error code. Never surfaces internals. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please open Fundxtra from Telegram to continue.',
  PIN_REQUIRED: 'Enter your 4-digit PIN to continue.',
  PIN_INVALID: 'That PIN is not correct.',
  PIN_LOCKED: 'Too many attempts. Try again shortly, or contact Fundxtra Support.',
  PIN_ALREADY_SET: 'Your PIN is already set up.',
  PIN_WEAK: 'Choose a less predictable PIN.',
  FORBIDDEN: 'You do not have access to that.',
  NOT_FOUND: 'We could not find that.',
  VALIDATION_FAILED: 'Please check the details and try again.',
  RATE_LIMITED: 'You are going a little fast. Please wait a moment.',
  ACCOUNT_SUSPENDED: 'Your account is on hold. Please contact Fundxtra Support.',
  ACCOUNT_BANNED: 'This account is closed. Please contact Fundxtra Support.',
  INSUFFICIENT_BALANCE: 'Your balance is not enough for this.',
  DUPLICATE_REQUEST: 'That request was already received.',
  TASK_UNAVAILABLE: 'This task is no longer available.',
  TASK_ALREADY_COMPLETED: 'You have already completed this task.',
  TASK_BUDGET_EXHAUSTED: 'This campaign is fully claimed. More tasks are on the way.',
  TASK_PROOF_REQUIRED: 'Please upload a screenshot as proof.',
  VERIFICATION_FAILED: 'We could not verify that yet. Please complete the task and retry.',
  VERIFICATION_UNAVAILABLE: 'Verification is temporarily unavailable. Please try again shortly.',
  WITHDRAWALS_CLOSED: 'Withdrawals are currently closed.',
  LIMIT_EXCEEDED: 'That is outside the allowed limits.',
  PROVIDER_NOT_CONFIGURED: 'This reward is not available yet. It is coming soon.',
  PROVIDER_FAILED: 'We could not complete that right now. Nothing was deducted.',
  DATABASE_SETUP_REQUIRED: 'Fundxtra is finishing a one-time setup step. Please try again shortly.',
  DATABASE_UNAVAILABLE: 'Fundxtra cannot reach its database right now. Please try again shortly.',
  INTERNAL: 'Something went wrong. Please try again.',
};

/** The generic fallback. Used whenever an error has no user-safe mapping. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';
