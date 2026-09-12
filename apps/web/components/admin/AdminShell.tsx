'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatNaira, tokens, type Permission } from '@fundxtra/shared';
import { useAdmin } from '@/lib/admin-session';
import { supportUrl } from '@/lib/config';
import { AdminButton, AdminCard, Metric } from './primitives';
import { UsersView } from './UsersView';
import { SubmissionsView } from './SubmissionsView';
import { WithdrawalsView } from './WithdrawalsView';
import { TasksView } from './TasksView';
import { SettingsView } from './SettingsView';
import { AdminsView } from './AdminsView';
import { AuditView } from './AuditView';

/**
 * Admin console.
 *
 * Navigation is a plain sidebar, not the glass tab bar. The glass belongs to
 * the Mini App's five thumb-reachable sections; an operator working through a
 * review queue on a laptop needs a list they can scan and click, and reusing
 * the fluid navigation here would be decoration at the cost of usability.
 *
 * Sections are filtered by the caller's permissions so a moderator does not
 * see controls they cannot use. That is a courtesy: every endpoint behind these
 * views re-checks the permission server-side.
 */

type ViewId =
  | 'overview'
  | 'users'
  | 'submissions'
  | 'withdrawals'
  | 'tasks'
  | 'settings'
  | 'admins'
  | 'audit';

interface ViewDefinition {
  id: ViewId;
  label: string;
  permission: Permission | null;
  badge?: number;
}

export function AdminShell() {
  const { state, data, error, refresh, can } = useAdmin();
  const [view, setView] = useState<ViewId>('overview');

  if (state === 'BOOTING') return <AdminMessage title="Opening the admin panel…" />;

  if (state === 'OUTSIDE_TELEGRAM') {
    return (
      <AdminMessage
        title="Open the admin panel from Telegram"
        body="Fundxtra administrators sign in with their Telegram account — there is no separate admin password, which means there is no separate credential to leak. Open the Fundxtra bot, then this panel."
      />
    );
  }

  if (state === 'FORBIDDEN') {
    return (
      <AdminMessage
        title="You do not have admin access"
        body="This Telegram account is not an administrator on Fundxtra. If that is unexpected, contact the platform owner."
        action={{ label: 'Back to Fundxtra', href: '/app' }}
      />
    );
  }

  if (state === 'ERROR' || !data) {
    return (
      <AdminMessage
        title="Could not load the admin panel"
        body={error ?? 'Please try again.'}
        action={{ label: 'Retry', onClick: () => void refresh() }}
      />
    );
  }

  // Typed as ViewDefinition[] up front, so the permission strings are checked
  // against the Permission union rather than widened to string by the filter.
  const allViews: ViewDefinition[] = [
    { id: 'overview', label: 'Overview', permission: null },
    { id: 'users', label: 'Users', permission: 'users:view' },
    {
      id: 'submissions',
      label: 'Review queue',
      permission: 'submissions:review',
      badge: data.stats.tasks.pendingSubmissions,
    },
    {
      id: 'withdrawals',
      label: 'Withdrawals',
      permission: 'withdrawals:view',
      badge: data.stats.finance.pendingWithdrawalCount,
    },
    { id: 'tasks', label: 'Campaigns', permission: 'tasks:manage' },
    { id: 'settings', label: 'Settings', permission: 'settings:manage' },
    { id: 'admins', label: 'Admins', permission: 'admins:manage' },
    { id: 'audit', label: 'Audit log', permission: 'audit:view' },
  ];

  const views = allViews.filter(
    (entry) => entry.permission === null || can(entry.permission),
  );

  return (
    <div style={{ minHeight: '100dvh', background: tokens.colors.sand[50] }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: tokens.zIndex.sticky,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 18px',
          background: tokens.semantic.surface,
          borderBottom: `1px solid ${tokens.semantic.border}`,
        }}
      >
        <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/fundxtra-mark.png" alt="" width={24} height={20} />
          <span
            style={{
              fontFamily: tokens.typography.fontDisplay,
              fontSize: tokens.typography.size.base,
              fontWeight: tokens.typography.weight.bold,
              color: tokens.semantic.brandInk,
            }}
          >
            Fundxtra
          </span>
        </Link>
        <span
          style={{
            padding: '2px 8px',
            background: tokens.colors.cocoa[700],
            color: '#fff',
            borderRadius: tokens.radii.xs,
            fontSize: tokens.typography.size['2xs'],
            fontWeight: tokens.typography.weight.bold,
            letterSpacing: tokens.typography.tracking.wider,
          }}
        >
          ADMIN
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Environment warnings an operator must not have to hunt for. */}
          {data.environment.devAuthEnabled && (
            <span
              title="ALLOW_DEV_AUTH lets anyone mint a session without Telegram. Disable it."
              style={{
                padding: '3px 8px',
                background: tokens.colors.danger.soft,
                color: tokens.colors.danger.strong,
                border: '1px solid #f3d3ce',
                borderRadius: tokens.radii.xs,
                fontSize: tokens.typography.size['2xs'],
                fontWeight: tokens.typography.weight.bold,
              }}
            >
              DEV AUTH ENABLED
            </span>
          )}
          {!data.environment.telegramConfigured && (
            <span
              title="TELEGRAM_BOT_TOKEN is not set, so Telegram verification cannot run."
              style={{
                padding: '3px 8px',
                background: tokens.colors.warning.soft,
                color: tokens.colors.warning.strong,
                border: '1px solid #f0dcb8',
                borderRadius: tokens.radii.xs,
                fontSize: tokens.typography.size['2xs'],
                fontWeight: tokens.typography.weight.bold,
              }}
            >
              NO BOT TOKEN
            </span>
          )}

          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: tokens.typography.size.xs,
                fontWeight: tokens.typography.weight.semibold,
              }}
            >
              {data.admin.displayName}
            </div>
            <div
              style={{
                fontSize: tokens.typography.size['2xs'],
                color: tokens.semantic.inkSubtle,
              }}
            >
              {data.admin.role.replace('_', ' ').toLowerCase()}
              {data.admin.isPrimary ? ' · owner' : ''}
            </div>
          </div>

          {/*
            The admin/user view switch. A Link rather than a location
            assignment, so switching is a client navigation and the admin is
            not waiting on a full page load to check what users see.
          */}
          <Link
            href="/app"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 34,
              padding: '0 12px',
              background: tokens.semantic.surface,
              color: tokens.semantic.ink,
              border: `1px solid ${tokens.semantic.borderStrong}`,
              borderRadius: tokens.radii.xs,
              fontSize: tokens.typography.size.xs,
              fontWeight: tokens.typography.weight.semibold,
              whiteSpace: 'nowrap',
            }}
          >
            User view
          </Link>
        </div>
      </header>

      {/*
        The grid columns live in the stylesheet below, not in a style prop.
        An inline `gridTemplateColumns` wins over a stylesheet rule, so
        setting the single-column default inline made the desktop media
        query a no-op and the sidebar never became a sidebar.
      */}
      <div className="fx-admin-layout">
        <nav aria-label="Admin sections" className="fx-admin-nav">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {views.map((entry) => {
              const active = entry.id === view;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setView(entry.id)}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    minHeight: 36,
                    padding: '0 11px',
                    textAlign: 'left',
                    background: active ? tokens.colors.cocoa[50] : 'transparent',
                    color: active ? tokens.semantic.brandInk : tokens.semantic.inkMuted,
                    border: `1px solid ${active ? tokens.colors.cocoa[200] : 'transparent'}`,
                    borderRadius: tokens.radii.xs,
                    fontSize: tokens.typography.size.sm,
                    fontWeight: active
                      ? tokens.typography.weight.semibold
                      : tokens.typography.weight.medium,
                  }}
                >
                  <span style={{ flex: 1 }}>{entry.label}</span>
                  {typeof entry.badge === 'number' && entry.badge > 0 && (
                    <span
                      style={{
                        minWidth: 18,
                        padding: '1px 5px',
                        background: tokens.colors.danger.base,
                        color: '#fff',
                        borderRadius: tokens.radii.pill,
                        fontSize: 10,
                        fontWeight: 700,
                        textAlign: 'center',
                      }}
                    >
                      {entry.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <a
            href={supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              marginTop: 18,
              padding: '10px 11px',
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkSubtle,
              border: `1px dashed ${tokens.semantic.border}`,
              borderRadius: tokens.radii.xs,
            }}
          >
            Support inbox →
          </a>
        </nav>

        <main style={{ minWidth: 0 }}>
          {view === 'overview' && <OverviewView />}
          {view === 'users' && <UsersView />}
          {view === 'submissions' && <SubmissionsView />}
          {view === 'withdrawals' && <WithdrawalsView />}
          {view === 'tasks' && <TasksView />}
          {view === 'settings' && <SettingsView />}
          {view === 'admins' && <AdminsView />}
          {view === 'audit' && <AuditView />}
        </main>
      </div>

      <style>{`
        .fx-admin-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 18px;
          max-width: 1400px;
          margin: 0 auto;
          padding: 18px;
        }
        @media (min-width: 900px) {
          .fx-admin-layout { grid-template-columns: 208px minmax(0, 1fr); }
          .fx-admin-nav { position: sticky; top: 72px; align-self: start; }
        }
      `}</style>
    </div>
  );
}

/** Overview: the numbers an operator checks first thing in the morning. */
function OverviewView() {
  const { data, refresh } = useAdmin();
  if (!data) return null;

  const { stats, provider, settings } = data;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>Overview</h1>
        <AdminButton onClick={() => void refresh()}>Refresh</AdminButton>
      </div>

      {/* Anything needing attention, before anything else. */}
      {(stats.tasks.pendingSubmissions > 0 ||
        stats.finance.pendingWithdrawalCount > 0 ||
        stats.risk.flaggedUsers > 0) && (
        <AdminCard title="Needs attention">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
              gap: 10,
            }}
          >
            {stats.tasks.pendingSubmissions > 0 && (
              <Metric
                label="Submissions to review"
                value={String(stats.tasks.pendingSubmissions)}
                tone="warning"
                delta="Users are waiting on these"
              />
            )}
            {stats.finance.pendingWithdrawalCount > 0 && (
              <Metric
                label="Withdrawals pending"
                value={String(stats.finance.pendingWithdrawalCount)}
                tone="warning"
                delta={`${formatNaira(stats.finance.pendingWithdrawalsKobo)} committed`}
              />
            )}
            {stats.risk.flaggedUsers > 0 && (
              <Metric
                label="Flagged accounts"
                value={String(stats.risk.flaggedUsers)}
                tone={stats.risk.highRiskUsers > 0 ? 'danger' : 'warning'}
                delta={`${stats.risk.highRiskUsers} high risk`}
              />
            )}
          </div>
        </AdminCard>
      )}

      <AdminCard title="Money">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))',
            gap: 10,
          }}
        >
          <Metric
            label="User balances"
            value={formatNaira(stats.finance.totalBalanceKobo, { compact: true })}
            delta="Owed to users right now"
            tone="brand"
          />
          <Metric
            label="Credited all time"
            value={formatNaira(stats.finance.totalEarnedKobo, { compact: true })}
          />
          <Metric
            label="Paid out all time"
            value={formatNaira(stats.finance.totalPaidOutKobo, { compact: true })}
          />
          <Metric
            label="Campaign budget left"
            value={formatNaira(stats.finance.activeCampaignRemainingKobo, { compact: true })}
            delta={`of ${formatNaira(stats.finance.activeCampaignBudgetKobo, { compact: true })} active`}
          />
        </div>
      </AdminCard>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <AdminCard title="Users">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))',
              gap: 10,
            }}
          >
            <Metric label="Total" value={stats.users.total.toLocaleString('en-NG')} />
            <Metric label="New today" value={stats.users.newToday.toLocaleString('en-NG')} tone="success" />
            <Metric label="Suspended" value={stats.users.suspended.toLocaleString('en-NG')} />
            <Metric label="Banned" value={stats.users.banned.toLocaleString('en-NG')} />
          </div>
        </AdminCard>

        <AdminCard title="Campaigns and referrals">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))',
              gap: 10,
            }}
          >
            <Metric label="Active" value={String(stats.tasks.active)} tone="brand" />
            <Metric label="Paused" value={String(stats.tasks.paused)} />
            <Metric label="Referrals paid" value={String(stats.referrals.qualified)} />
            <Metric
              label="Referral payout"
              value={formatNaira(stats.referrals.payoutKobo, { compact: true })}
            />
          </div>
        </AdminCard>
      </div>

      {/* Provider status. Surfaced because "why can nobody redeem airtime" is
          otherwise a mystery an operator cannot answer from the UI. */}
      <AdminCard title="Reward fulfilment">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: tokens.typography.size.sm }}>
              Active provider: <strong>{provider.name}</strong>
            </span>
            <span
              style={{
                padding: '2px 8px',
                background: provider.configured
                  ? tokens.colors.success.soft
                  : tokens.colors.warning.soft,
                color: provider.configured
                  ? tokens.colors.success.strong
                  : tokens.colors.warning.strong,
                borderRadius: tokens.radii.xs,
                fontSize: tokens.typography.size['2xs'],
                fontWeight: tokens.typography.weight.bold,
              }}
            >
              {provider.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
            </span>
          </div>

          <p
            style={{
              fontSize: tokens.typography.size.sm,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            {provider.nasfampay.note}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
              gap: 8,
              fontSize: tokens.typography.size.xs,
            }}
          >
            {[
              ['Airtime', settings.rewards.airtimeEnabled, provider.capabilities.airtime],
              ['Data', settings.rewards.dataEnabled, provider.capabilities.data],
              ['Telegram Stars', settings.rewards.starsEnabled, provider.capabilities.telegramStars],
              ['Telegram Premium', settings.rewards.premiumEnabled, provider.capabilities.telegramPremium],
            ].map(([label, enabled, supported]) => (
              <div
                key={String(label)}
                style={{
                  padding: '8px 10px',
                  background: tokens.semantic.bgSubtle,
                  border: `1px solid ${tokens.semantic.border}`,
                  borderRadius: tokens.radii.xs,
                }}
              >
                <div style={{ fontWeight: tokens.typography.weight.semibold }}>{String(label)}</div>
                <div style={{ marginTop: 3, color: tokens.semantic.inkSubtle }}>
                  {enabled && supported
                    ? 'Live'
                    : !supported
                      ? 'Provider cannot deliver'
                      : 'Switched off in settings'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </AdminCard>
    </div>
  );
}

function AdminMessage({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: tokens.colors.sand[50],
      }}
    >
      <div
        style={{
          maxWidth: 460,
          padding: 30,
          textAlign: 'center',
          background: tokens.semantic.surface,
          border: `1px solid ${tokens.semantic.border}`,
          borderRadius: tokens.radii.lg,
          boxShadow: tokens.shadows.sm,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/fundxtra-mark.png"
          alt=""
          width={40}
          height={33}
          style={{ margin: '0 auto 18px' }}
        />
        <h1 style={{ fontSize: tokens.typography.size.lg }}>{title}</h1>
        {body && (
          <p
            style={{
              marginTop: 10,
              fontSize: tokens.typography.size.base,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            {body}
          </p>
        )}
        {action && (
          <div style={{ marginTop: 22 }}>
            {action.href ? (
              <a
                href={action.href}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 38,
                  padding: '0 16px',
                  background: tokens.semantic.brand,
                  color: tokens.semantic.onBrand,
                  borderRadius: tokens.radii.sm,
                  fontSize: tokens.typography.size.sm,
                  fontWeight: tokens.typography.weight.semibold,
                }}
              >
                {action.label}
              </a>
            ) : (
              <AdminButton tone="primary" onClick={action.onClick}>
                {action.label}
              </AdminButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
