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
  /** Default minimum airtime redemption. */
  MIN_AIRTIME_KOBO: nairaToKobo(100) as Kobo,
  /** Default minimum data redemption. */
  MIN_DATA_KOBO: nairaToKobo(100) as Kobo,
  /** Reward for one qualified referral. */
  REFERRAL_REWARD_KOBO: nairaToKobo(100) as Kobo,
  /** PIN shape. */
  PIN_LENGTH: 4,
  /** Failed PIN attempts before a temporary lock. */
  MAX_PIN_ATTEMPTS: 5,
  /** Lock duration after exhausting attempts. */
  PIN_LOCK_MINUTES: 15,
  /** Largest accepted screenshot upload. */
  MAX_PROOF_BYTES: 5 * 1024 * 1024,
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
export const BLOCKED_PINS: readonly string[] = [
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '2345', '3456', '4567', '5678', '6789', '7890',
  '4321', '5432', '6543', '7654', '8765', '9876', '0987',
  '1212', '2121', '1010', '0101', '6969', '1004', '2000',
];

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
  INTERNAL: 'Something went wrong. Please try again.',
};

/** The generic fallback. Used whenever an error has no user-safe mapping. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';
