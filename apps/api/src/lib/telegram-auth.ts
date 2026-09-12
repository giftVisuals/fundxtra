import { createHmac, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@fundxtra/shared';

/**
 * Telegram Mini App `initData` verification.
 *
 * This is the single point at which an anonymous HTTP request becomes a known
 * Telegram user, so it is deliberately strict. The algorithm is the one
 * published in the Telegram Mini Apps documentation:
 *
 *   1. Take the `initData` query string and drop the `hash` field.
 *   2. Sort the remaining `key=value` pairs lexicographically by key and join
 *      them with newlines to form the data-check string.
 *   3. secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   4. Expect hash == hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 *
 * Note the inversion in step 3: the *constant* "WebAppData" is the HMAC key and
 * the bot token is the message. Swapping them is the classic implementation bug
 * and yields a verifier that rejects every legitimate request.
 *
 * The user object supplied by the client is never trusted on its own — it is
 * only read *after* the signature over the whole payload has been verified.
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface VerifiedInitData {
  user: TelegramUser;
  /** `start_param`, i.e. the bot deep-link payload. Carries the referral code. */
  startParam: string | null;
  authDate: Date;
  chatType: string | null;
  queryId: string | null;
}

export type InitDataFailure =
  | 'MALFORMED'
  | 'MISSING_HASH'
  | 'BAD_SIGNATURE'
  | 'EXPIRED'
  | 'MISSING_USER'
  | 'BAD_USER';

export type InitDataResult =
  | { ok: true; data: VerifiedInitData }
  | { ok: false; reason: InitDataFailure; detail: string };

/**
 * Derive the Telegram secret key for a bot token.
 * Cached because HMAC over the token is deterministic and this runs per request.
 */
const secretKeyCache = new Map<string, Buffer>();

function secretKeyFor(botToken: string): Buffer {
  const cached = secretKeyCache.get(botToken);
  if (cached) return cached;
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  secretKeyCache.set(botToken, key);
  return key;
}

export function verifyInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: Date } = {},
): InitDataResult {
  const maxAgeSeconds = options.maxAgeSeconds ?? LIMITS.INITDATA_MAX_AGE_SECONDS;
  const now = options.now ?? new Date();

  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
    return { ok: false, reason: 'MALFORMED', detail: 'initData is empty or oversized' };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'MALFORMED', detail: 'initData is not a valid query string' };
  }

  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return { ok: false, reason: 'MISSING_HASH', detail: 'hash missing or not a sha256 hex digest' };
  }

  // Build the data-check string from every field except `hash`, sorted by key.
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const expected = createHmac('sha256', secretKeyFor(botToken))
    .update(dataCheckString)
    .digest('hex');

  // Constant-time comparison: both are fixed-length hex, so lengths always match.
  const provided = Buffer.from(hash.toLowerCase(), 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, reason: 'BAD_SIGNATURE', detail: 'initData signature did not match' };
  }

  // Replay window. `auth_date` is unix seconds.
  const authDateRaw = params.get('auth_date');
  const authSeconds = authDateRaw ? Number.parseInt(authDateRaw, 10) : Number.NaN;
  if (!Number.isFinite(authSeconds)) {
    return { ok: false, reason: 'MALFORMED', detail: 'auth_date missing or not an integer' };
  }
  const ageSeconds = Math.floor(now.getTime() / 1000) - authSeconds;
  // A small negative age is tolerated for clock skew between Telegram and us.
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) {
    return {
      ok: false,
      reason: 'EXPIRED',
      detail: `initData age ${ageSeconds}s is outside the accepted window`,
    };
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    return {
      ok: false,
      reason: 'MISSING_USER',
      detail: 'initData carried no user (Mini App opened outside a private chat?)',
    };
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    return { ok: false, reason: 'BAD_USER', detail: 'user field is not valid JSON' };
  }

  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    return { ok: false, reason: 'BAD_USER', detail: 'user.id is not a positive integer' };
  }
  if (typeof user.first_name !== 'string' || user.first_name.length === 0) {
    return { ok: false, reason: 'BAD_USER', detail: 'user.first_name is missing' };
  }

  return {
    ok: true,
    data: {
      user,
      startParam: params.get('start_param'),
      authDate: new Date(authSeconds * 1000),
      chatType: params.get('chat_type'),
      queryId: params.get('query_id'),
    },
  };
}

/**
 * Build a signed `initData` string. Used by the test suite and the local dev
 * seeding script so the real verifier can be exercised without Telegram.
 */
export function signInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const pairs = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const hash = createHmac('sha256', secretKeyFor(botToken))
    .update(pairs.join('\n'))
    .digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
