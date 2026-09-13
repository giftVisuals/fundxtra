import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { PRIMARY_ADMIN_TELEGRAM_ID } from '@fundxtra/shared';
import { resolveServiceAccount, type ServiceAccountResult } from './service-account';

/**
 * Environment configuration.
 *
 * Parsed once at boot and validated, so a misconfigured deployment fails loudly
 * at startup rather than at the first request that needs a missing secret.
 * Nothing here has a hardcoded secret default — see `.env.example` for where
 * each value comes from.
 */

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Railway injects PORT. */
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Comma-separated origins allowed to call the API. */
  CORS_ORIGINS: csv,

  /** Secret used to sign Mini App session JWTs. Must be >= 32 chars. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters').optional(),

  /** Telegram bot token, from @BotFather. Used for initData HMAC + Bot API calls. */
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_BOT_USERNAME: z.string().min(3).default('fundxtrabot'),
  /** Set true only for local UI work; never in production. */
  ALLOW_DEV_AUTH: z
    .string()
    .optional()
    .transform((value) => value === 'true'),

  /**
   * Firebase Admin service-account credentials.
   *
   * Preferred: FIREBASE_SERVICE_ACCOUNT, holding the entire JSON file Firebase
   * gives you (raw or base64). One value, one paste, and no multi-line PEM key
   * to mangle in a dashboard field. The split pair below still works and is
   * used when the single variable is absent.
   */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().min(1).default('fundxtra'),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  /** PEM key. Newlines may be escaped as \n when set through a dashboard. */
  FIREBASE_PRIVATE_KEY: z.string().min(40).optional(),
  /** Point at the emulator for local development, e.g. 127.0.0.1:8080. */
  FIRESTORE_EMULATOR_HOST: z.string().optional(),

  /**
   * imgbb, which hosts the screenshots users upload as proof.
   *
   * Chosen over Cloud Storage because it needs nothing switched on in the
   * Firebase console — one key and uploads work. The trade is real and worth
   * stating: an imgbb link is public to anyone who has it. See
   * services/uploads.ts.
   */
  IMGBB_API_KEY: z.string().min(8).optional(),
  /**
   * How long imgbb keeps a screenshot, in seconds. Their accepted range is
   * 60 to 15,552,000 (180 days), and 180 days is the default: long enough for
   * a payout dispute months later, and it means proofs do not sit on a
   * third-party host forever.
   */
  IMGBB_EXPIRATION_SECONDS: z.coerce.number().int().min(60).max(15_552_000).default(15_552_000),

  /**
   * Groq, which reads submitted screenshots and decides whether they show what
   * the task asked for.
   *
   * Without it nothing changes: every submission waits for a person, exactly
   * as before. The review is an accelerator, never a dependency.
   */
  GROQ_API_KEY: z.string().min(8).optional(),
  /**
   * Which vision model to use.
   *
   * A variable rather than a constant because hosted models get retired —
   * Groq deprecated two of its vision models during 2026 alone. Switching one
   * should be a dashboard edit, not a deploy.
   */
  GROQ_VISION_MODEL: z.string().min(3).default('qwen/qwen3.6-27b'),
  /** Where the API lives. Overridable so a proxy or a mock can stand in. */
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),

  /** Which reward provider to use: none | mock | nasfampay. */
  REWARD_PROVIDER: z.enum(['none', 'mock', 'nasfampay']).default('none'),
  /**
   * NasfamPay credentials. Their public API is still in development, so these
   * are intentionally unused until the provider is implemented against real
   * documentation. See docs/PROVIDERS.md.
   */
  NASFAMPAY_BASE_URL: z.string().url().optional(),
  NASFAMPAY_API_KEY: z.string().min(8).optional(),

  /** Primary super admin, overridable for staging. */
  PRIMARY_ADMIN_TELEGRAM_ID: z.string().regex(/^\d+$/).default(PRIMARY_ADMIN_TELEGRAM_ID),

  /**
   * Public web origin, used to build absolute links and the Mini App URL.
   *
   * Defaults to the Vercel deployment because that is what is actually
   * serving; change it to https://fundxtra.name.ng once that domain is
   * connected, or set this variable to override without a deploy.
   */
  PUBLIC_WEB_URL: z.string().url().default('https://fundxtra.vercel.app'),

  /**
   * This API's own public origin, used to register the Telegram webhook.
   *
   * Railway injects RAILWAY_PUBLIC_DOMAIN, so on Railway neither of these
   * needs setting by hand.
   */
  PUBLIC_API_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),

  /**
   * Shared secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token.
   *
   * Optional: derived from SESSION_SECRET when unset, so the webhook is
   * authenticated without another variable to set. Rotating SESSION_SECRET
   * rotates this too, and the next boot re-registers the webhook with the new
   * value.
   */
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Resolved service-account credentials, from either accepted form.
 *
 * Resolved once at boot so a malformed value is reported on `/health` rather
 * than surfacing as an opaque credential error on the first request.
 */
export const serviceAccount: ServiceAccountResult = resolveServiceAccount({
  serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT,
  clientEmail: env.FIREBASE_CLIENT_EMAIL,
  privateKey: env.FIREBASE_PRIVATE_KEY,
  projectId: env.FIREBASE_PROJECT_ID,
});

/** Firestore is reachable when we have usable credentials or an emulator. */
export const hasFirestore = serviceAccount.ok || Boolean(env.FIRESTORE_EMULATOR_HOST);

/** Telegram initData can be verified only with the bot token. */
export const hasTelegram = Boolean(env.TELEGRAM_BOT_TOKEN);

/**
 * Startup readiness. Missing pieces are returned rather than thrown so the
 * process can still boot and serve `/health` — a Railway deploy that reports
 * *why* it is unhealthy is far easier to fix than one that crash-loops.
 */
export function readiness(): { ready: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!hasFirestore) {
    // A credential that is present but unusable reports the parse failure,
    // which is actionable; an absent one just names the variable to set.
    missing.push(serviceAccount.ok ? 'FIREBASE_SERVICE_ACCOUNT' : serviceAccount.reason);
  }
  if (!hasTelegram) missing.push('TELEGRAM_BOT_TOKEN');

  if (env.REWARD_PROVIDER === 'nasfampay' && !env.NASFAMPAY_API_KEY) {
    warnings.push(
      'REWARD_PROVIDER=nasfampay but NASFAMPAY_API_KEY is unset; redemptions will be refused.',
    );
  }
  if (env.ALLOW_DEV_AUTH && isProduction) {
    warnings.push('ALLOW_DEV_AUTH is enabled in production. Disable it immediately.');
  }
  if (isProduction && env.CORS_ORIGINS.length === 0) {
    warnings.push('CORS_ORIGINS is empty in production; browser calls will be rejected.');
  }

  if (!env.IMGBB_API_KEY) {
    // A warning rather than a missing requirement: everything except
    // screenshot tasks works without it, so this must not hold the service
    // down — but the operator should see it before a user does.
    warnings.push('IMGBB_API_KEY is not set; screenshot proof uploads will be refused.');
  }

  return { ready: missing.length === 0, missing, warnings };
}

/* ------------------------------------------------------------------------- *
 * Derived origins.
 * ------------------------------------------------------------------------- */

/** The Mini App entry point, which is also the chat menu button's target. */
export function miniAppUrl(): string {
  return `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/app`;
}

/**
 * This API's public origin, preferring the explicit variable over Railway's
 * injected domain. Null when neither is known, in which case the webhook is
 * not registered rather than registered at a guessed URL.
 */
export function apiOrigin(): string | null {
  if (env.PUBLIC_API_URL) return env.PUBLIC_API_URL.replace(/\/$/, '');
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN.replace(/\/$/, '')}`;
  return null;
}

/**
 * The webhook secret, derived from SESSION_SECRET when not set explicitly.
 *
 * Derivation is one-way, so the webhook secret leaking from a request header
 * does not expose the session signing key. Null when there is nothing to
 * derive from, and the route then refuses every update: an unauthenticated
 * webhook would let anyone trigger a referral attribution.
 */
export function telegramWebhookSecret(): string | null {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.SESSION_SECRET) return null;
  return createHmac('sha256', env.SESSION_SECRET).update('telegram-webhook').digest('hex');
}
