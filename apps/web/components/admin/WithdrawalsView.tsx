'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  WITHDRAWAL_STATUS_LABELS,
  atHandle,
  formatDateTime,
  formatNaira,
  tokens,
  type Withdrawal,
  type WithdrawalStatus,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/admin-session';
import { AdminButton, AdminCard, AdminField, Pill, Table, Td, adminInputStyle } from './primitives';

/**
 * Withdrawal processing.
 *
 * No payout provider is wired in yet, so this is the operational workflow it
 * would be on day one anyway: an operator sees the request and the full bank
 * details, makes the transfer, and records the bank's own reference against
 * it. When a provider is chosen, the COMPLETE step becomes automatic and
 * nothing else about this screen changes.
 *
 * Account numbers are shown unmasked *here specifically*, because an operator
 * making the transfer needs to read them. They are masked everywhere else.
 */
export function WithdrawalsView() {
  const { can, refresh: refreshDashboard } = useAdmin();
  const [status, setStatus] = useState<WithdrawalStatus | 'ALL'>('PENDING');
  const [items, setItems] = useState<Withdrawal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, { reason: string; reference: string }>>({});

  const canProcess = can('withdrawals:process');

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (status !== 'ALL') params.set('status', status);
      const result = await api.get<{ items: Withdrawal[] }>(
        `/admin/withdrawals?${params.toString()}`,
      );
      setItems(result.items);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (withdrawal: Withdrawal, decision: 'APPROVE' | 'REJECT' | 'COMPLETE' | 'FAIL') => {
      const entry = inputs[withdrawal.id] ?? { reason: '', reference: '' };
      if ((decision === 'REJECT' || decision === 'FAIL') && entry.reason.trim().length < 4) {
        setError('A rejection or failure needs a reason. It is shown to the user.');
        return;
      }

      setBusyId(withdrawal.id);
      setError(null);
      setNotice(null);
      try {
        await api.post(`/admin/withdrawals/${withdrawal.id}/decision`, {
          decision,
          ...(entry.reason.trim() ? { reason: entry.reason.trim() } : {}),
          ...(entry.reference.trim() ? { providerReference: entry.reference.trim() } : {}),
        });
        setNotice(
          decision === 'COMPLETE'
            ? `Marked paid. ${formatNaira(withdrawal.amountKobo)} recorded as settled.`
            : decision === 'APPROVE'
              ? 'Moved to processing.'
              : `Reversed. ${formatNaira(withdrawal.amountKobo)} returned to the user's balance.`,
        );
        await load();
        await refreshDashboard();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? (Object.values(caught.fields ?? {})[0] ?? caught.message)
            : errorMessage(caught),
        );
      } finally {
        setBusyId(null);
      }
    },
    [inputs, load, refreshDashboard],
  );

  const patch = (id: string, field: 'reason' | 'reference', value: string) =>
    setInputs((current) => ({
      ...current,
      [id]: { reason: '', reference: '', ...current[id], [field]: value },
    }));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>Withdrawals</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'ALL'] as const).map((entry) => (
            <AdminButton
              key={entry}
              tone={status === entry ? 'primary' : 'default'}
              onClick={() => setStatus(entry)}
            >
              {entry === 'ALL' ? 'All' : WITHDRAWAL_STATUS_LABELS[entry]}
            </AdminButton>
          ))}
        </div>
      </div>

      {!canProcess && (
        <AdminCard>
          <p style={{ fontSize: tokens.typography.size.sm, color: tokens.semantic.inkMuted }}>
            You can view withdrawals but not process them. Ask a super admin for the
            withdrawals:process permission.
          </p>
        </AdminCard>
      )}

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

      {items === null && <AdminCard>Loading…</AdminCard>}

      {items !== null && items.length === 0 && (
        <AdminCard>
          <p
            style={{
              padding: '28px 0',
              textAlign: 'center',
              fontSize: tokens.typography.size.sm,
              color: tokens.semantic.inkSubtle,
            }}
          >
            No withdrawals with that status.
          </p>
        </AdminCard>
      )}

      {(items ?? []).length > 0 && (
        <AdminCard padded={false}>
          <Table
            columns={['Requested', 'User', 'Amount', 'Bank details', 'Status', 'Actions']}
          >
            {(items ?? []).map((withdrawal) => {
              const entry = inputs[withdrawal.id] ?? { reason: '', reference: '' };
              const open = withdrawal.status === 'PENDING' || withdrawal.status === 'PROCESSING';

              return (
                <tr key={withdrawal.id}>
                  <Td nowrap>{formatDateTime(withdrawal.requestedAt)}</Td>
                  <Td nowrap>
                    <div>{withdrawal.username ? atHandle(withdrawal.username) : '—'}</div>
                    <div
                      style={{
                        fontSize: tokens.typography.size['2xs'],
                        color: tokens.semantic.inkSubtle,
                      }}
                    >
                      {withdrawal.userTelegramId}
                    </div>
                  </Td>
                  <Td align="right" nowrap>
                    <div style={{ fontWeight: tokens.typography.weight.semibold }}>
                      {formatNaira(withdrawal.amountKobo)}
                    </div>
                    {withdrawal.feeKobo > 0 && (
                      <div
                        style={{
                          fontSize: tokens.typography.size['2xs'],
                          color: tokens.semantic.inkSubtle,
                        }}
                      >
                        net {formatNaira(withdrawal.netKobo)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div style={{ fontWeight: tokens.typography.weight.medium }}>
                      {withdrawal.bank.accountName}
                    </div>
                    <div
                      style={{
                        fontFamily: tokens.typography.fontMono,
                        fontSize: tokens.typography.size.xs,
                      }}
                    >
                      {/* Unmasked here so the operator can make the transfer. */}
                      {withdrawal.bank.accountNumber}
                    </div>
                    <div
                      style={{
                        fontSize: tokens.typography.size['2xs'],
                        color: tokens.semantic.inkSubtle,
                      }}
                    >
                      {withdrawal.bank.bankName}
                    </div>
                  </Td>
                  <Td>
                    <Pill
                      tone={
                        withdrawal.status === 'COMPLETED'
                          ? 'success'
                          : withdrawal.status === 'PENDING' || withdrawal.status === 'PROCESSING'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {WITHDRAWAL_STATUS_LABELS[withdrawal.status]}
                    </Pill>
                    {withdrawal.providerReference && (
                      <div
                        style={{
                          marginTop: 4,
                          fontFamily: tokens.typography.fontMono,
                          fontSize: tokens.typography.size['2xs'],
                          color: tokens.semantic.inkSubtle,
                        }}
                      >
                        {withdrawal.providerReference}
                      </div>
                    )}
                    {withdrawal.failureReason && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: tokens.typography.size['2xs'],
                          color: tokens.colors.danger.strong,
                        }}
                      >
                        {withdrawal.failureReason}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {canProcess && open ? (
                      <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                        <AdminField label="Bank reference">
                          <input
                            value={entry.reference}
                            onChange={(event) => patch(withdrawal.id, 'reference', event.target.value)}
                            placeholder="NIBSS / session ID"
                            style={{ ...adminInputStyle, minHeight: 30 }}
                          />
                        </AdminField>
                        <AdminField label="Reason (to reject or fail)">
                          <input
                            value={entry.reason}
                            onChange={(event) => patch(withdrawal.id, 'reason', event.target.value)}
                            placeholder="Shown to the user"
                            style={{ ...adminInputStyle, minHeight: 30 }}
                          />
                        </AdminField>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {withdrawal.status === 'PENDING' && (
                            <AdminButton
                              size="xs"
                              disabled={busyId !== null}
                              onClick={() => void decide(withdrawal, 'APPROVE')}
                            >
                              Processing
                            </AdminButton>
                          )}
                          <AdminButton
                            size="xs"
                            tone="success"
                            loading={busyId === withdrawal.id}
                            disabled={busyId !== null}
                            onClick={() => void decide(withdrawal, 'COMPLETE')}
                          >
                            Mark paid
                          </AdminButton>
                          <AdminButton
                            size="xs"
                            tone="danger"
                            disabled={busyId !== null || entry.reason.trim().length < 4}
                            onClick={() =>
                              void decide(
                                withdrawal,
                                withdrawal.status === 'PENDING' ? 'REJECT' : 'FAIL',
                              )
                            }
                          >
                            {withdrawal.status === 'PENDING' ? 'Reject' : 'Failed'}
                          </AdminButton>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: tokens.semantic.inkFaint }}>—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </AdminCard>
      )}

      <AdminCard title="How settlement works today">
        <p
          style={{
            fontSize: tokens.typography.size.sm,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          The user&apos;s balance was already debited when they requested the withdrawal, so a
          pending request is money the platform owes. Make the bank transfer, then record the
          bank&apos;s reference and mark it paid. Rejecting or failing a request posts a
          compensating entry that returns the amount to the user&apos;s balance — both entries
          stay on the ledger.
        </p>
      </AdminCard>
    </div>
  );
}
