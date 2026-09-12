'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  atHandle,
  effectivePermissions,
  formatDateTime,
  permissionsForRole,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  tokens,
  type Admin,
  type AdminInvite,
  type AdminRole,
  type Permission,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/admin-session';
import { AdminButton, AdminCard, AdminField, Pill, Table, Td, adminInputStyle } from './primitives';

/**
 * Admin management.
 *
 * Telegram ID is the identity. A username can only create a *pending invite*,
 * claimed the first time that handle signs in — usernames are reassignable on
 * Telegram, so treating one as an identity would hand admin access to whoever
 * acquires the handle next. The form says so rather than leaving it implicit.
 */
export function AdminsView() {
  const { data } = useAdmin();
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [invites, setInvites] = useState<AdminInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<'id' | 'username'>('id');
  const [telegramId, setTelegramId] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<AdminRole>('MODERATOR');
  const [extras, setExtras] = useState<Permission[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<{ admins: Admin[]; invites: AdminInvite[] }>('/admin/admins');
      setAdmins(result.admins);
      setInvites(result.invites);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post('/admin/admins', {
        ...(mode === 'id' ? { telegramId: telegramId.trim() } : { username: username.trim() }),
        displayName: displayName.trim(),
        role,
        extraPermissions: extras,
      });
      setNotice(
        mode === 'id'
          ? 'Admin added. They have access from their next sign-in.'
          : `Invite created for ${atHandle(username.trim())}. It is claimed the first time that account opens Fundxtra.`,
      );
      setTelegramId('');
      setUsername('');
      setDisplayName('');
      setExtras([]);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  }, [mode, telegramId, username, displayName, role, extras, load]);

  const remove = useCallback(
    async (admin: Admin) => {
      setBusy(true);
      setError(null);
      try {
        await api.delete(`/admin/admins/${admin.telegramId}`);
        setNotice(`${admin.displayName} no longer has admin access.`);
        await load();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const rolePermissions = permissionsForRole(role);
  // Grants the server would strip anyway, shown as unavailable rather than
  // offered and silently discarded.
  const grantable = (Object.keys(PERMISSION_LABELS) as Permission[]).filter(
    (permission) =>
      !rolePermissions.includes(permission) &&
      (role === 'SUPER_ADMIN' || !SUPER_ADMIN_ONLY_PERMISSIONS.includes(permission)),
  );

  const ready =
    displayName.trim().length >= 2 &&
    (mode === 'id' ? /^\d{3,20}$/.test(telegramId.trim()) : username.trim().length >= 5);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: tokens.typography.size.xl }}>Admins</h1>

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

      <AdminCard title="Add an admin">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <AdminButton tone={mode === 'id' ? 'primary' : 'default'} onClick={() => setMode('id')}>
              By Telegram ID
            </AdminButton>
            <AdminButton
              tone={mode === 'username' ? 'primary' : 'default'}
              onClick={() => setMode('username')}
            >
              By username
            </AdminButton>
          </div>

          <p
            style={{
              fontSize: tokens.typography.size['2xs'],
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            {mode === 'id'
              ? 'A Telegram ID is a stable identity and grants access immediately. This is the preferred route.'
              : 'A username creates a pending invite instead of an admin, because Telegram usernames can be given up and claimed by someone else. It becomes a real admin, keyed to a Telegram ID, the first time that handle opens Fundxtra.'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
              gap: 12,
            }}
          >
            {mode === 'id' ? (
              <AdminField label="Telegram ID" hint="Digits only">
                <input
                  inputMode="numeric"
                  value={telegramId}
                  onChange={(event) => setTelegramId(event.target.value.replace(/\D/g, ''))}
                  placeholder="6438544386"
                  style={adminInputStyle}
                />
              </AdminField>
            ) : (
              <AdminField label="Telegram username" hint="Without the @">
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.replace(/^@/, ''))}
                  placeholder="giftvisuals"
                  style={adminInputStyle}
                />
              </AdminField>
            )}

            <AdminField label="Display name">
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Operations lead"
                style={adminInputStyle}
              />
            </AdminField>

            <AdminField label="Role">
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as AdminRole);
                  setExtras([]);
                }}
                style={adminInputStyle}
              >
                {(Object.keys(ROLE_LABELS) as AdminRole[]).map((entry) => (
                  <option key={entry} value={entry}>
                    {ROLE_LABELS[entry]}
                  </option>
                ))}
              </select>
            </AdminField>
          </div>

          <div>
            <div
              style={{
                marginBottom: 7,
                fontSize: tokens.typography.size.xs,
                fontWeight: tokens.typography.weight.semibold,
                color: tokens.semantic.inkMuted,
              }}
            >
              Included with {ROLE_LABELS[role]}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {rolePermissions.map((permission) => (
                <Pill key={permission} tone="brand">
                  {PERMISSION_LABELS[permission]}
                </Pill>
              ))}
            </div>
          </div>

          {grantable.length > 0 && (
            <div>
              <div
                style={{
                  marginBottom: 7,
                  fontSize: tokens.typography.size.xs,
                  fontWeight: tokens.typography.weight.semibold,
                  color: tokens.semantic.inkMuted,
                }}
              >
                Extra permissions
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {grantable.map((permission) => (
                  <label
                    key={permission}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: tokens.typography.size.xs,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={extras.includes(permission)}
                      onChange={(event) =>
                        setExtras((current) =>
                          event.target.checked
                            ? [...current, permission]
                            : current.filter((entry) => entry !== permission),
                        )
                      }
                    />
                    {PERMISSION_LABELS[permission]}
                  </label>
                ))}
              </div>
              {role !== 'SUPER_ADMIN' && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: tokens.typography.size['2xs'],
                    color: tokens.semantic.inkSubtle,
                  }}
                >
                  Managing admins, system settings and financial settings are reserved for super
                  admins and cannot be granted here — the server strips them regardless.
                </p>
              )}
            </div>
          )}

          <div>
            <AdminButton tone="primary" disabled={!ready} loading={busy} onClick={() => void add()}>
              {mode === 'id' ? 'Add admin' : 'Create invite'}
            </AdminButton>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Current admins" padded={false}>
        <Table
          columns={['Admin', 'Telegram ID', 'Role', 'Permissions', 'Last active', '']}
          empty={admins !== null && admins.length === 0}
        >
          {(admins ?? []).map((admin) => {
            const isPrimary = admin.telegramId === data?.admin.telegramId && data.admin.isPrimary;
            const isSelf = admin.telegramId === data?.admin.telegramId;
            return (
              <tr key={admin.id}>
                <Td>
                  <div style={{ fontWeight: tokens.typography.weight.semibold }}>
                    {admin.displayName}
                  </div>
                  <div
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    {admin.username ? atHandle(admin.username) : 'no username'}
                    {!admin.active ? ' · deactivated' : ''}
                  </div>
                </Td>
                <Td mono nowrap>{admin.telegramId}</Td>
                <Td>
                  <Pill tone={admin.role === 'SUPER_ADMIN' ? 'brand' : 'neutral'}>
                    {ROLE_LABELS[admin.role]}
                  </Pill>
                </Td>
                <Td>
                  <span
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkMuted,
                    }}
                  >
                    {effectivePermissions(admin.role, admin.extraPermissions).length} permissions
                  </span>
                </Td>
                <Td nowrap>
                  {admin.lastActiveAt ? formatDateTime(admin.lastActiveAt) : 'never'}
                </Td>
                <Td align="right">
                  {isPrimary ? (
                    <Pill tone="brand">Owner</Pill>
                  ) : isSelf ? (
                    <span style={{ fontSize: tokens.typography.size['2xs'], color: tokens.semantic.inkSubtle }}>
                      you
                    </span>
                  ) : admin.active ? (
                    <AdminButton size="xs" tone="danger" disabled={busy} onClick={() => void remove(admin)}>
                      Remove
                    </AdminButton>
                  ) : (
                    <span style={{ color: tokens.semantic.inkFaint }}>—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </AdminCard>

      {invites && invites.length > 0 && (
        <AdminCard title="Pending username invites" padded={false}>
          <Table columns={['Username', 'Role', 'Invited by', 'Expires']}>
            {invites.map((invite) => (
              <tr key={invite.id}>
                <Td>{atHandle(invite.username)}</Td>
                <Td>
                  <Pill tone="neutral">{ROLE_LABELS[invite.role]}</Pill>
                </Td>
                <Td mono>{invite.invitedBy}</Td>
                <Td nowrap>{formatDateTime(invite.expiresAt)}</Td>
              </tr>
            ))}
          </Table>
        </AdminCard>
      )}
    </div>
  );
}
