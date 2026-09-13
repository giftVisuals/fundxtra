import { Timestamp } from 'firebase-admin/firestore';
import type { SecurityEvent, SecurityEventType } from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { newEventId } from '../lib/ids';
import { logger } from '../lib/logger';
import { Throttle } from '../lib/cache';
import { toIsoRequired } from '../lib/time';

/**
 * Security event log.
 *
 * Writes are fire-and-forget on purpose: a logging failure must never turn a
 * successful user action into an error, nor a rejected one into a success. The
 * failure is still reported to the application log so the gap is visible.
 */

const SEVERITY: Record<SecurityEventType, SecurityEvent['severity']> = {
  INITDATA_INVALID: 'WARN',
  INITDATA_EXPIRED: 'INFO',
  PIN_FAILED: 'INFO',
  PIN_LOCKED: 'WARN',
  PIN_CREATED: 'INFO',
  PIN_CHANGED: 'INFO',
  PIN_RESET_BY_ADMIN: 'WARN',
  SESSION_ISSUED: 'INFO',
  SELF_REFERRAL_BLOCKED: 'WARN',
  DUPLICATE_REFERRAL_BLOCKED: 'WARN',
  IDEMPOTENT_REPLAY: 'INFO',
  RATE_LIMITED: 'INFO',
  SUSPICIOUS_VELOCITY: 'WARN',
  FORBIDDEN_ACCESS: 'WARN',
  ADMIN_ACTION: 'INFO',
};

export interface SecurityEventInput {
  type: SecurityEventType;
  message: string;
  userId?: string | null;
  telegramId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Events that happen once per app open rather than once per incident.
 *
 * Telegram re-opens a Mini App constantly — every tab back into the chat and
 * out again — so SESSION_ISSUED was writing a row every time somebody looked
 * at their balance. It is worth keeping (it answers "when was this account
 * last used") but not at that resolution, so one row per user per hour stands
 * in for all of them. Nothing that indicates a problem is throttled: a failed
 * PIN, a blocked referral, a forbidden request all still write every time.
 */
const HIGH_FREQUENCY: ReadonlySet<SecurityEventType> = new Set<SecurityEventType>([
  'SESSION_ISSUED',
  'INITDATA_EXPIRED',
]);

const highFrequencyWrites = new Throttle(60 * 60_000);

export function recordSecurityEvent(input: SecurityEventInput): void {
  const severity = SEVERITY[input.type] ?? 'INFO';
  const payload = {
    type: input.type,
    userId: input.userId ?? null,
    telegramId: input.telegramId ?? null,
    severity,
    message: input.message,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? {},
    createdAt: Timestamp.now(),
  };

  logger[severity === 'CRITICAL' ? 'error' : severity === 'WARN' ? 'warn' : 'info'](
    { securityEvent: input.type, userId: input.userId, ...input.metadata },
    input.message,
  );

  // Logged above either way; only the stored row is throttled, so nothing is
  // lost from the operator's view of what happened.
  if (HIGH_FREQUENCY.has(input.type)) {
    const key = `${input.type}:${input.userId ?? input.telegramId ?? input.ip ?? 'anon'}`;
    if (!highFrequencyWrites.claim(key)) return;
  }

  void db()
    .collection(COLLECTIONS.securityEvents)
    .doc(newEventId())
    .create(payload)
    .catch((error: unknown) => {
      logger.error({ err: error, type: input.type }, 'Failed to persist security event');
    });
}

export async function listSecurityEvents(options: {
  limit?: number;
  userId?: string;
  severity?: SecurityEvent['severity'];
} = {}): Promise<SecurityEvent[]> {
  let query = db().collection(COLLECTIONS.securityEvents).orderBy('createdAt', 'desc');
  if (options.userId) query = query.where('userId', '==', options.userId);
  if (options.severity) query = query.where('severity', '==', options.severity);

  const snapshot = await query.limit(Math.min(options.limit ?? 50, 200)).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      type: data.type as SecurityEventType,
      userId: (data.userId as string | null) ?? null,
      telegramId: (data.telegramId as string | null) ?? null,
      severity: (data.severity as SecurityEvent['severity']) ?? 'INFO',
      message: String(data.message ?? ''),
      ip: (data.ip as string | null) ?? null,
      userAgent: (data.userAgent as string | null) ?? null,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      createdAt: toIsoRequired(data.createdAt),
    };
  });
}
