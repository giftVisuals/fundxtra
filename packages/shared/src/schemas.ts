import { z } from 'zod';
import { LIMITS, NETWORKS, NIGERIAN_BANKS, BLOCKED_PINS } from './constants';
import { MAX_KOBO } from './money';
import {
  TASK_SLUG_MAX_LENGTH,
  TASK_SLUG_MIN_LENGTH,
  TASK_SLUG_PATTERN,
  normaliseTargetUrl,
} from './format';

/**
 * Request validation.
 *
 * These schemas are the API's only entry point for untrusted input — every
 * route validates its body/query through one of them before a service ever
 * sees the data. The web app reuses the same schemas for form validation, so
 * client and server can never disagree about what is acceptable.
 */

/** A positive integer kobo amount. */
export const koboSchema = z
  .number()
  .int('Amount must be a whole number of kobo')
  .positive('Amount must be greater than zero')
  .max(MAX_KOBO);

const trimmed = (max: number) => z.string().trim().max(max);

export const pinSchema = z
  .string()
  .regex(new RegExp(`^\\d{${LIMITS.PIN_LENGTH}}$`), `PIN must be exactly ${LIMITS.PIN_LENGTH} digits`)
  .refine((pin) => !BLOCKED_PINS.includes(pin), {
    message: 'Choose a less predictable PIN',
  });

/** Telegram ids are 64-bit integers; we carry them as digit strings. */
export const telegramIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,20}$/, 'Enter a valid numeric Telegram ID');

export const telegramUsernameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, '').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_]{5,32}$/, 'Enter a valid Telegram username'));

/** Referral codes are uppercase alphanumeric, generated server-side. */
export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,12}$/, 'Invalid referral code');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const telegramAuthSchema = z.object({
  /** Raw `window.Telegram.WebApp.initData` query string. Verified server-side. */
  initData: z.string().min(1, 'Missing Telegram authentication data').max(8192),
  /** Referral code from the bot's start payload. */
  startParam: z.string().trim().max(64).optional(),
});

export const createPinSchema = z.object({
  pin: pinSchema,
  confirmPin: pinSchema,
}).refine((value) => value.pin === value.confirmPin, {
  message: 'The two PINs do not match',
  path: ['confirmPin'],
});

export const verifyPinSchema = z.object({ pin: pinSchema });

export const changePinSchema = z.object({
  currentPin: pinSchema,
  newPin: pinSchema,
  confirmPin: pinSchema,
})
  .refine((value) => value.newPin === value.confirmPin, {
    message: 'The two PINs do not match',
    path: ['confirmPin'],
  })
  .refine((value) => value.newPin !== value.currentPin, {
    message: 'Choose a PIN you have not used before',
    path: ['newPin'],
  });

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const taskCategorySchema = z.enum([
  'TELEGRAM', 'SOCIAL', 'APP_INSTALL', 'SURVEY', 'CONTENT', 'SIGNUP', 'OTHER',
]);

export const verificationMethodSchema = z.enum([
  'TELEGRAM_MEMBERSHIP', 'SCREENSHOT', 'MANUAL_REVIEW', 'HONOUR',
]);

export const taskStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED']);

export const createTaskSchema = z
  .object({
    title: trimmed(120).min(4, 'Give the task a clear title'),
    /**
     * The short link id, e.g. `crediplex`.
     *
     * Optional: derived from the title when left blank. It becomes the task's
     * document id, so uniqueness is enforced by the database rather than by a
     * check that two simultaneous saves could both pass.
     */
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(TASK_SLUG_MIN_LENGTH, `Use at least ${TASK_SLUG_MIN_LENGTH} characters`)
      .max(TASK_SLUG_MAX_LENGTH, `Use at most ${TASK_SLUG_MAX_LENGTH} characters`)
      .regex(
        TASK_SLUG_PATTERN,
        'Use lowercase letters, numbers and single hyphens only — for example crediplex',
      )
      .optional(),
    description: trimmed(1200).min(10, 'Describe what the user must do'),
    instructions: z.array(trimmed(300).min(3)).min(1, 'Add at least one instruction').max(12),
    category: taskCategorySchema,
    rewardKobo: koboSchema
      .min(LIMITS.MIN_TASK_REWARD_KOBO, 'Reward is below the minimum')
      .max(LIMITS.MAX_TASK_REWARD_KOBO, 'Reward exceeds the ₦1,000 per-task cap'),
    budgetKobo: koboSchema,
    perUserLimit: z.number().int().min(1).max(10).default(1),
    verification: verificationMethodSchema,
    /*
      A destination typed the way an admin would type it: `crediplex`,
      `@crediplex`, `t.me/crediplex` or a full URL. Normalised before
      validation, so the friendly forms are accepted without loosening what is
      ultimately stored — which is still a URL.
    */
    targetUrl: z
      .string()
      .trim()
      .max(600)
      .transform(normaliseTargetUrl)
      .refine((value) => /^https?:\/\/\S+$/.test(value), {
        message: 'Enter a link, or a Telegram username such as crediplex',
      })
      .nullish(),
    telegramChatId: trimmed(80).nullish(),
    telegramChatLabel: trimmed(80).nullish(),
    /** Plain-words checklist the automatic reviewer judges a screenshot against. */
    reviewCriteria: trimmed(800).nullish(),
    sponsorName: trimmed(80).nullish(),
    sponsorLogoUrl: z.string().trim().url().max(600).nullish(),
    startsAt: z.string().datetime().nullish(),
    endsAt: z.string().datetime().nullish(),
    minimumDwellSeconds: z.number().int().min(0).max(3600).default(8),
    sortWeight: z.number().int().min(0).max(1000).default(100),
    status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).default('DRAFT'),
  })
  .refine((task) => task.budgetKobo >= task.rewardKobo, {
    message: 'Budget must cover at least one reward',
    path: ['budgetKobo'],
  })
  .refine(
    (task) => task.verification !== 'TELEGRAM_MEMBERSHIP' || Boolean(task.telegramChatId),
    { message: 'Telegram verification needs the chat @username or numeric id', path: ['telegramChatId'] },
  )
  .refine(
    (task) => !task.startsAt || !task.endsAt || new Date(task.endsAt) > new Date(task.startsAt),
    { message: 'End date must be after the start date', path: ['endsAt'] },
  );

/** Partial update. Reward and budget may only ever be *raised* — enforced in the service. */
export const updateTaskSchema = z.object({
  title: trimmed(120).min(4).optional(),
  description: trimmed(1200).min(10).optional(),
  instructions: z.array(trimmed(300).min(3)).min(1).max(12).optional(),
  category: taskCategorySchema.optional(),
  rewardKobo: koboSchema.max(LIMITS.MAX_TASK_REWARD_KOBO).optional(),
  budgetKobo: koboSchema.optional(),
  /** Changing this is refused while submissions are waiting on the old rule. */
  verification: verificationMethodSchema.optional(),
  perUserLimit: z.number().int().min(1).max(10).optional(),
  reviewCriteria: trimmed(800).nullish(),
  // Normalised the same way as on create, so editing accepts a bare Telegram
  // name too rather than demanding a full address only here.
  targetUrl: z
    .string()
    .trim()
    .max(600)
    .transform(normaliseTargetUrl)
    .refine((value) => /^https?:\/\/\S+$/.test(value), {
      message: 'Enter a link, or a Telegram username such as crediplex',
    })
    .nullish(),
  telegramChatId: trimmed(80).nullish(),
  telegramChatLabel: trimmed(80).nullish(),
  sponsorName: trimmed(80).nullish(),
  sponsorLogoUrl: z.string().trim().url().max(600).nullish(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  minimumDwellSeconds: z.number().int().min(0).max(3600).optional(),
  sortWeight: z.number().int().min(0).max(1000).optional(),
});

/** Adding to a campaign's budget, rather than setting it outright. */
export const topUpBudgetSchema = z.object({
  addKobo: koboSchema,
});

export const taskStatusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT']),
  reason: trimmed(300).optional(),
});

/** User-side completion attempt. The client never sends a reward amount. */
export const completeTaskSchema = z.object({
  /** Free-text answer for MANUAL_REVIEW tasks. */
  answer: trimmed(600).optional(),
  /** Storage path returned by the proof-upload endpoint. */
  proofPath: trimmed(400).optional(),
  /** How long the user spent on the task, used as a soft anti-bot signal. */
  dwellSeconds: z.number().int().min(0).max(86_400).optional(),
});

export const reviewSubmissionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: trimmed(400).optional(),
  })
  .refine((value) => value.decision === 'APPROVE' || Boolean(value.reason?.length), {
    message: 'A rejection needs a reason the user can read',
    path: ['reason'],
  });

// ---------------------------------------------------------------------------
// Withdrawals and rewards
// ---------------------------------------------------------------------------

const BANK_CODES = NIGERIAN_BANKS.map((bank) => bank.code);

export const withdrawalRequestSchema = z.object({
  amountKobo: koboSchema.min(LIMITS.MIN_CASH_WITHDRAWAL_KOBO, 'Below the minimum withdrawal'),
  bankCode: z.string().trim().refine((code) => BANK_CODES.includes(code), 'Select a supported bank'),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Enter the 10-digit account number'),
  accountName: trimmed(120).min(3, 'Enter the account name'),
  pin: pinSchema,
});

export const networkSchema = z.enum(NETWORKS);

/** Nigerian mobile numbers, local or +234 form. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^(?:0[789][01]\d{8}|\+234[789][01]\d{8})$/, 'Enter a valid Nigerian phone number'),
  );

export const redeemAirtimeSchema = z.object({
  network: networkSchema,
  phone: phoneSchema,
  amountKobo: koboSchema,
  pin: pinSchema,
});

export const redeemDataSchema = z.object({
  productId: trimmed(80).min(1),
  phone: phoneSchema,
  pin: pinSchema,
});

export const redeemStarsSchema = z.object({
  productId: trimmed(80).min(1),
  telegramUsername: telegramUsernameSchema,
  pin: pinSchema,
});

export const redeemPremiumSchema = z.object({
  productId: trimmed(80).min(1),
  telegramUsername: telegramUsernameSchema,
  pin: pinSchema,
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminRoleSchema = z.enum(['SUPER_ADMIN', 'ADMIN', 'MODERATOR']);

export const permissionSchema = z.enum([
  'admins:manage', 'settings:manage', 'finance:manage', 'finance:adjust',
  'tasks:manage', 'submissions:review', 'users:view', 'users:manage',
  'withdrawals:view', 'withdrawals:process', 'rewards:manage',
  'announcements:manage', 'audit:view',
]);

export const addAdminSchema = z
  .object({
    telegramId: telegramIdSchema.optional(),
    username: telegramUsernameSchema.optional(),
    displayName: trimmed(80).min(2, 'Enter a name for this admin'),
    role: adminRoleSchema,
    extraPermissions: z.array(permissionSchema).max(13).default([]),
  })
  .refine((value) => Boolean(value.telegramId || value.username), {
    message: 'Provide a Telegram ID (preferred) or a username',
    path: ['telegramId'],
  });

export const updateAdminSchema = z.object({
  displayName: trimmed(80).min(2).optional(),
  role: adminRoleSchema.optional(),
  extraPermissions: z.array(permissionSchema).max(13).optional(),
  active: z.boolean().optional(),
});

/** A manual balance change. A reason is mandatory — no silent financial edits. */
export const balanceAdjustmentSchema = z.object({
  /** Signed: negative debits the user. */
  amountKobo: z
    .number()
    .int('Amount must be a whole number of kobo')
    .refine((value) => value !== 0, 'Amount cannot be zero')
    .refine((value) => Math.abs(value) <= MAX_KOBO, 'Amount is out of range'),
  reason: trimmed(400).min(8, 'Explain why this adjustment is being made'),
});

export const userStatusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
  reason: trimmed(400).min(4, 'Give a reason for the record'),
});

export const withdrawalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'COMPLETE', 'FAIL']),
    reason: trimmed(400).optional(),
    providerReference: trimmed(120).optional(),
  })
  .refine(
    (value) => !['REJECT', 'FAIL'].includes(value.decision) || Boolean(value.reason?.length),
    { message: 'A rejection or failure needs a reason', path: ['reason'] },
  );

export const systemSettingsUpdateSchema = z.object({
  withdrawals: z
    .object({
      enabled: z.boolean().optional(),
      maintenanceMessage: trimmed(400).optional(),
      opensAt: z.string().datetime().nullish(),
      closesAt: z.string().datetime().nullish(),
      minAmountKobo: koboSchema.optional(),
      maxAmountKobo: koboSchema.optional(),
      dailyLimitKobo: koboSchema.optional(),
      platformDailyPayoutKobo: koboSchema.optional(),
      feeKobo: z.number().int().min(0).max(MAX_KOBO).optional(),
      requireManualApproval: z.boolean().optional(),
    })
    .optional(),
  rewards: z
    .object({
      airtimeEnabled: z.boolean().optional(),
      dataEnabled: z.boolean().optional(),
      starsEnabled: z.boolean().optional(),
      premiumEnabled: z.boolean().optional(),
      minAirtimeKobo: koboSchema.optional(),
      minDataKobo: koboSchema.optional(),
      activeProvider: z.enum(['none', 'mock', 'nasfampay']).optional(),
    })
    .optional(),
  referrals: z.object({ enabled: z.boolean().optional(), rewardKobo: koboSchema.optional() }).optional(),
  tasks: z
    .object({
      maxRewardKobo: koboSchema.max(LIMITS.MAX_TASK_REWARD_KOBO).optional(),
      earningEnabled: z.boolean().optional(),
      autoReviewEnabled: z.boolean().optional(),
    })
    .optional(),
  platform: z
    .object({
      maintenanceMode: z.boolean().optional(),
      maintenanceMessage: trimmed(400).optional(),
      botUsername: trimmed(64).optional(),
      supportHandle: trimmed(64).optional(),
      publicStatsEnabled: z.boolean().optional(),
    })
    .optional(),
  reason: trimmed(300).optional(),
});

export const announcementSchema = z.object({
  title: trimmed(120).min(3, 'Give the announcement a title'),
  body: trimmed(2000).min(10, 'Write the announcement'),
  level: z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']).default('INFO'),
  audience: z.enum(['APP', 'PUBLIC', 'BOTH']).default('APP'),
  ctaLabel: trimmed(40).nullish(),
  ctaUrl: z.string().trim().url().max(600).nullish(),
  published: z.boolean().default(false),
  publishAt: z.string().datetime().nullish(),
  expiresAt: z.string().datetime().nullish(),
  pinned: z.boolean().default(false),
});

export const rewardProductSchema = z.object({
  kind: z.enum(['AIRTIME', 'DATA', 'TELEGRAM_STARS', 'TELEGRAM_PREMIUM']),
  name: trimmed(120).min(2),
  description: trimmed(400).default(''),
  priceKobo: koboSchema,
  openAmount: z.boolean().default(false),
  minAmountKobo: koboSchema.nullish(),
  maxAmountKobo: koboSchema.nullish(),
  network: networkSchema.nullish(),
  dataVolume: trimmed(40).nullish(),
  validityDays: z.number().int().min(1).max(3650).nullish(),
  stars: z.number().int().min(1).max(1_000_000).nullish(),
  months: z.number().int().min(1).max(60).nullish(),
  available: z.boolean().default(false),
  unavailableReason: trimmed(200).nullish(),
  sortWeight: z.number().int().min(0).max(1000).default(100),
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().max(400).optional(),
});

export const userSearchSchema = paginationSchema.extend({
  q: trimmed(80).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
  flagged: z.coerce.boolean().optional(),
});

export const submissionListSchema = paginationSchema.extend({
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  taskId: trimmed(80).optional(),
});

export const withdrawalListSchema = paginationSchema.extend({
  status: z
    .enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'])
    .optional(),
});

export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TopUpBudgetInput = z.infer<typeof topUpBudgetSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;
export type WithdrawalRequestInput = z.infer<typeof withdrawalRequestSchema>;
export type BalanceAdjustmentInput = z.infer<typeof balanceAdjustmentSchema>;
export type SystemSettingsUpdateInput = z.infer<typeof systemSettingsUpdateSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type RewardProductInput = z.infer<typeof rewardProductSchema>;
export type AddAdminInput = z.infer<typeof addAdminSchema>;
