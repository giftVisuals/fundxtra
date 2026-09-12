'use client';

import { useCallback, useState } from 'react';
import { formatNaira, parseNairaInput, tokens, type SystemSettings } from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/admin-session';
import { AdminButton, AdminCard, AdminField, Toggle, adminInputStyle } from './primitives';

/**
 * System settings.
 *
 * The withdrawal portal switch is the highest-consequence control on the
 * platform, so it is first and unambiguous, and the maintenance message shown
 * to users while it is closed is edited right beside it — a closed portal with
 * a stale message is worse than one with no message.
 *
 * Reward switches are shown with the active provider's actual capability, so
 * an operator cannot enable airtime and then wonder why nobody can redeem it.
 */
export function SettingsView() {
  const { data, refresh } = useAdmin();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
    Every hook must run before any early return, or React's hook order
    changes between the loading render and the loaded one. `save` therefore
    lives above the `!data` guard and reads `draft`/`reason` from closure.
  */
  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch('/admin/settings', {
        ...draft,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setDraft({});
      setReason('');
      setNotice('Settings saved and recorded in the audit log.');
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  }, [draft, reason, refresh]);

  if (!data) return <AdminCard>Loading…</AdminCard>;
  const { settings, provider } = data;

  const section = <K extends keyof SystemSettings>(key: K): Record<string, unknown> =>
    (draft[key as string] as Record<string, unknown> | undefined) ?? {};

  const set = <K extends keyof SystemSettings>(key: K, field: string, value: unknown) =>
    setDraft((current) => ({
      ...current,
      [key]: { ...((current[key as string] as Record<string, unknown>) ?? {}), [field]: value },
    }));

  const value = <K extends keyof SystemSettings>(key: K, field: string): unknown => {
    const staged = section(key)[field];
    if (staged !== undefined) return staged;
    return (settings[key] as Record<string, unknown>)[field];
  };

  const dirty = Object.keys(draft).length > 0;

  const nairaField = <K extends keyof SystemSettings>(
    key: K,
    field: string,
    label: string,
    hint?: string,
  ) => {
    const current = value(key, field) as number;
    const staged = section(key)[field] as number | undefined;
    return (
      <AdminField label={label} hint={hint ?? `Currently ${formatNaira(current)}`}>
        <input
          inputMode="decimal"
          defaultValue={String(current / 100)}
          onChange={(event) => {
            const parsed = parseNairaInput(event.target.value);
            if (parsed !== null) set(key, field, parsed);
          }}
          style={{
            ...adminInputStyle,
            borderColor: staged !== undefined ? tokens.semantic.brand : tokens.semantic.border,
          }}
        />
      </AdminField>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>Settings</h1>
        {dirty && (
          <div style={{ display: 'flex', gap: 8 }}>
            <AdminButton onClick={() => setDraft({})}>Discard</AdminButton>
            <AdminButton tone="primary" loading={busy} onClick={() => void save()}>
              Save changes
            </AdminButton>
          </div>
        )}
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

      <AdminCard title="Withdrawal portal">
        <div style={{ display: 'grid', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: 12,
              background: (value('withdrawals', 'enabled') as boolean)
                ? tokens.colors.success.soft
                : tokens.colors.warning.soft,
              border: `1px solid ${
                (value('withdrawals', 'enabled') as boolean) ? '#cfe7d7' : '#f0dcb8'
              }`,
              borderRadius: tokens.radii.xs,
            }}
          >
            <div>
              <div style={{ fontSize: tokens.typography.size.sm, fontWeight: tokens.typography.weight.bold }}>
                Withdrawals are{' '}
                {(value('withdrawals', 'enabled') as boolean) ? 'OPEN' : 'CLOSED'}
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: tokens.typography.size['2xs'],
                  color: tokens.semantic.inkMuted,
                }}
              >
                Users see this status and the message below in their wallet.
              </div>
            </div>
            <Toggle
              label="Withdrawal portal"
              checked={value('withdrawals', 'enabled') as boolean}
              onChange={(next) => set('withdrawals', 'enabled', next)}
            />
          </div>

          <AdminField
            label="Message shown while closed"
            hint="Keep it specific. 'Opens Friday 9am' beats 'temporarily unavailable'."
          >
            <input
              defaultValue={value('withdrawals', 'maintenanceMessage') as string}
              onChange={(event) =>
                set('withdrawals', 'maintenanceMessage', event.target.value)
              }
              style={adminInputStyle}
            />
          </AdminField>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
              gap: 12,
            }}
          >
            {nairaField('withdrawals', 'minAmountKobo', 'Minimum withdrawal')}
            {nairaField('withdrawals', 'maxAmountKobo', 'Maximum per request')}
            {nairaField('withdrawals', 'dailyLimitKobo', 'Daily limit per user')}
            {nairaField('withdrawals', 'feeKobo', 'Fee per withdrawal')}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
              gap: 12,
            }}
          >
            <AdminField
              label="Scheduled open"
              hint="Optional. When set, this overrides the switch above until it passes."
            >
              <input
                type="datetime-local"
                defaultValue={toLocalInput(value('withdrawals', 'opensAt') as string | null)}
                onChange={(event) =>
                  set(
                    'withdrawals',
                    'opensAt',
                    event.target.value ? new Date(event.target.value).toISOString() : null,
                  )
                }
                style={adminInputStyle}
              />
            </AdminField>
            <AdminField label="Scheduled close" hint="Optional.">
              <input
                type="datetime-local"
                defaultValue={toLocalInput(value('withdrawals', 'closesAt') as string | null)}
                onChange={(event) =>
                  set(
                    'withdrawals',
                    'closesAt',
                    event.target.value ? new Date(event.target.value).toISOString() : null,
                  )
                }
                style={adminInputStyle}
              />
            </AdminField>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Reward delivery">
        <p
          style={{
            marginBottom: 14,
            fontSize: tokens.typography.size.xs,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          A reward is only offered to users when the switch below is on <em>and</em> the active
          provider ({provider.name}) can deliver it. Turning one on while the provider cannot
          deliver changes nothing for users — the catalogue still shows it as coming soon.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {(
            [
              ['airtimeEnabled', 'Airtime', provider.capabilities.airtime],
              ['dataEnabled', 'Data', provider.capabilities.data],
              ['starsEnabled', 'Telegram Stars', provider.capabilities.telegramStars],
              ['premiumEnabled', 'Telegram Premium', provider.capabilities.telegramPremium],
            ] as Array<[string, string, boolean]>
          ).map(([field, label, supported]) => (
            <div
              key={field}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                background: tokens.semantic.bgSubtle,
                border: `1px solid ${tokens.semantic.border}`,
                borderRadius: tokens.radii.xs,
              }}
            >
              <div>
                <div style={{ fontSize: tokens.typography.size.sm, fontWeight: tokens.typography.weight.medium }}>
                  {label}
                </div>
                <div
                  style={{
                    fontSize: tokens.typography.size['2xs'],
                    color: supported ? tokens.colors.success.strong : tokens.colors.warning.strong,
                  }}
                >
                  {supported
                    ? 'Provider can deliver this'
                    : 'Provider cannot deliver this yet'}
                </div>
              </div>
              <Toggle
                label={label}
                checked={value('rewards', field) as boolean}
                onChange={(next) => set('rewards', field, next)}
              />
            </div>
          ))}
        </div>
      </AdminCard>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <AdminCard title="Tasks and referrals">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: tokens.typography.size.sm }}>Task earning enabled</span>
              <Toggle
                label="Task earning"
                checked={value('tasks', 'earningEnabled') as boolean}
                onChange={(next) => set('tasks', 'earningEnabled', next)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: tokens.typography.size.sm }}>Referral programme enabled</span>
              <Toggle
                label="Referrals"
                checked={value('referrals', 'enabled') as boolean}
                onChange={(next) => set('referrals', 'enabled', next)}
              />
            </div>
            {nairaField('referrals', 'rewardKobo', 'Referral reward')}
            {nairaField(
              'tasks',
              'maxRewardKobo',
              'Maximum reward per task',
              'Can be lowered below the ₦1,000 hard cap, never raised above it.',
            )}
          </div>
        </AdminCard>

        <AdminCard title="Platform">
          <div style={{ display: 'grid', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: 10,
                background: (value('platform', 'maintenanceMode') as boolean)
                  ? tokens.colors.danger.soft
                  : 'transparent',
                borderRadius: tokens.radii.xs,
              }}
            >
              <div>
                <div style={{ fontSize: tokens.typography.size.sm }}>Maintenance mode</div>
                <div
                  style={{
                    fontSize: tokens.typography.size['2xs'],
                    color: tokens.semantic.inkSubtle,
                  }}
                >
                  Blocks all non-admin traffic. Admins keep working.
                </div>
              </div>
              <Toggle
                label="Maintenance mode"
                checked={value('platform', 'maintenanceMode') as boolean}
                onChange={(next) => set('platform', 'maintenanceMode', next)}
              />
            </div>
            <AdminField label="Maintenance message">
              <input
                defaultValue={value('platform', 'maintenanceMessage') as string}
                onChange={(event) => set('platform', 'maintenanceMessage', event.target.value)}
                style={adminInputStyle}
              />
            </AdminField>
            <AdminField label="Bot username" hint="Used to build referral links. No @.">
              <input
                defaultValue={value('platform', 'botUsername') as string}
                onChange={(event) => set('platform', 'botUsername', event.target.value)}
                style={adminInputStyle}
              />
            </AdminField>
            <AdminField label="Support handle">
              <input
                defaultValue={value('platform', 'supportHandle') as string}
                onChange={(event) => set('platform', 'supportHandle', event.target.value)}
                style={adminInputStyle}
              />
            </AdminField>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: tokens.typography.size.sm }}>
                Show statistics on the public site
              </span>
              <Toggle
                label="Public statistics"
                checked={value('platform', 'publicStatsEnabled') as boolean}
                onChange={(next) => set('platform', 'publicStatsEnabled', next)}
              />
            </div>
          </div>
        </AdminCard>
      </div>

      {dirty && (
        <AdminCard title="Save changes">
          <div style={{ display: 'grid', gap: 12 }}>
            <AdminField
              label="Reason (optional, recorded in the audit log)"
              hint={`${Object.keys(draft).length} section${Object.keys(draft).length === 1 ? '' : 's'} changed.`}
            >
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Opening withdrawals for the Friday window"
                style={adminInputStyle}
              />
            </AdminField>
            <div style={{ display: 'flex', gap: 8 }}>
              <AdminButton tone="primary" loading={busy} onClick={() => void save()}>
                Save changes
              </AdminButton>
              <AdminButton onClick={() => setDraft({})}>Discard</AdminButton>
            </div>
          </div>
        </AdminCard>
      )}
    </div>
  );
}

/** ISO string to the value a `datetime-local` input expects, in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
