import { Timestamp } from 'firebase-admin/firestore';
import {
  effectivePermissions,
  type Admin,
  type AdminInvite,
  type AdminRole,
  type Permission,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { env } from '../config/env';
import { nowIso, toIso, toIsoRequired } from '../lib/time';
import { logger } from '../lib/logger';

/**
 * Admins.
 *
 * Two rules shape this service:
 *
 * 1. **Telegram ID is the identity.** Usernames are convenient but mutable and
 *    reassignable, so they are only ever a *pending invite*. The first time an
 *    invited username signs in, the invite is converted into a real
 *    `admins/{telegramId}` document and the username stops mattering.
 *
 * 2. **The primary admin is unconditional.** Telegram id 6438544386 resolves to
 *    SUPER_ADMIN even if the `admins` collection is empty or was wiped, so the
 *    platform can never be locked out of its own admin panel. That record is
 *    synthesised in code, not read from the database.
 */

export const PRIMARY_ADMIN_ID = env.PRIMARY_ADMIN_TELEGRAM_ID;

function primaryAdmin(username: string | null): Admin {
  return {
    id: PRIMARY_ADMIN_ID,
    telegramId: PRIMARY_ADMIN_ID,
    username,
    displayName: 'Fundxtra Owner',
    role: 'SUPER_ADMIN',
    extraPermissions: [],
    active: true,
    addedBy: null,
    createdAt: nowIso(),
    lastActiveAt: nowIso(),
  };
}

export function isPrimaryAdmin(telegramId: string): boolean {
  return telegramId === PRIMARY_ADMIN_ID;
}

/**
 * Resolve a Telegram identity to an admin, or null.
 *
 * Also claims a pending username invite, which is why it takes the username.
 */
export async function resolveAdmin(
  telegramId: string,
  username: string | null,
): Promise<Admin | null> {
  if (isPrimaryAdmin(telegramId)) {
    // Keep a database row for the primary admin so the admin list shows them,
    // but never depend on it for authorisation.
    void ensurePrimaryAdminRecord(username);
    return primaryAdmin(username);
  }

  const snapshot = await db().collection(COLLECTIONS.admins).doc(telegramId).get();
  if (snapshot.exists) {
    const admin = mapAdmin(snapshot.id, snapshot.data() ?? {});
    return admin.active ? admin : null;
  }

  // No direct record — check for an unclaimed invite for this username.
  if (username) {
    const claimed = await claimInvite(telegramId, username);
    if (claimed) return claimed;
  }
  return null;
}

async function ensurePrimaryAdminRecord(username: string | null): Promise<void> {
  try {
    await db()
      .collection(COLLECTIONS.admins)
      .doc(PRIMARY_ADMIN_ID)
      .set(
        {
          telegramId: PRIMARY_ADMIN_ID,
          username,
          displayName: 'Fundxtra Owner',
          role: 'SUPER_ADMIN',
          extraPermissions: [],
          active: true,
          addedBy: null,
          createdAt: Timestamp.now(),
          lastActiveAt: Timestamp.now(),
        },
        { merge: true },
      );
  } catch (error) {
    // Non-fatal: authorisation does not depend on this write succeeding.
    logger.warn({ err: error }, 'Could not persist the primary admin record');
  }
}

/** Convert an unclaimed username invite into a real admin keyed by Telegram id. */
async function claimInvite(telegramId: string, username: string): Promise<Admin | null> {
  const normalised = username.replace(/^@/, '').toLowerCase();
  const firestore = db();

  const snapshot = await firestore
    .collection(COLLECTIONS.adminInvites)
    .where('username', '==', normalised)
    .where('claimedByTelegramId', '==', null)
    .limit(1)
    .get();

  const inviteDoc = snapshot.docs[0];
  if (!inviteDoc) return null;

  const expiresAt = inviteDoc.get('expiresAt') as Timestamp | null;
  if (expiresAt && expiresAt.toMillis() < Date.now()) {
    logger.info({ username: normalised }, 'Admin invite expired; not claiming');
    return null;
  }

  const role = (inviteDoc.get('role') as AdminRole) ?? 'MODERATOR';
  const extraPermissions = (inviteDoc.get('extraPermissions') as Permission[]) ?? [];
  const now = Timestamp.now();

  const record = {
    telegramId,
    username: normalised,
    displayName: (inviteDoc.get('displayName') as string) ?? `@${normalised}`,
    role,
    extraPermissions,
    active: true,
    addedBy: (inviteDoc.get('invitedBy') as string) ?? null,
    createdAt: now,
    lastActiveAt: now,
  };

  await firestore.runTransaction(async (tx) => {
    tx.set(firestore.collection(COLLECTIONS.admins).doc(telegramId), record);
    tx.update(inviteDoc.ref, { claimedByTelegramId: telegramId, claimedAt: now });
  });

  logger.info({ telegramId, username: normalised, role }, 'Admin invite claimed');
  return mapAdmin(telegramId, record);
}

export async function listAdmins(): Promise<Admin[]> {
  const snapshot = await db().collection(COLLECTIONS.admins).orderBy('createdAt', 'asc').get();
  return snapshot.docs.map((doc) => mapAdmin(doc.id, doc.data()));
}

export async function listPendingInvites(): Promise<AdminInvite[]> {
  const snapshot = await db()
    .collection(COLLECTIONS.adminInvites)
    .where('claimedByTelegramId', '==', null)
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      username: String(data.username ?? ''),
      role: (data.role as AdminRole) ?? 'MODERATOR',
      extraPermissions: (data.extraPermissions as Permission[]) ?? [],
      invitedBy: String(data.invitedBy ?? ''),
      claimedByTelegramId: (data.claimedByTelegramId as string | null) ?? null,
      claimedAt: toIso(data.claimedAt),
      createdAt: toIsoRequired(data.createdAt),
      expiresAt: toIsoRequired(data.expiresAt),
    };
  });
}

export async function upsertAdmin(input: {
  telegramId: string;
  username: string | null;
  displayName: string;
  role: AdminRole;
  extraPermissions: Permission[];
  addedBy: string;
}): Promise<Admin> {
  const now = Timestamp.now();
  const record = {
    telegramId: input.telegramId,
    username: input.username?.replace(/^@/, '').toLowerCase() ?? null,
    displayName: input.displayName,
    role: input.role,
    // Filter here too, so a super-admin-only permission cannot be persisted
    // onto a lower role even if the request slipped past validation.
    extraPermissions: effectivePermissions(input.role, input.extraPermissions).filter((p) =>
      input.extraPermissions.includes(p),
    ),
    active: true,
    addedBy: input.addedBy,
    createdAt: now,
    lastActiveAt: null,
  };

  await db()
    .collection(COLLECTIONS.admins)
    .doc(input.telegramId)
    .set(record, { merge: true });
  return mapAdmin(input.telegramId, record);
}

export async function createInvite(input: {
  username: string;
  displayName: string;
  role: AdminRole;
  extraPermissions: Permission[];
  invitedBy: string;
}): Promise<AdminInvite> {
  const normalised = input.username.replace(/^@/, '').toLowerCase();
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 30 * 86_400_000);

  const ref = db().collection(COLLECTIONS.adminInvites).doc(normalised);
  const record = {
    username: normalised,
    displayName: input.displayName,
    role: input.role,
    extraPermissions: input.extraPermissions,
    invitedBy: input.invitedBy,
    claimedByTelegramId: null,
    claimedAt: null,
    createdAt: now,
    expiresAt,
  };
  await ref.set(record);

  return {
    id: normalised,
    username: normalised,
    role: input.role,
    extraPermissions: input.extraPermissions,
    invitedBy: input.invitedBy,
    claimedByTelegramId: null,
    claimedAt: null,
    createdAt: toIsoRequired(now),
    expiresAt: toIsoRequired(expiresAt),
  };
}

export async function updateAdmin(
  telegramId: string,
  patch: Partial<Pick<Admin, 'displayName' | 'role' | 'extraPermissions' | 'active'>>,
): Promise<void> {
  if (isPrimaryAdmin(telegramId)) {
    throw new Error('The primary admin cannot be modified');
  }
  await db()
    .collection(COLLECTIONS.admins)
    .doc(telegramId)
    .update({ ...patch, updatedAt: Timestamp.now() });
}

export async function removeAdmin(telegramId: string): Promise<void> {
  if (isPrimaryAdmin(telegramId)) {
    throw new Error('The primary admin cannot be removed');
  }
  // Deactivated rather than deleted, so audit-log entries keep a resolvable actor.
  await db()
    .collection(COLLECTIONS.admins)
    .doc(telegramId)
    .update({ active: false, updatedAt: Timestamp.now() });
}

export function touchAdmin(telegramId: string): void {
  void db()
    .collection(COLLECTIONS.admins)
    .doc(telegramId)
    .set({ lastActiveAt: Timestamp.now() }, { merge: true })
    .catch(() => undefined);
}

export function mapAdmin(id: string, data: Record<string, unknown>): Admin {
  return {
    id,
    telegramId: String(data.telegramId ?? id),
    username: (data.username as string | null) ?? null,
    displayName: String(data.displayName ?? 'Admin'),
    role: (data.role as AdminRole) ?? 'MODERATOR',
    extraPermissions: (data.extraPermissions as Permission[]) ?? [],
    active: data.active !== false,
    addedBy: (data.addedBy as string | null) ?? null,
    createdAt: toIsoRequired(data.createdAt),
    lastActiveAt: toIso(data.lastActiveAt),
  };
}
