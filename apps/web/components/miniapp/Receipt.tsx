'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  TRANSACTION_LABELS,
  formatNaira,
  nairaInWords,
  tokens,
  type TransactionReceipt,
} from '@fundxtra/shared';
import { Button } from '@/components/ui';
import { haptic } from '@/lib/telegram';
import {
  canShareImages,
  renderReceiptPng,
  shareReceipt,
  type ReceiptImageInput,
  type ReceiptSection,
} from '@/lib/receipt-image';
import { Logo } from '@/components/ui/Logo';
import { config } from '@/lib/config';

/**
 * A receipt for one transaction.
 *
 * One component for every transaction type, shaped by what the entry is: a
 * withdrawal prints a beneficiary and a net amount, a reward prints a type and
 * a balance after. Two components would drift the first time one of them
 * gained a field.
 *
 * Every value comes from the server's receipt payload. Nothing is computed
 * here that the ledger could disagree with — a receipt that does its own
 * arithmetic is a receipt that can contradict the wallet beside it.
 */

function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface Tone {
  label: string;
  tone: 'pending' | 'good' | 'bad';
  fill: string;
  border: string;
  text: string;
}

/**
 * What the status says, and how it looks.
 *
 * A withdrawal's own status wins when there is one: the ledger entry stays
 * COMPLETED once the debit is posted, while the payout itself may still be
 * waiting for an admin. Printing "completed" on a payout nobody has approved
 * yet would be the receipt telling a lie the wallet does not.
 */
function toneFor(receipt: TransactionReceipt): Tone {
  const pending: Tone = {
    label: 'Queued for review',
    tone: 'pending',
    fill: tokens.colors.warning.soft,
    border: '#f0dcb8',
    text: tokens.colors.warning.strong,
  };
  const good: Tone = {
    label: 'Completed',
    tone: 'good',
    fill: tokens.colors.success.soft,
    border: '#c9e6d3',
    text: tokens.colors.success.strong,
  };
  const bad: Tone = {
    label: 'Reversed',
    tone: 'bad',
    fill: tokens.colors.danger.soft,
    border: '#f3d3ce',
    text: tokens.colors.danger.strong,
  };

  if (receipt.withdrawal) {
    switch (receipt.withdrawal.status) {
      case 'COMPLETED':
        return { ...good, label: 'Paid' };
      case 'REJECTED':
        return { ...bad, label: 'Rejected' };
      case 'FAILED':
        return { ...bad, label: 'Failed' };
      case 'CANCELLED':
        return { ...bad, label: 'Cancelled' };
      case 'PROCESSING':
        return { ...pending, label: 'Processing' };
      default:
        return pending;
    }
  }

  if (receipt.transaction.status === 'REVERSED') return bad;
  if (receipt.transaction.status === 'FAILED') return { ...bad, label: 'Failed' };
  if (receipt.transaction.status === 'PENDING') return { ...pending, label: 'Pending' };
  return good;
}

interface RenderState {
  /** The input this result was painted from, so a stale one can be ignored. */
  input: ReceiptImageInput;
  blob: Blob | null;
  failed: boolean;
}

/** The share capability never changes, so there is nothing to subscribe to. */
const subscribeNever = () => () => {
  /* no updates */
};

export function Receipt({ receipt }: { receipt: TransactionReceipt }) {
  const [note, setNote] = useState<string | null>(null);

  const { transaction, withdrawal } = receipt;
  // Memoised, not just computed: it feeds the input the receipt image is
  // painted from, and a fresh object every render would restart that render
  // every render.
  const status = useMemo(() => toneFor(receipt), [receipt]);
  const credit = transaction.direction === 'CREDIT';

  const sections = useMemo<ReceiptSection[]>(() => {
    const built: ReceiptSection[] = [];

    if (withdrawal) {
      built.push({
        title: 'Beneficiary',
        lines: [
          { label: 'Account name', value: withdrawal.accountName || '—' },
          { label: 'Bank', value: withdrawal.bankName },
          { label: 'Account number', value: withdrawal.accountNumber || '—', mono: true },
        ],
      });
      built.push({
        title: 'Amounts',
        lines: [
          { label: 'Amount requested', value: formatNaira(withdrawal.amountKobo) },
          { label: 'Fee', value: formatNaira(withdrawal.feeKobo) },
          { label: 'Net to account', value: formatNaira(withdrawal.netKobo) },
          { label: 'Wallet balance after', value: formatNaira(transaction.balanceAfterKobo) },
        ],
      });
    } else {
      built.push({
        title: 'Detail',
        lines: [
          { label: 'Type', value: TRANSACTION_LABELS[transaction.type] },
          { label: 'Description', value: transaction.description },
          { label: 'Balance after', value: formatNaira(transaction.balanceAfterKobo) },
        ],
      });
    }

    const trace: ReceiptSection = {
      title: 'Trace',
      lines: [
        { label: 'Reference', value: withdrawal ? withdrawal.id : transaction.id, mono: true },
      ],
    };
    if (withdrawal) {
      trace.lines.push({ label: 'Ledger entry', value: transaction.id, mono: true });
    }
    trace.lines.push({ label: 'Date & time', value: formatMoment(transaction.createdAt) });
    if (withdrawal) {
      trace.lines.push({
        label: 'Reviewed',
        value: withdrawal.reviewedAt ? formatMoment(withdrawal.reviewedAt) : 'Pending',
      });
    }
    if (withdrawal?.failureReason) {
      trace.lines.push({ label: 'Reason', value: withdrawal.failureReason });
    }
    built.push(trace);

    return built;
  }, [withdrawal, transaction]);

  /*
    The image is painted as soon as the receipt is on screen, not when the
    button is tapped. iOS only allows the share sheet to open while the tap
    that asked for it is still live, and that permission expires across an
    await — so rendering first is what makes the sheet actually appear rather
    than the tap silently doing nothing. It also means the button is instant.
  */
  const [render, setRender] = useState<RenderState | null>(null);

  /*
    Whether this browser can put a *file* into a share sheet is a browser
    answer, and reading it during render would disagree with the server-rendered
    HTML. useSyncExternalStore is how React asks that question safely: the
    server says no, the client re-reads after hydration, and no effect has to
    push it into state.
  */
  const canShare = useSyncExternalStore(subscribeNever, canShareImages, () => false);

  const reference = withdrawal ? withdrawal.id : transaction.id;

  const imageInput = useMemo(
    () => ({
      kind: withdrawal ? 'Withdrawal receipt' : 'Transaction receipt',
      statusLabel: status.label,
      statusTone: status.tone,
      amountKobo: withdrawal ? withdrawal.amountKobo : Math.abs(transaction.amountKobo),
      ...(credit ? { amountPrefix: '+' } : {}),
      amountInWords: nairaInWords(
        withdrawal ? withdrawal.amountKobo : Math.abs(transaction.amountKobo),
      ),
      sections,
      footer: `Electronic receipt — no signature required. Quote the reference to ${receipt.supportHandle} if anything looks wrong.`,
      source: RECEIPT_SOURCE,
      issuedAt: formatMoment(receipt.issuedAt),
    }),
    [withdrawal, transaction, status, credit, sections, receipt],
  );

  useEffect(() => {
    let abandoned = false;

    renderReceiptPng(imageInput)
      .then((blob) => {
        if (!abandoned) setRender({ input: imageInput, blob, failed: false });
      })
      .catch(() => {
        if (!abandoned) setRender({ input: imageInput, blob: null, failed: true });
      });

    return () => {
      abandoned = true;
    };
  }, [imageInput]);

  /*
    Read back through the input it was painted from, rather than cleared by the
    effect when the receipt changes. Clearing would mean writing state during
    an effect, and it would also leave a window where the stale image is still
    on offer — this way a result that does not belong to the receipt on screen
    simply does not count as one.
  */
  const current = render?.input === imageInput ? render : null;
  const image = current?.blob ?? null;
  const imageFailed = current?.failed ?? false;

  const share = useCallback(() => {
    if (!image) return;
    setNote(null);

    void shareReceipt(
      image,
      `fundxtra-receipt-${reference}.png`,
      `${withdrawal ? 'Withdrawal' : 'Transaction'} receipt — ${RECEIPT_SOURCE}`,
    ).then((route) => {
      if (route === 'cancelled') return;
      if (route === 'unavailable') {
        haptic.error();
        setNote('Your browser blocked it. A screenshot works just as well.');
        return;
      }
      haptic.success();
      // Says what actually happened. The old version claimed a download every
      // time, including inside Telegram, where no download ever started.
      setNote(
        route === 'shared'
          ? 'Shared. Choose “Save image” in the sheet to keep a copy.'
          : 'Opened in a new tab — long-press the image to save it.',
      );
    });
  }, [image, reference, withdrawal]);

  const amountKobo = withdrawal ? withdrawal.amountKobo : Math.abs(transaction.amountKobo);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="fx-receipt" style={receiptStyle}>
        <div style={headStyle}>
          <div style={brandRowStyle}>
            <span style={glyphStyle}>
              <Logo size={16} />
            </span>
            <span style={{ fontSize: tokens.typography.size.base, fontWeight: tokens.typography.weight.bold, color: tokens.semantic.brandInk }}>
              Fundxtra
            </span>
          </div>

          <div style={kindStyle}>
            {withdrawal ? 'Withdrawal receipt' : 'Transaction receipt'}
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              borderRadius: tokens.radii.pill,
              background: status.fill,
              border: `1px solid ${status.border}`,
              color: status.text,
              fontSize: tokens.typography.size.xs,
              fontWeight: tokens.typography.weight.bold,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {status.tone === 'good' ? (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            ) : (
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            )}
            {status.label}
          </div>

          <div style={{ display: 'grid', gap: 3, justifyItems: 'center' }}>
            <div
              className="fx-tabular"
              style={{
                fontSize: 32,
                fontWeight: tokens.typography.weight.bold,
                letterSpacing: '-0.03em',
                color: credit ? tokens.colors.success.strong : tokens.semantic.ink,
              }}
            >
              {credit ? '+' : ''}{formatNaira(amountKobo)}
            </div>
            <div style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle, textAlign: 'center' }}>
              {nairaInWords(amountKobo)}
            </div>
          </div>
        </div>

        <div style={{ padding: '4px 18px 0' }}>
          {sections.map((section) => (
            <section key={section.title} style={sectionStyle}>
              <h4 style={sectionTitleStyle}>{section.title}</h4>
              <dl style={{ margin: 0 }}>
                {section.lines.map((line) => (
                  <div key={line.label} style={rowStyle}>
                    <dt style={{ color: tokens.semantic.inkSubtle, flex: 'none' }}>{line.label}</dt>
                    <dd
                      className={line.mono ? undefined : 'fx-tabular'}
                      style={{
                        margin: 0,
                        textAlign: 'right',
                        fontWeight: tokens.typography.weight.semibold,
                        overflowWrap: 'anywhere',
                        ...(line.mono
                          ? {
                              fontFamily: tokens.typography.fontMono,
                              fontSize: tokens.typography.size.xs,
                            }
                          : {}),
                      }}
                    >
                      {line.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          {/* Repeated microtext, the way a printed slip carries it. */}
          <div aria-hidden="true" style={microStyle}>
            {'FUNDXTRA · ELECTRONIC RECEIPT · '.repeat(12)}
          </div>
        </div>

        <div style={footStyle}>
          <p style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle, lineHeight: tokens.typography.leading.relaxed, maxWidth: '34ch' }}>
            Electronic receipt — no signature required. Quote the reference to{' '}
            {receipt.supportHandle} if anything looks wrong.
          </p>
          {/* Where the receipt came from, so it stands on its own once shared. */}
          <p style={sourceStyle}>{RECEIPT_SOURCE}</p>
        </div>
      </div>

      <Button
        variant="secondary"
        fullWidth
        onClick={share}
        loading={!image && !imageFailed}
        disabled={imageFailed}
      >
        {imageFailed
          ? 'Screenshot works just as well'
          : !image
            ? 'Preparing receipt'
            : canShare
              ? 'Share receipt'
              : 'Open receipt image'}
      </Button>

      {note && (
        <p
          role="status"
          style={{
            textAlign: 'center',
            fontSize: tokens.typography.size.xs,
            color: tokens.semantic.inkMuted,
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * Where the receipt came from.
 *
 * A shared receipt outlives the app it was made in: it gets forwarded, saved
 * to a gallery, sent to somebody who has never heard of Fundxtra. Without this
 * it is an image of some numbers. With it, whoever is holding it can get to the
 * bot and check.
 */
const RECEIPT_SOURCE = `${config.siteUrl.replace(/^https?:\/\//, '')} · @${config.botUsername}`;

const sourceStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: tokens.typography.size['2xs'],
  fontWeight: tokens.typography.weight.semibold,
  letterSpacing: '0.04em',
  color: tokens.semantic.brandInk,
};

const receiptStyle: React.CSSProperties = {
  background: tokens.semantic.surface,
  border: `1px solid ${tokens.semantic.border}`,
  borderRadius: `${tokens.radii.xl} ${tokens.radii.xl} 0 0`,
  boxShadow: tokens.shadows.lg,
  overflow: 'hidden',
  paddingBottom: 9,
};

const headStyle: React.CSSProperties = {
  padding: '18px 18px 15px',
  background: `linear-gradient(180deg, ${tokens.colors.cocoa[50]}, ${tokens.semantic.surface})`,
  borderBottom: `1px solid ${tokens.semantic.divider}`,
  display: 'grid',
  gap: 12,
  justifyItems: 'center',
};

const brandRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
};

const glyphStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 26,
  height: 26,
  borderRadius: 8,
  background: tokens.semantic.brand,
  color: '#fff',
};

const kindStyle: React.CSSProperties = {
  fontSize: tokens.typography.size['2xs'],
  fontWeight: tokens.typography.weight.bold,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: tokens.semantic.inkSubtle,
};

const sectionStyle: React.CSSProperties = {
  padding: '11px 0 12px',
  borderBottom: `1px dashed ${tokens.semantic.border}`,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: tokens.typography.weight.bold,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: tokens.semantic.inkFaint,
  marginBottom: 6,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 14,
  padding: '3.5px 0',
  fontSize: tokens.typography.size.sm,
};

const microStyle: React.CSSProperties = {
  margin: '0 -18px',
  padding: '7px 0',
  background: tokens.semantic.bgSubtle,
  borderTop: `1px solid ${tokens.semantic.divider}`,
  borderBottom: `1px solid ${tokens.semantic.divider}`,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  fontSize: 6.5,
  fontWeight: tokens.typography.weight.bold,
  letterSpacing: '0.32em',
  textTransform: 'uppercase',
  color: tokens.semantic.inkFaint,
  userSelect: 'none',
};

const footStyle: React.CSSProperties = {
  padding: '13px 18px 18px',
  display: 'grid',
  justifyItems: 'center',
  textAlign: 'center',
};
