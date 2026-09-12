import { z } from 'zod';
import { PRIMARY_ADMIN_TELEGRAM_ID } from '@fundxtra/shared';

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

  /** Firebase Admin service-account credentials. */
  FIREBASE_PROJECT_ID: z.string().min(1).default('fundxtra'),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  /** PEM key. Newlines may be escaped as \n when set through a dashboard. */
  FIREBASE_PRIVATE_KEY: z.string().min(40).optional(),
  FIREBASE_STORAGE_BUCKET: z.string().min(1).default('fundxtra.firebasestorage.app'),
  /** Point at the emulator for local development, e.g. 127.0.0.1:8080. */
  FIRESTORE_EMULATOR_HOST: z.string().optional(),

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

  /** Public web origin, used to build absolute links. */
  PUBLIC_WEB_URL: z.string().url().default('https://fundxtra.name.ng'),
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

/** Firestore is reachable when we have real credentials or an emulator. */
export const hasFirestore =
  Boolean(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) ||
  Boolean(env.FIRESTORE_EMULATOR_HOST);

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
  if (!hasFirestore) missing.push('FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY');
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

  return { ready: missing.length === 0, missing, warnings };
}
