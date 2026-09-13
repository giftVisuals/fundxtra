'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  SUBMISSION_STATUS_LABELS,
  atHandle,
  formatDateTime,
  formatNaira,
  relativeTime,
  tokens,
  type SubmissionStatus,
  type TaskSubmission,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { ProofImage } from './ProofImage';
import { AdminButton, AdminCard, AdminField, Pill, adminInputStyle } from './primitives';

interface SubmissionWithProof extends TaskSubmission {
  proofUrl: string | null;
}

/**
 * Screenshot review queue.
 *
 * The operationally most important admin screen, because a user has already
 * done the work and is waiting. Designed for throughput: the screenshot is
 * large, approve is one click, and reject demands a reason the user will
 * actually read.
 *
 * A rejection reason is mandatory. "Rejected" with no explanation is how a
 * rewards platform loses the benefit of the doubt, and the reason is shown
 * verbatim on the user's task card.
 */
export function SubmissionsView() {
  const [status, setStatus] = useState<SubmissionStatus>('PENDING_REVIEW');
  const [items, setItems] = useState<SubmissionWithProof[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<{ items: SubmissionWithProof[] }>(
        `/admin/submissions?status=${status}&limit=25`,
      );
      setItems(result.items);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = useCallback(
    async (submission: SubmissionWithProof, decision: 'APPROVE' | 'REJECT') => {
      const reason = reasons[submission.id]?.trim() ?? '';
      if (decision === 'REJECT' && reason.length < 4) {
        setError('A rejection needs a reason the user can read.');
        return;
      }

      setBusyId(submission.id);
      setError(null);
      setNotice(null);
      try {
        await api.post(`/admin/submissions/${submission.id}/review`, {
          decision,
          ...(reason ? { reason } : {}),
        });
        setNotice(
          decision === 'APPROVE'
            ? `Approved. ${formatNaira(submission.rewardKobo)} credited to ${submission.username ? atHandle(submission.username) : submission.userTelegramId}.`
            : 'Rejected. The campaign budget has been released.',
        );
        await load();
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
    [reasons, load],
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>Review queue</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as SubmissionStatus[]).map((entry) => (
            <AdminButton
              key={entry}
              tone={status === entry ? 'primary' : 'default'}
              onClick={() => setStatus(entry)}
            >
              {SUBMISSION_STATUS_LABELS[entry]}
            </AdminButton>
          ))}
          <AdminButton onClick={() => void load()}>Refresh</AdminButton>
        </div>
      </div>

      {notice && (
        <AdminCard>
          <p
            role="status"
            style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.success.strong }}
          >
            {notice}
          </p>
        </AdminCard>
      )}
      {error && (
        <AdminCard>
          <p
            role="alert"
            style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}
          >
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
            {status === 'PENDING_REVIEW'
              ? 'Nothing waiting. Every submission has been reviewed.'
              : 'No submissions with that status.'}
          </p>
        </AdminCard>
      )}

      {(items ?? []).map((submission) => (
        <AdminCard
          key={submission.id}
          title={submission.taskTitle}
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Pill
                tone={
                  submission.status === 'PENDING_REVIEW'
                    ? 'warning'
                    : submission.status === 'APPROVED'
                      ? 'success'
                      : 'danger'
                }
              >
                {SUBMISSION_STATUS_LABELS[submission.status]}
              </Pill>
              <span
                className="fx-tabular"
                style={{
                  fontSize: tokens.typography.size.sm,
                  fontWeight: tokens.typography.weight.bold,
                  color: tokens.semantic.brandInk,
                }}
              >
                {formatNaira(submission.rewardKobo)}
              </span>
            </div>
          }
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
              gap: 16,
            }}
          >
            {/* The proof. Large, because squinting at a thumbnail is how a
                reviewer approves something they did not actually check. */}
            <div>
              {submission.proofUrl ? (
                <ProofImage
                  submissionId={submission.id}
                  alt={`Proof submitted for ${submission.taskTitle}`}
                />
              ) : submission.answer ? (
                <div
                  style={{
                    padding: 14,
                    background: tokens.semantic.bgSubtle,
                    border: `1px solid ${tokens.semantic.border}`,
                    borderRadius: tokens.radii.xs,
                  }}
                >
                  <div
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      fontWeight: tokens.typography.weight.bold,
                      letterSpacing: tokens.typography.tracking.wider,
                      textTransform: 'uppercase',
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    Submitted answer
                  </div>
                  <p
                    style={{
                      marginTop: 6,
                      fontFamily: tokens.typography.fontMono,
                      fontSize: tokens.typography.size.sm,
                      lineHeight: tokens.typography.leading.relaxed,
                      wordBreak: 'break-word',
                    }}
                  >
                    {submission.answer}
                  </p>
                </div>
              ) : submission.proofPath ? (
                /*
                  A proof exists but its signed URL could not be generated.
                  This must NOT read as "no proof was attached" — an admin
                  would reject a valid submission on the strength of that.
                */
                <div
                  style={{
                    padding: 14,
                    background: tokens.colors.warning.soft,
                    border: '1px solid #f0dcb8',
                    borderRadius: tokens.radii.xs,
                  }}
                >
                  <p
                    style={{
                      fontSize: tokens.typography.size.sm,
                      fontWeight: tokens.typography.weight.semibold,
                      color: tokens.colors.warning.strong,
                    }}
                  >
                    A screenshot was uploaded but could not be displayed
                  </p>
                  <p
                    style={{
                      marginTop: 6,
                      fontSize: tokens.typography.size.xs,
                      lineHeight: tokens.typography.leading.relaxed,
                      color: tokens.colors.warning.strong,
                    }}
                  >
                    The file is stored, but a viewing link could not be created — usually a
                    storage permission problem. Do not reject this submission on that basis.
                    Refresh, and if it persists check the service account&apos;s access to the
                    storage bucket.
                  </p>
                  <p
                    style={{
                      marginTop: 8,
                      fontFamily: tokens.typography.fontMono,
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                      wordBreak: 'break-all',
                    }}
                  >
                    {submission.proofPath}
                  </p>
                </div>
              ) : (
                <p
                  style={{
                    padding: 14,
                    fontSize: tokens.typography.size.sm,
                    color: tokens.semantic.inkSubtle,
                    background: tokens.semantic.bgSubtle,
                    borderRadius: tokens.radii.xs,
                  }}
                >
                  No proof was attached to this submission.
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <dl style={{ margin: 0, display: 'grid', gap: 7, fontSize: tokens.typography.size.sm }}>
                <DetailRow label="User">
                  {submission.username ? atHandle(submission.username) : '—'}{' '}
                  <span style={{ color: tokens.semantic.inkSubtle }}>
                    ({submission.userTelegramId})
                  </span>
                </DetailRow>
                <DetailRow label="Submitted">
                  {formatDateTime(submission.submittedAt)}{' '}
                  <span style={{ color: tokens.semantic.inkSubtle }}>
                    ({relativeTime(submission.submittedAt)})
                  </span>
                </DetailRow>
                <DetailRow label="Reward">{formatNaira(submission.rewardKobo)}</DetailRow>
                {submission.reviewedBy && (
                  <DetailRow label="Reviewed by">
                    {submission.reviewedBy} · {formatDateTime(submission.reviewedAt)}
                  </DetailRow>
                )}
                {submission.rejectionReason && (
                  <DetailRow label="Rejection reason">{submission.rejectionReason}</DetailRow>
                )}
              </dl>

              {submission.status === 'PENDING_REVIEW' && (
                <>
                  <AdminField
                    label="Rejection reason"
                    hint="Shown to the user on their task card. Required to reject, ignored on approve."
                  >
                    <input
                      value={reasons[submission.id] ?? ''}
                      onChange={(event) =>
                        setReasons((current) => ({
                          ...current,
                          [submission.id]: event.target.value,
                        }))
                      }
                      placeholder="e.g. The screenshot shows a different channel"
                      style={adminInputStyle}
                    />
                  </AdminField>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <AdminButton
                      tone="success"
                      loading={busyId === submission.id}
                      disabled={busyId !== null}
                      onClick={() => void review(submission, 'APPROVE')}
                    >
                      Approve and credit {formatNaira(submission.rewardKobo)}
                    </AdminButton>
                    <AdminButton
                      tone="danger"
                      disabled={busyId !== null || (reasons[submission.id]?.trim().length ?? 0) < 4}
                      title={
                        (reasons[submission.id]?.trim().length ?? 0) < 4
                          ? 'Enter a reason first'
                          : undefined
                      }
                      onClick={() => void review(submission, 'REJECT')}
                    >
                      Reject
                    </AdminButton>
                  </div>
                </>
              )}
            </div>
          </div>
        </AdminCard>
      ))}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <dt
        style={{
          minWidth: 110,
          fontSize: tokens.typography.size['2xs'],
          fontWeight: tokens.typography.weight.bold,
          letterSpacing: tokens.typography.tracking.wider,
          textTransform: 'uppercase',
          color: tokens.semantic.inkSubtle,
          paddingTop: 2,
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{children}</dd>
    </div>
  );
}
