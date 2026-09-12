'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS, formatDateTime, tokens, type AuditLog, type SecurityEvent } from '@fundxtra/shared';
import { api, errorMessage } from '@/lib/api';
import { AdminButton, AdminCard, Pill, Table, Td, adminInputStyle } from './primitives';

/**
 * Audit log and security events.
 *
 * Two separate records because they answer different questions. The audit log
 * answers "who changed this, and why" — it is append-only, attributed, and for
 * financial actions the write is a precondition of the change. Security events
 * answer "what is happening to accounts" — failed PINs, blocked self-referrals,
 * rate limits — and are best-effort, because a logging failure must never turn
 * a rejected login into a successful one.
 */
export function AuditView() {
  const [tab, setTab] = useState<'audit' | 'security'>('audit');
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      if (tab === 'audit') {
        const params = new URLSearchParams({ limit: '60' });
        if (target.trim()) params.set('targetId', target.trim());
        const result = await api.get<{ items: AuditLog[] }>(`/admin/audit?${params.toString()}`);
        setLogs(result.items);
      } else {
        const params = new URLSearchParams({ limit: '60' });
        if (target.trim()) params.set('userId', target.trim());
        const result = await api.get<{ events: SecurityEvent[] }>(
          `/admin/security-events?${params.toString()}`,
        );
        setEvents(result.events);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [tab, target]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>
          {tab === 'audit' ? 'Audit log' : 'Security events'}
        </h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <AdminButton tone={tab === 'audit' ? 'primary' : 'default'} onClick={() => setTab('audit')}>
            Admin actions
          </AdminButton>
          <AdminButton
            tone={tab === 'security' ? 'primary' : 'default'}
            onClick={() => setTab('security')}
          >
            Security events
          </AdminButton>
        </div>
      </div>

      <AdminCard>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder={
              tab === 'audit'
                ? 'Filter by target ID (a user, task or withdrawal)'
                : 'Filter by user ID'
            }
            style={{ ...adminInputStyle, flex: 1, minWidth: 240 }}
          />
          <AdminButton tone="primary">Filter</AdminButton>
          {target && (
            <AdminButton
              onClick={() => {
                setTarget('');
              }}
            >
              Clear
            </AdminButton>
          )}
        </form>
      </AdminCard>

      {error && (
        <AdminCard>
          <p role="alert" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        </AdminCard>
      )}

      {tab === 'audit' ? (
        <AdminCard padded={false}>
          <Table
            columns={['When', 'Action', 'Actor', 'Target', 'Summary', 'Reason']}
            empty={logs !== null && logs.length === 0}
          >
            {(logs ?? []).map((log) => (
              <tr key={log.id}>
                <Td nowrap>{formatDateTime(log.createdAt)}</Td>
                <Td nowrap>
                  <Pill
                    tone={
                      log.action.includes('BALANCE') || log.action.includes('WITHDRAWAL')
                        ? 'brand'
                        : log.action.includes('BANNED') || log.action.includes('REMOVED')
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {log.action.replace(/_/g, ' ')}
                  </Pill>
                </Td>
                <Td nowrap>
                  <div>{log.actorUsername ? `@${log.actorUsername}` : log.actorId}</div>
                  <div
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    {ROLE_LABELS[log.actorRole]}
                  </div>
                </Td>
                <Td mono nowrap>
                  <div style={{ fontSize: tokens.typography.size['2xs'] }}>{log.targetType}</div>
                  {log.targetId}
                </Td>
                <Td>{log.summary}</Td>
                <Td>
                  {log.reason ? (
                    <span style={{ color: tokens.semantic.inkMuted }}>{log.reason}</span>
                  ) : (
                    <span style={{ color: tokens.semantic.inkFaint }}>—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </AdminCard>
      ) : (
        <AdminCard padded={false}>
          <Table
            columns={['When', 'Type', 'Severity', 'User', 'Message', 'IP']}
            empty={events !== null && events.length === 0}
          >
            {(events ?? []).map((event) => (
              <tr key={event.id}>
                <Td nowrap>{formatDateTime(event.createdAt)}</Td>
                <Td nowrap>{event.type.replace(/_/g, ' ').toLowerCase()}</Td>
                <Td>
                  <Pill
                    tone={
                      event.severity === 'CRITICAL'
                        ? 'danger'
                        : event.severity === 'WARN'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {event.severity}
                  </Pill>
                </Td>
                <Td mono nowrap>{event.userId ?? '—'}</Td>
                <Td>{event.message}</Td>
                <Td mono nowrap>{event.ip ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </AdminCard>
      )}
    </div>
  );
}
