'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useMemo, useState } from 'react';
import {
  NIGERIAN_BANKS,
  formatNaira,
  nairaInWords,
  parseNairaInput,
  tokens,
  type TransactionReceipt,
  type Withdrawal,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage, errorRequestId } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { supportUrl } from '@/lib/config';
import { Button, ErrorState, PinInput } from '@/components/ui';
import { BankPicker } from '@/components/ui/BankPicker';
import { Receipt } from './Receipt';

/**
 * Withdrawing, as a sequence of screens.
 *
 * Deliberately not one long form. A single page asking for an amount, a bank,
 * an account number, a name and a PIN is a wall of fields that has to be
 * scrolled past on every attempt, and on a phone the keyboard covers half of
 * it. Four short screens each ask one question, so what is being asked is
 * always the thing on screen.
 *
 * Steps also give the back button something honest to do: going back edits
 * that answer instead of discarding the whole request.
 *
 * The last screen is the real receipt, fetched from the server for the
 * transaction the withdrawal created — not a client-side summary of what was
 * typed. If the server recorded something different, the receipt shows the
 * server's version.
 */

type Step = 'amount' | 'destination' | 'review' | 'receipt';

const STEP_ORDER: Step[] = ['amount', 'destination', 'review'];

export interface WithdrawFlowProps {
  balanceKobo: number;
  minAmountKobo: number;
  maxAmountKobo: number;
  feeKobo: number;
  onClose: () => void;
  /** Called once the request is accepted, so the wallet can refresh. */
  onCompleted: () => Promise<void> | void;
}

export function WithdrawFlow({
  balanceKobo,
  minAmountKobo,
  maxAmountKobo,
  feeKobo,
  onClose,
  onCompleted,
}: WithdrawFlowProps) {
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [pin, setPin] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const amountKobo = useMemo(() => parseNairaInput(amount), [amount]);
  const ceiling = Math.min(maxAmountKobo, balanceKobo);
  const bank = NIGERIAN_BANKS.find((entry) => entry.code === bankCode) ?? null;

  /** Why the current step cannot be left, or null when it can. */
  const blocker = useMemo<string | null>(() => {
    if (step === 'amount') {
      if (amountKobo === null || amountKobo <= 0) return 'Enter how much you want to withdraw';
      if (amountKobo < minAmountKobo) return `The smallest withdrawal is ${formatNaira(minAmountKobo)}`;
      if (amountKobo > ceiling) return `You have ${formatNaira(balanceKobo)} available`;
      return null;
    }
    if (step === 'destination') {
      if (!bankCode) return 'Choose the bank the money should go to';
      if (!/^\d{10}$/.test(accountNumber)) return 'Enter all 10 digits of your account number';
      if (accountName.trim().length < 3) return 'Enter the account name your bank shows';
      return null;
    }
    if (step === 'review') {
      if (pin.length !== 4) return 'Enter your 4-digit PIN';
      return null;
    }
    return null;
  }, [step, amountKobo, minAmountKobo, ceiling, balanceKobo, bankCode, accountNumber, accountName, pin]);

  const goBack = useCallback(() => {
    setFailure(null);
    if (step === 'destination') { setStep('amount'); return; }
    if (step === 'review') { setPin(''); setStep('destination'); return; }
    onClose();
  }, [step, onClose]);

  const submit = useCallback(async () => {
    if (amountKobo === null) return;
    setSubmitting(true);
    setFieldErrors({});
    setFailure(null);

    try {
      const created = await api.post<{ withdrawal: Withdrawal }>('/wallet/withdrawals', {
        amountKobo,
        bankCode,
        accountNumber,
        accountName: accountName.trim(),
        pin,
      });
      haptic.success();
      setPin('');
      setStep('receipt');
      await onCompleted();

      /*
        The receipt comes from the server, for the ledger entry the withdrawal
        actually created. A summary assembled here would only ever repeat what
        was typed, which is the one thing that does not need confirming.
      */
      try {
        const loaded = await api.get<TransactionReceipt>(
          `/wallet/transactions/${created.withdrawal.transactionId}`,
        );
        setReceipt(loaded);
      } catch (caught) {
        // The request succeeded; only the receipt did not load. Say exactly
        // that, so nobody thinks their money is in limbo.
        setReceiptError(errorMessage(caught));
      }
    } catch (caught) {
      haptic.error();
      if (caught instanceof ApiError && caught.fields) {
        setFieldErrors(caught.fields);
        // Land back on the screen that owns the rejected field.
        if (caught.fields.amountKobo) setStep('amount');
        else if (caught.fields.bankCode || caught.fields.accountNumber || caught.fields.accountName) {
          setStep('destination');
        }
      }
      setFailure({
        message: errorMessage(caught),
        ...(errorRequestId(caught) ? { requestId: errorRequestId(caught) } : {}),
      });
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }, [amountKobo, bankCode, accountNumber, accountName, pin, onCompleted]);

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header: one back affordance, one title, and where you are. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={goBack}
          disabled={submitting}
          aria-label={step === 'amount' ? 'Back to wallet' : 'Back a step'}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 34,
            height: 34,
            flex: 'none',
            background: tokens.semantic.bgSubtle,
            color: tokens.semantic.brandInk,
            border: `1px solid ${tokens.semantic.border}`,
            borderRadius: tokens.radii.pill,
            opacity: submitting ? 0.5 : 1,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>

        <h1 style={{ flex: 1, fontSize: tokens.typography.size.lg }}>
          {step === 'amount' && 'How much?'}
          {step === 'destination' && 'Where to?'}
          {step === 'review' && 'Check and confirm'}
          {step === 'receipt' && 'Request received'}
        </h1>

        {step !== 'receipt' && (
          <div aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
            {STEP_ORDER.map((entry, index) => (
              <span
                key={entry}
                style={{
                  width: index === stepIndex ? 18 : 6,
                  height: 6,
                  borderRadius: tokens.radii.pill,
                  background:
                    index <= stepIndex ? tokens.semantic.brand : tokens.semantic.borderStrong,
                  transition: 'width 180ms ease, background 180ms ease',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {failure && (
        <ErrorState
          title="That did not go through"
          message={failure.message}
          requestId={failure.requestId}
          supportUrl={supportUrl}
        />
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduceMotion ? undefined : { opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -14 }}
          transition={tokens.motion.spring.panel}
          style={{ display: 'grid', gap: 16 }}
        >
          {step === 'amount' && (
            <AmountStep
              amount={amount}
              onAmount={setAmount}
              amountKobo={amountKobo}
              balanceKobo={balanceKobo}
              minAmountKobo={minAmountKobo}
              ceiling={ceiling}
              feeKobo={feeKobo}
              error={fieldErrors.amountKobo}
            />
          )}

          {step === 'destination' && (
            <DestinationStep
              bankCode={bankCode}
              onBankCode={setBankCode}
              accountNumber={accountNumber}
              onAccountNumber={setAccountNumber}
              accountName={accountName}
              onAccountName={setAccountName}
              errors={fieldErrors}
            />
          )}

          {step === 'review' && amountKobo !== null && (
            <ReviewStep
              amountKobo={amountKobo}
              feeKobo={feeKobo}
              bankName={bank?.name ?? ''}
              accountNumber={accountNumber}
              accountName={accountName}
              pin={pin}
              onPin={setPin}
              submitting={submitting}
            />
          )}

          {step === 'receipt' && (
            <ReceiptStep receipt={receipt} error={receiptError} onClose={onClose} />
          )}
        </motion.div>
      </AnimatePresence>

      {step !== 'receipt' && (
        <Button
          fullWidth
          size="lg"
          disabled={Boolean(blocker) || submitting}
          loading={submitting && step === 'review'}
          onClick={() => {
            if (step === 'review') { void submit(); return; }
            haptic.light();
            setFailure(null);
            setStep(step === 'amount' ? 'destination' : 'review');
          }}
        >
          {blocker
            ? blocker
            : step === 'review'
              ? `Send ${formatNaira(amountKobo ?? 0)} request`
              : 'Continue'}
        </Button>
      )}
    </div>
  );
}

/* ── Step 1 ─────────────────────────────────────────────────────────── */

function AmountStep({
  amount, onAmount, amountKobo, balanceKobo, minAmountKobo, ceiling, feeKobo, error,
}: {
  amount: string;
  onAmount: (value: string) => void;
  amountKobo: number | null;
  balanceKobo: number;
  minAmountKobo: number;
  ceiling: number;
  feeKobo: number;
  error?: string | undefined;
}) {
  /* Quick amounts, but only the ones this balance can actually cover. */
  const quick = [minAmountKobo, 100_000, 250_000, 500_000].filter(
    (value, index, all) => value <= ceiling && all.indexOf(value) === index,
  );

  const tooSmall = amountKobo !== null && amountKobo > 0 && amountKobo < minAmountKobo;
  const tooBig = amountKobo !== null && amountKobo > ceiling;

  return (
    <>
      <div style={balanceStyle}>
        <span style={balanceLabelStyle}>Available to withdraw</span>
        <div className="fx-tabular" style={{ fontSize: 30, fontWeight: tokens.typography.weight.bold, letterSpacing: '-0.025em', marginTop: 4 }}>
          {formatNaira(balanceKobo)}
        </div>
        <div style={balanceMetaStyle}>
          <span>Minimum <b style={{ color: tokens.semantic.brandInk }}>{formatNaira(minAmountKobo)}</b></span>
          <span>Fee <b style={{ color: tokens.semantic.brandInk }}>{formatNaira(feeKobo)}</b></span>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <label htmlFor="fx-amount" style={labelStyle}>Amount</label>
        <div style={{ position: 'relative' }}>
          <span aria-hidden="true" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 17, fontWeight: 600, color: tokens.colors.cocoa[500] }}>
            ₦
          </span>
          <input
            id="fx-amount"
            className="fx-tabular"
            inputMode="numeric"
            value={amount}
            onChange={(event) => onAmount(event.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0"
            autoComplete="off"
            style={{
              ...controlStyle,
              paddingLeft: 34,
              paddingRight: 70,
              fontSize: 21,
              fontWeight: tokens.typography.weight.bold,
              ...(tooSmall || tooBig || error ? { borderColor: tokens.colors.danger.base } : {}),
            }}
          />
          <button
            type="button"
            onClick={() => onAmount(String(ceiling / 100))}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              padding: '5px 9px',
              background: tokens.colors.cocoa[100],
              border: `1px solid ${tokens.colors.cocoa[200]}`,
              borderRadius: tokens.radii.xs,
              fontSize: tokens.typography.size['2xs'],
              fontWeight: tokens.typography.weight.bold,
              letterSpacing: '0.06em',
              color: tokens.semantic.brandInk,
            }}
          >
            ALL
          </button>
        </div>
        <p style={{ fontSize: tokens.typography.size.xs, color: tooSmall || tooBig || error ? tokens.colors.danger.base : tokens.semantic.inkSubtle, minHeight: 16 }}>
          {error
            ?? (tooSmall
              ? `The smallest withdrawal is ${formatNaira(minAmountKobo)}.`
              : tooBig
                ? `You have ${formatNaira(balanceKobo)} available.`
                : amountKobo
                  ? nairaInWords(amountKobo)
                  : `Between ${formatNaira(minAmountKobo)} and ${formatNaira(ceiling)}.`)}
        </p>
      </div>

      {quick.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${String(quick.length)}, 1fr)`, gap: 7 }}>
          {quick.map((value) => (
            <button
              key={value}
              type="button"
              className="fx-tabular"
              aria-pressed={amountKobo === value}
              onClick={() => onAmount(String(value / 100))}
              style={{
                padding: '9px 4px',
                background: amountKobo === value ? tokens.colors.cocoa[100] : tokens.semantic.surface,
                border: `1px solid ${amountKobo === value ? tokens.colors.cocoa[300] : tokens.semantic.borderStrong}`,
                borderRadius: tokens.radii.sm,
                fontSize: tokens.typography.size.sm,
                fontWeight: tokens.typography.weight.semibold,
                color: tokens.semantic.brandInk,
              }}
            >
              {formatNaira(value)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Step 2 ─────────────────────────────────────────────────────────── */

function DestinationStep({
  bankCode, onBankCode, accountNumber, onAccountNumber, accountName, onAccountName, errors,
}: {
  bankCode: string;
  onBankCode: (code: string) => void;
  accountNumber: string;
  onAccountNumber: (value: string) => void;
  accountName: string;
  onAccountName: (value: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <>
      <div style={{ display: 'grid', gap: 6 }}>
        <label htmlFor="fx-bank" style={labelStyle}>Destination bank</label>
        <BankPicker id="fx-bank" value={bankCode} onChange={onBankCode} />
        {errors.bankCode && <p style={errorTextStyle}>{errors.bankCode}</p>}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <label htmlFor="fx-acct" style={labelStyle}>Account number</label>
        <input
          id="fx-acct"
          className="fx-tabular"
          inputMode="numeric"
          maxLength={10}
          value={accountNumber}
          onChange={(event) => onAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="0123456789"
          autoComplete="off"
          style={{ ...controlStyle, letterSpacing: '0.08em', ...(errors.accountNumber ? { borderColor: tokens.colors.danger.base } : {}) }}
        />
        <p style={{ fontSize: tokens.typography.size.xs, color: errors.accountNumber ? tokens.colors.danger.base : tokens.semantic.inkSubtle }}>
          {errors.accountNumber
            ?? (accountNumber.length === 0
              ? 'Your NUBAN — the 10-digit number in your bank app.'
              : accountNumber.length < 10
                ? `${String(accountNumber.length)} of 10 digits.`
                : 'Read it back to yourself before you continue.')}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <label htmlFor="fx-acct-name" style={labelStyle}>Account name</label>
        <input
          id="fx-acct-name"
          value={accountName}
          onChange={(event) => onAccountName(event.target.value)}
          placeholder="Exactly as your bank has it"
          autoComplete="off"
          style={{ ...controlStyle, ...(errors.accountName ? { borderColor: tokens.colors.danger.base } : {}) }}
        />
        {/*
          No name lookup exists yet, and inventing a confirmation would be the
          most dangerous thing this screen could do: a confident wrong name is
          what makes someone send money to a stranger.
        */}
        <p style={{ fontSize: tokens.typography.size.xs, color: errors.accountName ? tokens.colors.danger.base : tokens.semantic.inkSubtle }}>
          {errors.accountName ?? 'We cannot look this up yet, so please copy it from your bank.'}
        </p>
      </div>
    </>
  );
}

/* ── Step 3 ─────────────────────────────────────────────────────────── */

function ReviewStep({
  amountKobo, feeKobo, bankName, accountNumber, accountName, pin, onPin, submitting,
}: {
  amountKobo: number;
  feeKobo: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  pin: string;
  onPin: (value: string) => void;
  submitting: boolean;
}) {
  return (
    <>
      <dl style={{ margin: 0, background: tokens.semantic.surface, border: `1px solid ${tokens.semantic.border}`, borderRadius: tokens.radii.lg, padding: '4px 14px' }}>
        <Line label="To" value={accountName.toUpperCase()} sub={bankName} />
        <Line label="Account" value={accountNumber} mono />
        <Line label="Amount" value={formatNaira(amountKobo)} />
        <Line label="Fee" value={formatNaira(feeKobo)} />
        <Line label="Lands in your account" value={formatNaira(amountKobo - feeKobo)} strong />
      </dl>

      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '11px 12px',
          background: tokens.colors.warning.soft,
          border: '1px solid #f0dcb8',
          borderRadius: tokens.radii.md,
          fontSize: tokens.typography.size.sm,
          color: tokens.colors.warning.strong,
          lineHeight: tokens.typography.leading.relaxed,
        }}
      >
        <svg style={{ flex: 'none', marginTop: 2 }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.01" /></svg>
        <span>
          A transfer that reaches the wrong account cannot be pulled back — by us
          or by your bank. Check the number once more.
        </span>
      </div>

      <PinInput
        value={pin}
        onChange={onPin}
        label="Enter your PIN to authorise"
        disabled={submitting}
        autoFocus
      />
    </>
  );
}

function Line({
  label, value, sub, mono, strong,
}: { label: string; value: string; sub?: string; mono?: boolean; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 14,
        padding: '11px 0',
        borderTop: strong ? `1.5px solid ${tokens.semantic.border}` : undefined,
        borderBottom: strong ? undefined : `1px solid ${tokens.semantic.divider}`,
        fontSize: tokens.typography.size.sm,
      }}
    >
      <dt style={{ color: strong ? tokens.semantic.ink : tokens.semantic.inkSubtle, flex: 'none', fontWeight: strong ? tokens.typography.weight.semibold : undefined }}>
        {label}
      </dt>
      <dd
        className={mono ? undefined : 'fx-tabular'}
        style={{
          margin: 0,
          textAlign: 'right',
          fontWeight: tokens.typography.weight.semibold,
          fontSize: strong ? tokens.typography.size.lg : undefined,
          ...(mono ? { fontFamily: tokens.typography.fontMono, letterSpacing: '0.04em' } : {}),
        }}
      >
        {value}
        {sub && (
          <small style={{ display: 'block', marginTop: 2, fontWeight: tokens.typography.weight.regular, fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle }}>
            {sub}
          </small>
        )}
      </dd>
    </div>
  );
}

/* ── Step 4 ─────────────────────────────────────────────────────────── */

function ReceiptStep({
  receipt, error, onClose,
}: { receipt: TransactionReceipt | null; error: string | null; onClose: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {receipt ? (
        <Receipt receipt={receipt} />
      ) : error ? (
        /*
          The request went through — only the receipt failed to load. Saying so
          precisely matters: "something went wrong" here would read as the money
          having gone missing.
        */
        <ErrorState
          title="Your request was received"
          message={`We could not load the receipt just now (${error}). The withdrawal is safe — it is in your wallet history.`}
          supportUrl={supportUrl}
        />
      ) : (
        <p style={{ textAlign: 'center', fontSize: tokens.typography.size.sm, color: tokens.semantic.inkMuted }}>
          Preparing your receipt…
        </p>
      )}

      <Button variant="secondary" fullWidth onClick={onClose}>
        Back to wallet
      </Button>
    </div>
  );
}

/* ── Shared styles ──────────────────────────────────────────────────── */

const labelStyle: React.CSSProperties = {
  fontSize: tokens.typography.size['2xs'],
  fontWeight: tokens.typography.weight.bold,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: tokens.semantic.inkMuted,
};

const controlStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: tokens.semantic.surface,
  border: `1px solid ${tokens.semantic.borderStrong}`,
  borderRadius: tokens.radii.md,
  fontSize: tokens.typography.size.base,
  fontWeight: tokens.typography.weight.medium,
  boxShadow: tokens.shadows.xs,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: tokens.typography.size.xs,
  color: tokens.colors.danger.base,
};

const balanceStyle: React.CSSProperties = {
  border: `1px solid ${tokens.colors.cocoa[200]}`,
  borderRadius: tokens.radii.lg,
  background: `radial-gradient(120% 140% at 100% 0%, #fffdfb 0%, ${tokens.colors.cocoa[50]} 62%, ${tokens.colors.cocoa[100]} 100%)`,
  padding: '15px 16px 13px',
};

const balanceLabelStyle: React.CSSProperties = {
  fontSize: tokens.typography.size['2xs'],
  fontWeight: tokens.typography.weight.bold,
  letterSpacing: '0.11em',
  textTransform: 'uppercase',
  color: tokens.semantic.brand,
};

const balanceMetaStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  marginTop: 12,
  paddingTop: 10,
  borderTop: `1px solid ${tokens.colors.cocoa[200]}`,
  fontSize: tokens.typography.size.xs,
  color: tokens.semantic.inkMuted,
};
