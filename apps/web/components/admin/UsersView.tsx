'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  USER_STATUS_LABELS,
  atHandle,
  formatDateTime,
  formatNaira,
  parseNairaInput,
  type User,
  type UserStatus,
  tokens,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/admin-session';
import {
  AdminButton,
  AdminCard,
  AdminField,
  Metric,
  Pill,
  Table,
  Td,
  adminInputStyle,
} from './primitives';

/**
 * User management.
 *
 * Search is exact-match on Telegram ID, username or referral code rather than
 * fuzzy: Firestore has no substring index, and a search box that silently
 * returns nothing for a partial name is worse than one that says what it
 * matches. Support tickets always carry one of those three identifiers anyway.
 */
export function UsersView() {
  const { can } = useAdmin();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (search) params.set('q', search);
      const result = await api.get<{ items: User[] }>(`/admin/users?${params.toString()}`);
      setUsers(result.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: tokens.typography.size.xl }}>Users</h1>

      <AdminCard>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(query.trim() || undefined);
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Telegram ID, @username or referral code"
            aria-label="Search users"
            style={{ ...adminInputStyle, flex: 1, minWidth: 240 }}
          />
          <AdminButton tone="primary" loading={loading}>
            Search
          </AdminButton>
          {query && (
            <AdminButton
              onClick={() => {
                setQuery('');
                void load();
              }}
            >
              Clear
            </AdminButton>
          )}
        </form>
        <p
          style={{
            marginTop: 8,
            fontSize: tokens.typography.size['2xs'],
            color: tokens.semantic.inkSubtle,
          }}
        >
          Search matches an exact Telegram ID, username or referral code. Leave it empty to
          browse the newest accounts.
        </p>
      </AdminCard>

      {error && (
        <AdminCard>
          <p style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        </AdminCard>
      )}

      {/*
        Two presentations of the same list.

        The table has nine columns, so on a phone it scrolls sideways and the
        Open button — the only way into a user's account, and therefore the only
        way to adjust a balance — sits off-screen. Below 780px each user becomes
        a card with the action in reach. Both render from the same array, so
        neither can show a different set.
      */}
      <div className="fx-users-cards">
        <AdminCard title={users ? `${String(users.length)} shown` : 'Loading…'}>
          {users !== null && users.length === 0 ? (
            <p style={{ fontSize: tokens.typography.size.sm, color: tokens.semantic.inkSubtle }}>
              No accounts match that search.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {(users ?? []).map((user) => (
                <div
                  key={user.id}
                  style={{
                    display: 'grid',
                    gap: 10,
                    padding: 12,
                    background: tokens.semantic.surface,
                    border: `1px solid ${tokens.semantic.border}`,
                    borderRadius: tokens.radii.md,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: tokens.typography.weight.semibold }}>
                        {user.firstName} {user.lastName ?? ''}
                      </div>
                      <div
                        style={{
                          fontSize: tokens.typography.size['2xs'],
                          color: tokens.semantic.inkSubtle,
                          fontFamily: tokens.typography.fontMono,
                        }}
                      >
                        {user.telegramId}
                        {user.username ? ` · ${atHandle(user.username)}` : ''}
                      </div>
                    </div>
                    <Pill
                      tone={
                        user.status === 'ACTIVE'
                          ? 'success'
                          : user.status === 'SUSPENDED'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {USER_STATUS_LABELS[user.status]}
                    </Pill>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 8,
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    <span>
                      Balance
                      <strong
                        className="fx-tabular"
                        style={{ display: 'block', fontSize: tokens.typography.size.sm, color: tokens.semantic.ink }}
                      >
                        {formatNaira(user.balanceKobo)}
                      </strong>
                    </span>
                    <span>
                      Tasks
                      <strong style={{ display: 'block', fontSize: tokens.typography.size.sm, color: tokens.semantic.ink }}>
                        {user.tasksCompleted}
                      </strong>
                    </span>
                    <span>
                      Referrals
                      <strong style={{ display: 'block', fontSize: tokens.typography.size.sm, color: tokens.semantic.ink }}>
                        {user.qualifiedReferralCount}
                      </strong>
                    </span>
                  </div>

                  <AdminButton
                    tone={selected === user.id ? 'default' : 'primary'}
                    onClick={() => setSelected(selected === user.id ? null : user.id)}
                  >
                    {selected === user.id ? 'Close account' : 'Open account'}
                  </AdminButton>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>

      <div className="fx-users-table">
        <AdminCard title={users ? `${String(users.length)} shown` : 'Loading…'} padded={false}>
          <Table
          columns={['User', 'Telegram ID', 'Status', 'Balance', 'Earned', 'Tasks', 'Referrals', 'Risk', '']}
          empty={users !== null && users.length === 0}
        >
          {(users ?? []).map((user) => (
            <tr key={user.id}>
              <Td>
                <div style={{ fontWeight: tokens.typography.weight.semibold }}>
                  {user.firstName} {user.lastName ?? ''}
                </div>
                <div
                  style={{
                    fontSize: tokens.typography.size['2xs'],
                    color: tokens.semantic.inkSubtle,
                  }}
                >
                  {user.username ? atHandle(user.username) : 'no username'} · {user.referralCode}
                </div>
              </Td>
              <Td mono nowrap>{user.telegramId}</Td>
              <Td>
                <Pill
                  tone={
                    user.status === 'ACTIVE'
                      ? 'success'
                      : user.status === 'SUSPENDED'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {USER_STATUS_LABELS[user.status]}
                </Pill>
              </Td>
              <Td align="right">{formatNaira(user.balanceKobo)}</Td>
              <Td align="right">{formatNaira(user.lifetimeEarnedKobo)}</Td>
              <Td align="right">{user.tasksCompleted}</Td>
              <Td align="right">
                {user.qualifiedReferralCount}
                {user.referralCount > user.qualifiedReferralCount && (
                  <span style={{ color: tokens.semantic.inkSubtle }}>
                    {' '}
                    / {user.referralCount}
                  </span>
                )}
              </Td>
              <Td>
                {user.flags.length > 0 ? (
                  <Pill tone={user.riskBand === 'HIGH' ? 'danger' : 'warning'}>
                    {user.riskScore}
                  </Pill>
                ) : (
                  <span style={{ color: tokens.semantic.inkFaint }}>—</span>
                )}
              </Td>
              <Td align="right">
                <AdminButton
                  size="xs"
                  onClick={() => setSelected(selected === user.id ? null : user.id)}
                >
                  {selected === user.id ? 'Close' : 'Open'}
                </AdminButton>
              </Td>
            </tr>
          ))}
          </Table>
        </AdminCard>
      </div>

      <style>{`
        .fx-users-table { display: none; }
        @media (min-width: 780px) {
          .fx-users-cards { display: none; }
          .fx-users-table { display: block; }
        }
      `}</style>

      {selected && (
        <UserDetail
          userId={selected}
          canManage={can('users:manage')}
          canAdjust={can('finance:adjust')}
          onChanged={() => void load(query.trim() || undefined)}
        />
      )}
    </div>
  );
}

interface UserDetailPayload {
  user: User;
  transactions: { items: Array<{ id: string; type: string; amountKobo: number; status: string; description: string; createdAt: string }> };
  referrals: Array<{ id: string; referredFirstName: string; status: string; rewardKobo: number }>;
  withdrawals: Array<{ id: string; amountKobo: number; status: string; requestedAt: string; bank: { bankName: string; accountNumber: string } }>;
  redemptions: Array<{ id: string; productName: string; amountKobo: number; status: string }>;
  balanceAudit: { cachedKobo: number; ledgerKobo: number; matches: boolean; entryCount: number };
}

/**
 * One account, in full.
 *
 * The balance audit is the most important thing here: it recomputes the
 * balance from the ledger and reports whether the cached figure agrees. That
 * is the tool for answering a user who says their balance is wrong — and for
 * catching a bug in our own accounting before a user does.
 */
function UserDetail({
  userId,
  canManage,
  canAdjust,
  onChanged,
}: {
  userId: string;
  canManage: boolean;
  canAdjust: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<UserDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'credit' | 'debit'>('credit');
  const [adjustReason, setAdjustReason] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<UserDetailPayload>(`/admin/users/${userId}`));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (run: () => Promise<void>, success: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await run();
        setNotice(success);
        await load();
        onChanged();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
            : errorMessage(caught),
        );
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged],
  );

  if (error && !data) {
    return (
      <AdminCard title="Account">
        <p style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
          {error}
        </p>
      </AdminCard>
    );
  }
  if (!data) return <AdminCard title="Account">Loading…</AdminCard>;

  const { user, balanceAudit } = data;
  const adjustKobo = parseNairaInput(adjustAmount);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <AdminCard
        title={`${user.firstName} ${user.lastName ?? ''} · ${user.telegramId}`}
        action={<AdminButton onClick={() => void load()}>Reload</AdminButton>}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
            gap: 10,
          }}
        >
          <Metric label="Balance" value={formatNaira(user.balanceKobo)} tone="brand" />
          <Metric label="Earned" value={formatNaira(user.lifetimeEarnedKobo)} />
          <Metric label="Paid out" value={formatNaira(user.lifetimePaidOutKobo)} />
          <Metric label="Pending out" value={formatNaira(user.pendingOutKobo)} />
        </div>

        {/* The integrity check. */}
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: balanceAudit.matches
              ? tokens.colors.success.soft
              : tokens.colors.danger.soft,
            border: `1px solid ${balanceAudit.matches ? '#cfe7d7' : '#f3d3ce'}`,
            borderRadius: tokens.radii.xs,
          }}
        >
          <div
            style={{
              fontSize: tokens.typography.size.xs,
              fontWeight: tokens.typography.weight.bold,
              color: balanceAudit.matches
                ? tokens.colors.success.strong
                : tokens.colors.danger.strong,
            }}
          >
            {balanceAudit.matches
              ? 'Ledger reconciles'
              : 'LEDGER MISMATCH — investigate before adjusting'}
          </div>
          <div
            className="fx-tabular"
            style={{
              marginTop: 4,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkMuted,
            }}
          >
            Cached {formatNaira(balanceAudit.cachedKobo)} · recomputed from{' '}
            {balanceAudit.entryCount} ledger entries {formatNaira(balanceAudit.ledgerKobo)}
          </div>
        </div>

        {user.flags.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {user.flags.map((flag) => (
              <Pill key={flag} tone={user.riskBand === 'HIGH' ? 'danger' : 'warning'}>
                {flag.replace(/_/g, ' ')}
              </Pill>
            ))}
          </div>
        )}

        {notice && (
          <p
            role="status"
            style={{
              marginTop: 12,
              fontSize: tokens.typography.size.sm,
              color: tokens.colors.success.strong,
            }}
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              fontSize: tokens.typography.size.sm,
              color: tokens.colors.danger.strong,
            }}
          >
            {error}
          </p>
        )}
      </AdminCard>

      {canManage && (
        <AdminCard title="Account actions">
          <div style={{ display: 'grid', gap: 12 }}>
            <AdminField
              label="Reason (recorded in the audit log)"
              hint="Required for a status change. Everything here is attributed to you."
            >
              <input
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                placeholder="e.g. Multiple accounts confirmed from support ticket #142"
                style={adminInputStyle}
              />
            </AdminField>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(
                [
                  ['ACTIVE', 'Reactivate', 'success'],
                  ['SUSPENDED', 'Suspend', 'default'],
                  ['BANNED', 'Ban', 'danger'],
                ] as Array<[UserStatus, string, 'success' | 'default' | 'danger']>
              )
                .filter(([status]) => status !== user.status)
                .map(([status, label, tone]) => (
                  <AdminButton
                    key={status}
                    tone={tone}
                    disabled={busy || statusReason.trim().length < 4}
                    title={
                      statusReason.trim().length < 4 ? 'Enter a reason first' : undefined
                    }
                    onClick={() =>
                      void act(
                        () =>
                          api.post(`/admin/users/${user.id}/status`, {
                            status,
                            reason: statusReason.trim(),
                          }),
                        `Account set to ${status}.`,
                      )
                    }
                  >
                    {label}
                  </AdminButton>
                ))}

              <AdminButton
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api.post(`/admin/users/${user.id}/reset-pin`),
                    'PIN reset. The user creates a new one next time they open the app.',
                  )
                }
                title="Deletes the PIN hash. Nobody learns the old PIN."
              >
                Reset PIN
              </AdminButton>
              <AdminButton
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api.post(`/admin/users/${user.id}/unlock-pin`),
                    'PIN lockout cleared.',
                  )
                }
              >
                Clear PIN lockout
              </AdminButton>
            </div>
          </div>
        </AdminCard>
      )}

      {canAdjust && (
        <AdminCard title="Add or remove balance">
          {/*
            The balance is restated here rather than only at the top of the
            page: this is where money is moved, and the figure it is being
            moved from should not require a scroll to check.
          */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 12,
              padding: '10px 12px',
              background: tokens.colors.cocoa[50],
              border: `1px solid ${tokens.colors.cocoa[200]}`,
              borderRadius: tokens.radii.sm,
            }}
          >
            <span style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.brandInk }}>
              {user.firstName}&rsquo;s balance now
            </span>
            <strong
              className="fx-tabular"
              style={{ fontSize: tokens.typography.size.lg, color: tokens.semantic.ink }}
            >
              {formatNaira(user.balanceKobo)}
            </strong>
          </div>

          <p
            style={{
              marginBottom: 12,
              fontSize: tokens.typography.size.xs,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            This creates a normal ledger entry attributed to you and writes an audit record
            before the money moves. A reason is mandatory — there are no silent financial
            changes on Fundxtra. The user is messaged on Telegram with the amount, their new
            balance and the reason you give, so write it as something they can read.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <AdminField label="Direction">
              <select
                value={adjustDirection}
                onChange={(event) =>
                  setAdjustDirection(event.target.value as 'credit' | 'debit')
                }
                style={adminInputStyle}
              >
                <option value="credit">Credit (add to balance)</option>
                <option value="debit">Debit (remove from balance)</option>
              </select>
            </AdminField>
            <AdminField label="Amount in Naira" hint={adjustKobo === null && adjustAmount ? 'Enter a valid amount' : undefined}>
              <input
                inputMode="decimal"
                value={adjustAmount}
                onChange={(event) => setAdjustAmount(event.target.value)}
                placeholder="e.g. 500"
                style={adminInputStyle}
              />
            </AdminField>
            <AdminField label="Reason" hint="At least 8 characters">
              <input
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
                placeholder="e.g. Goodwill credit after failed airtime top-up"
                style={adminInputStyle}
              />
            </AdminField>
            <AdminButton
              tone="primary"
              disabled={busy || adjustKobo === null || adjustReason.trim().length < 8}
              onClick={() =>
                void act(async () => {
                  if (adjustKobo === null) return;
                  await api.post(`/admin/users/${user.id}/adjust-balance`, {
                    amountKobo: adjustDirection === 'credit' ? adjustKobo : -adjustKobo,
                    reason: adjustReason.trim(),
                  });
                  setAdjustAmount('');
                  setAdjustReason('');
                }, 'Balance adjusted and recorded.')
              }
            >
              Apply adjustment
            </AdminButton>
          </div>
        </AdminCard>
      )}

      <AdminCard title="Transaction history" padded={false}>
        <Table
          columns={['When', 'Type', 'Description', 'Amount', 'Status']}
          empty={data.transactions.items.length === 0}
        >
          {data.transactions.items.map((transaction) => (
            <tr key={transaction.id}>
              <Td nowrap>{formatDateTime(transaction.createdAt)}</Td>
              <Td nowrap>{transaction.type.replace(/_/g, ' ').toLowerCase()}</Td>
              <Td>{transaction.description}</Td>
              <Td align="right">
                <span
                  style={{
                    fontWeight: tokens.typography.weight.semibold,
                    color:
                      transaction.amountKobo >= 0
                        ? tokens.colors.success.strong
                        : tokens.semantic.ink,
                  }}
                >
                  {formatNaira(transaction.amountKobo, { signed: transaction.amountKobo > 0 })}
                </span>
              </Td>
              <Td>
                <Pill
                  tone={
                    transaction.status === 'COMPLETED'
                      ? 'success'
                      : transaction.status === 'PENDING'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {transaction.status}
                </Pill>
              </Td>
            </tr>
          ))}
        </Table>
      </AdminCard>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
          gap: 18,
        }}
      >
        <AdminCard title="Withdrawals" padded={false}>
          <Table columns={['When', 'Amount', 'Bank', 'Status']} empty={data.withdrawals.length === 0}>
            {data.withdrawals.map((withdrawal) => (
              <tr key={withdrawal.id}>
                <Td nowrap>{formatDateTime(withdrawal.requestedAt)}</Td>
                <Td align="right">{formatNaira(withdrawal.amountKobo)}</Td>
                <Td>{withdrawal.bank.bankName}</Td>
                <Td>
                  <Pill tone={withdrawal.status === 'COMPLETED' ? 'success' : 'warning'}>
                    {withdrawal.status}
                  </Pill>
                </Td>
              </tr>
            ))}
          </Table>
        </AdminCard>

        <AdminCard title="Referrals" padded={false}>
          <Table columns={['Referred', 'Status', 'Reward']} empty={data.referrals.length === 0}>
            {data.referrals.map((referral) => (
              <tr key={referral.id}>
                <Td>{referral.referredFirstName}</Td>
                <Td>
                  <Pill tone={referral.status === 'QUALIFIED' ? 'success' : 'warning'}>
                    {referral.status}
                  </Pill>
                </Td>
                <Td align="right">{formatNaira(referral.rewardKobo)}</Td>
              </tr>
            ))}
          </Table>
        </AdminCard>
      </div>
    </div>
  );
}
