import jwt from 'jsonwebtoken';
import { LIMITS } from '@fundxtra/shared';
import { env } from '../config/env';
import { unauthenticated } from './errors';

/**
 * Mini App sessions.
 *
 * Telegram `initData` is exchanged once for a short-lived JWT, which is then
 * sent as a bearer token. This avoids re-running HMAC verification (and the
 * replay-window check) on every request, and gives us a place to carry the
 * `pinVerified` flag.
 *
 * What the token deliberately does *not* carry: balance, admin status, or any
 * other authority. `pinVerified` gates PIN-protected actions, but the user's
 * role and balance are always re-read from Firestore, so a stolen or forged
 * token can never assert "I am an admin" or "I have money".
 */

export interface SessionClaims {
  /** Fundxtra user id, which is the Telegram id as a string. */
  sub: string;
  telegramId: string;
  username: string | null;
  /** True once the PIN was entered in this session. */
  pinVerified: boolean;
  /** Session instance id, so a specific token can be identified in logs. */
  sid: string;
  iat: number;
  exp: number;
}

const ISSUER = 'fundxtra-api';
const AUDIENCE = 'fundxtra-miniapp';

function secret(): string {
  if (!env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is not configured; sessions cannot be issued.');
  }
  return env.SESSION_SECRET;
}

export function issueSession(input: {
  userId: string;
  telegramId: string;
  username: string | null;
  pinVerified: boolean;
  sessionId: string;
  ttlMinutes?: number;
}): { token: string; expiresAt: string } {
  const ttlMinutes = input.ttlMinutes ?? LIMITS.SESSION_TTL_MINUTES;
  const token = jwt.sign(
    {
      telegramId: input.telegramId,
      username: input.username,
      pinVerified: input.pinVerified,
      sid: input.sessionId,
    },
    secret(),
    {
      subject: input.userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
      expiresIn: `${ttlMinutes}m`,
    },
  );
  return {
    token,
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  };
}

export function verifySession(token: string): SessionClaims {
  try {
    // `algorithms` is pinned so a token claiming alg:none is never accepted.
    const payload = jwt.verify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string' || !payload.sub) {
      throw unauthenticated('Session payload was not an object with a subject');
    }
    return {
      sub: payload.sub,
      telegramId: String((payload as Record<string, unknown>).telegramId ?? payload.sub),
      username: ((payload as Record<string, unknown>).username as string | null) ?? null,
      pinVerified: Boolean((payload as Record<string, unknown>).pinVerified),
      sid: String((payload as Record<string, unknown>).sid ?? ''),
      iat: Number(payload.iat ?? 0),
      exp: Number(payload.exp ?? 0),
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthenticated('Session expired');
    }
    throw unauthenticated(
      error instanceof Error ? `Session verification failed: ${error.message}` : 'Session invalid',
    );
  }
}

/** Extract a bearer token from an Authorization header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
