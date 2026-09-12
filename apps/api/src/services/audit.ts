import { Timestamp } from 'firebase-admin/firestore';
import type { Admin, AuditAction, AuditLog } from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { millisOf, runOrderedQuery } from '../lib/query-fallback';
import { newAuditId } from '../lib/ids';
import { logger } from '../lib/logger';
import { toIsoRequired } from '../lib/time';

/**
 * Audit log.
 *
 * Append-only, and for financial actions the write is **awaited** — unlike the
 * security event log, which is fire-and-forget. An unrecorded balance
 * adjustment is worse than a failed one: "every admin financial adjustment
 * must create an audit record" only means something if the record is a
 * precondition of the change, not a best-effort side effect.
 *
 * `recordAudit` therefore throws on failure, and its financial callers let that
 * failure abort the action.
 */

/** Actions where a missing audit record is unacceptable. */
const FINANCIAL_ACTIONS: readonly AuditAction[] = [
  'BALANCE_ADJUSTED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_REJECTED',
  'WITHDRAWAL_COMPLETED',
  'WITHDRAWAL_FAILED',
  'SUBMISSION_APPROVED',
  'REDEMPTION_RETRIED',
  'REDEMPTION_CANCELLED',
  'ADMIN_ADDED',
  'ADMIN_UPDATED',
  'ADMIN_REMOVED',
  'SETTINGS_UPDATED',
];

export interface AuditInput {
  action: AuditAction;
  actor: Pick<Admin, 'telegramId' | 'username' | 'role'>;
  targetType: string;
  targetId: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<string> {
  const id = newAuditId();
  const record = {
    action: input.action,
    actorId: input.actor.telegramId,
    actorUsername: input.actor.username,
    actorRole: input.actor.role,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    ip: input.ip ?? null,
    createdAt: Timestamp.now(),
  };

  try {
    await db().collection(COLLECTIONS.auditLogs).doc(id).create(record);
    logger.info(
      { auditId: id, action: input.action, actorId: input.actor.telegramId, targetId: input.targetId },
      'Admin action recorded',
    );
    return id;
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'Failed to write an audit record');
    if (FINANCIAL_ACTIONS.includes(input.action)) {
      // Surface it. The caller aborts rather than making an unrecorded change.
      throw error;
    }
    return id;
  }
}

export async function listAuditLogs(options: {
  limit?: number;
  action?: AuditAction;
  actorId?: string;
  targetId?: string;
  cursor?: string | undefined;
} = {}): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const collection = db().collection(COLLECTIONS.auditLogs);

  let base = collection as unknown as import('firebase-admin/firestore').Query;
  if (options.action) base = base.where('action', '==', options.action);
  if (options.actorId) base = base.where('actorId', '==', options.actorId);
  if (options.targetId) base = base.where('targetId', '==', options.targetId);
  let query = base.orderBy('createdAt', 'desc').limit(limit + 1);

  if (options.cursor) {
    const cursorDoc = await collection.doc(options.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snapshot = await runOrderedQuery({
    base,
    ordered: query,
    limit: limit + 1,
    timestampOf: (data) => millisOf(data.createdAt),
    label: 'audit log, newest first',
  });
  const docs = snapshot.docs.slice(0, limit);
  const last = docs[docs.length - 1];

  return {
    items: docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        action: data.action as AuditAction,
        actorId: String(data.actorId ?? ''),
        actorUsername: (data.actorUsername as string | null) ?? null,
        actorRole: (data.actorRole as Admin['role']) ?? 'MODERATOR',
        targetType: String(data.targetType ?? ''),
        targetId: String(data.targetId ?? ''),
        summary: String(data.summary ?? ''),
        before: (data.before as Record<string, unknown> | null) ?? null,
        after: (data.after as Record<string, unknown> | null) ?? null,
        reason: (data.reason as string | null) ?? null,
        ip: (data.ip as string | null) ?? null,
        createdAt: toIsoRequired(data.createdAt),
      };
    }),
    nextCursor: snapshot.docs.length > limit && last ? last.id : null,
  };
}
