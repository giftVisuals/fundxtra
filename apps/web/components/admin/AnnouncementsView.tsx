'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatDateTime,
  relativeTime,
  tokens,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementLevel,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { AdminButton, AdminCard, AdminField, Pill, Table, Td, Toggle, adminInputStyle } from './primitives';

/**
 * Announcements.
 *
 * Scheduling is evaluated at read time by the API, not by a job, so an
 * announcement set for 8am appears at 8am whether or not anything ran
 * overnight. That is worth knowing here because it means "schedule" and
 * "publish" are independent: an announcement can be published *and* scheduled,
 * and it simply is not live until its publish time passes.
 *
 * The audience matters more than it looks. PUBLIC and BOTH announcements are
 * readable from the marketing website — that is the one place Firestore rules
 * allow a client read — so an APP-only announcement genuinely cannot leak to
 * the public site.
 */
export function AnnouncementsView() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<{ announcements: Announcement[] }>('/admin/announcements');
      setItems(result.announcements);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (announcement: Announcement, body: Record<string, unknown>, success: string) => {
      setBusyId(announcement.id);
      setError(null);
      setNotice(null);
      try {
        await api.patch(`/admin/announcements/${announcement.id}`, body);
        setNotice(success);
        await load();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (announcement: Announcement) => {
      setBusyId(announcement.id);
      setError(null);
      try {
        await api.delete(`/admin/announcements/${announcement.id}`);
        setNotice(`Deleted "${announcement.title}".`);
        await load();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>Announcements</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <AdminButton onClick={() => void load()}>Refresh</AdminButton>
          <AdminButton tone="primary" onClick={() => setComposing((open) => !open)}>
            {composing ? 'Close' : 'New announcement'}
          </AdminButton>
        </div>
      </div>

      {notice && (
        <AdminCard>
          <p role="status" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.success.strong }}>
            {notice}
          </p>
        </AdminCard>
      )}
      {error && (
        <AdminCard>
          <p role="alert" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        </AdminCard>
      )}

      {composing && (
        <Composer
          onCreated={() => {
            setComposing(false);
            setNotice('Announcement created.');
            void load();
          }}
        />
      )}

      <AdminCard padded={false}>
        <Table
          columns={['Announcement', 'Audience', 'Level', 'Live', 'Window', 'Actions']}
          empty={items !== null && items.length === 0}
        >
          {(items ?? []).map((announcement) => {
            const live = isLive(announcement);
            return (
              <tr key={announcement.id}>
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {announcement.pinned && <Pill tone="brand">PINNED</Pill>}
                    <span style={{ fontWeight: tokens.typography.weight.semibold }}>
                      {announcement.title}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      maxWidth: 420,
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {announcement.body}
                  </div>
                </Td>
                <Td>
                  <Pill tone={announcement.audience === 'APP' ? 'neutral' : 'info'}>
                    {announcement.audience}
                  </Pill>
                </Td>
                <Td>
                  <Pill
                    tone={
                      announcement.level === 'CRITICAL'
                        ? 'danger'
                        : announcement.level === 'WARNING'
                          ? 'warning'
                          : announcement.level === 'SUCCESS'
                            ? 'success'
                            : 'neutral'
                    }
                  >
                    {announcement.level}
                  </Pill>
                </Td>
                <Td>
                  {/* Published and live are different things: a published
                      announcement scheduled for later is not yet live. */}
                  <Pill tone={live ? 'success' : 'neutral'}>
                    {live ? 'LIVE' : announcement.published ? 'SCHEDULED' : 'DRAFT'}
                  </Pill>
                </Td>
                <Td nowrap>
                  <div style={{ fontSize: tokens.typography.size['2xs'] }}>
                    {announcement.publishAt
                      ? `from ${formatDateTime(announcement.publishAt)}`
                      : 'no start'}
                  </div>
                  <div
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    {announcement.expiresAt
                      ? `until ${formatDateTime(announcement.expiresAt)}`
                      : 'no end'}
                  </div>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Toggle
                      label={`Publish ${announcement.title}`}
                      checked={announcement.published}
                      disabled={busyId !== null}
                      onChange={(next) =>
                        void patch(
                          announcement,
                          { published: next },
                          next ? 'Published.' : 'Unpublished.',
                        )
                      }
                    />
                    <AdminButton
                      size="xs"
                      disabled={busyId !== null}
                      onClick={() =>
                        void patch(
                          announcement,
                          { pinned: !announcement.pinned },
                          announcement.pinned ? 'Unpinned.' : 'Pinned to the top.',
                        )
                      }
                    >
                      {announcement.pinned ? 'Unpin' : 'Pin'}
                    </AdminButton>
                    <AdminButton
                      size="xs"
                      tone="danger"
                      disabled={busyId !== null}
                      onClick={() => void remove(announcement)}
                    >
                      Delete
                    </AdminButton>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkFaint,
                    }}
                  >
                    created {relativeTime(announcement.createdAt)}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </AdminCard>
    </div>
  );
}

/** Mirrors the API's read-time scheduling check, so the badge cannot mislead. */
function isLive(announcement: Announcement, now = Date.now()): boolean {
  if (!announcement.published) return false;
  if (announcement.publishAt && new Date(announcement.publishAt).getTime() > now) return false;
  if (announcement.expiresAt && new Date(announcement.expiresAt).getTime() <= now) return false;
  return true;
}

function Composer({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<AnnouncementLevel>('INFO');
  const [audience, setAudience] = useState<AnnouncementAudience>('APP');
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pinned, setPinned] = useState(false);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/announcements', {
        title: title.trim(),
        body: body.trim(),
        level,
        audience,
        published,
        pinned,
        ctaLabel: null,
        ctaUrl: null,
        ...(publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  }, [title, body, level, audience, published, pinned, publishAt, expiresAt, onCreated]);

  const ready = title.trim().length >= 3 && body.trim().length >= 10;

  return (
    <AdminCard title="New announcement">
      <div style={{ display: 'grid', gap: 12 }}>
        <AdminField label="Title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Withdrawals open this Friday"
            style={adminInputStyle}
          />
        </AdminField>

        <AdminField label="Body" hint="Plain text. Be specific — users act on this.">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            style={{ ...adminInputStyle, minHeight: 78, padding: 10, resize: 'vertical' }}
          />
        </AdminField>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))',
            gap: 12,
          }}
        >
          <AdminField label="Level">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as AnnouncementLevel)}
              style={adminInputStyle}
            >
              <option value="INFO">Info</option>
              <option value="SUCCESS">Success</option>
              <option value="WARNING">Warning</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </AdminField>

          <AdminField
            label="Audience"
            hint={
              audience === 'APP'
                ? 'Mini App only. Cannot be read from the public website.'
                : 'Readable on the public website.'
            }
          >
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}
              style={adminInputStyle}
            >
              <option value="APP">Mini App only</option>
              <option value="PUBLIC">Public website only</option>
              <option value="BOTH">Both</option>
            </select>
          </AdminField>

          <AdminField label="Show from" hint="Optional. Leave empty to show immediately.">
            <input
              type="datetime-local"
              value={publishAt}
              onChange={(event) => setPublishAt(event.target.value)}
              style={adminInputStyle}
            />
          </AdminField>

          <AdminField label="Hide after" hint="Optional.">
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              style={adminInputStyle}
            />
          </AdminField>
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: tokens.typography.size.xs, fontWeight: tokens.typography.weight.semibold }}>
              Publish now
            </span>
            <Toggle label="Publish now" checked={published} onChange={setPublished} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: tokens.typography.size.xs, fontWeight: tokens.typography.weight.semibold }}>
              Pin to the top
            </span>
            <Toggle label="Pin" checked={pinned} onChange={setPinned} />
          </div>
        </div>

        {error && (
          <p role="alert" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        )}

        <div>
          <AdminButton tone="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            Create announcement
          </AdminButton>
        </div>
      </div>
    </AdminCard>
  );
}
