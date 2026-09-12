import { Timestamp } from 'firebase-admin/firestore';
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementLevel,
  AnnouncementInput,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { millisOf, runOrderedQuery } from '../lib/query-fallback';
import { newAnnouncementId } from '../lib/ids';
import { nowIso, toIso, toIsoRequired } from '../lib/time';

/**
 * Announcements.
 *
 * Scheduling is evaluated at read time rather than by a job: an announcement is
 * live when it is published, its `publishAt` has passed (or is unset), and its
 * `expiresAt` has not. That keeps behaviour correct without a scheduler, and
 * means an announcement scheduled for 8am appears at 8am even if nothing ran
 * overnight.
 */

function isLive(data: Record<string, unknown>, now = Date.now()): boolean {
  if (data.published !== true) return false;

  const publishAt = data.publishAt as Timestamp | null | undefined;
  if (publishAt && publishAt.toMillis() > now) return false;

  const expiresAt = data.expiresAt as Timestamp | null | undefined;
  if (expiresAt && expiresAt.toMillis() <= now) return false;

  return true;
}

export async function listLiveAnnouncements(
  audience: 'APP' | 'PUBLIC',
): Promise<Announcement[]> {
  const base = db().collection(COLLECTIONS.announcements).where('published', '==', true);
  const snapshot = await runOrderedQuery({
    base,
    ordered: base.orderBy('createdAt', 'desc').limit(50),
    limit: 50,
    timestampOf: (data) => millisOf(data.createdAt),
    label: 'published announcements, newest first',
  });

  const now = Date.now();
  return snapshot.docs
    .filter((doc) => {
      const data = doc.data();
      if (!isLive(data, now)) return false;
      const target = data.audience as AnnouncementAudience;
      return target === 'BOTH' || target === audience;
    })
    .map((doc) => mapAnnouncement(doc.id, doc.data()))
    // Pinned first, then newest.
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, 10);
}

export async function listAllAnnouncements(): Promise<Announcement[]> {
  const snapshot = await db()
    .collection(COLLECTIONS.announcements)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return snapshot.docs.map((doc) => mapAnnouncement(doc.id, doc.data()));
}

export async function createAnnouncement(
  input: AnnouncementInput,
  createdBy: string,
): Promise<Announcement> {
  const id = newAnnouncementId();
  const now = Timestamp.now();
  const record = {
    title: input.title,
    body: input.body,
    level: input.level,
    audience: input.audience,
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl ?? null,
    published: input.published,
    publishAt: input.publishAt ? Timestamp.fromDate(new Date(input.publishAt)) : null,
    expiresAt: input.expiresAt ? Timestamp.fromDate(new Date(input.expiresAt)) : null,
    pinned: input.pinned,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await db().collection(COLLECTIONS.announcements).doc(id).create(record);
  return mapAnnouncement(id, record);
}

export async function updateAnnouncement(
  id: string,
  patch: Partial<AnnouncementInput>,
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: Timestamp.now() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    update[key] =
      key === 'publishAt' || key === 'expiresAt'
        ? value
          ? Timestamp.fromDate(new Date(value as string))
          : null
        : value;
  }
  await db().collection(COLLECTIONS.announcements).doc(id).update(update);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await db().collection(COLLECTIONS.announcements).doc(id).delete();
}

export function mapAnnouncement(id: string, data: Record<string, unknown>): Announcement {
  return {
    id,
    title: String(data.title ?? ''),
    body: String(data.body ?? ''),
    level: (data.level as AnnouncementLevel) ?? 'INFO',
    audience: (data.audience as AnnouncementAudience) ?? 'APP',
    ctaLabel: (data.ctaLabel as string | null) ?? null,
    ctaUrl: (data.ctaUrl as string | null) ?? null,
    published: Boolean(data.published),
    publishAt: toIso(data.publishAt),
    expiresAt: toIso(data.expiresAt),
    pinned: Boolean(data.pinned),
    createdBy: String(data.createdBy ?? ''),
    createdAt: toIsoRequired(data.createdAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
  };
}
