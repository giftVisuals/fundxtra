'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  NIGERIAN_BANKS,
  REWARD_KIND_LABELS,
  TRANSACTION_LABELS,
  WITHDRAWAL_STATUS_LABELS,
  formatNaira,
  maskAccountNumber,
  parseNairaInput,
  relativeTime,
  tokens,
  type RewardKind,
  type RewardProduct,
  type TransactionRow,
  type Withdrawal,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage, errorRequestId } from '@/lib/api';
import { supportUrl } from '@/lib/config';
import { haptic, openExternal } from '@/lib/telegram';
import { useSession } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PinInput,
  Sheet,
  SkeletonList,
  StatBlock,
  SuccessState,
} from '@/components/ui';
import { GiftIcon, WalletIcon } from '@/components/glass';
import { PanelHeader, Row, Section, IconTile } from './shared';

interface WalletPayload {
  balanceKobo: number;
  pendingOutKobo: number;
  lifetimeEarnedKobo: number;
  lifetimePaidOutKobo: number;
  withdrawals: {
    open: boolean;
    notice: string | null;
    opensAt: string | null;
    minAmountKobo: number;
    maxAmountKobo: number;
    dailyLimitKobo: number;
    feeKobo: number;
  };
}

/**
 * Wallet.
 *
 * One combined balance, as specified — there are no separate task, referral or
 * cash wallets, because splitting a user's money into buckets they cannot move
 * between is a worse product and a harder ledger. The detailed breakdown exists
 * behind the scenes in the transaction history.
 *
 * Withdrawal and redemption both require the PIN *in the request*, not just an
 * unlocked session, so a handed-over phone cannot authorise a payout.
 */
export function WalletPanel() {
  const { user, refresh, applyBalance } = useSession();
  const [wallet, setWallet] = useState<WalletPayload | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'withdraw' | 'rewards' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [walletResult, historyResult, withdrawalResult] = await Promise.all([
        api.get<WalletPayload>('/wallet'),
        api.get<{ items: TransactionRow[] }>('/wallet/transactions?limit=20'),
        api.get<{ withdrawals: Withdrawal[] }>('/wallet/withdrawals'),
      ]);
      setWallet(walletResult);
      setTransactions(historyResult.items);
      setWithdrawals(withdrawalResult.withdrawals);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const afterMoneyMoved = useCallback(
    async (balanceAfterKobo?: number) => {
      if (typeof balanceAfterKobo === 'number') applyBalance(balanceAfterKobo);
      await Promise.all([load(), refresh()]);
    },
    [applyBalance, load, refresh],
  );

  if (error && !wallet) {
    return (
      <div>
        <PanelHeader title="Wallet" />
        <ErrorState message={error} onRetry={() => void load()} supportUrl={supportUrl} />
      </div>
    );
  }

  if (!wallet || !user) {
    return (
      <div>
        <PanelHeader title="Wallet" subtitle="Your balance and history." />
        <SkeletonList count={3} lines={2} />
      </div>
    );
  }

  const openWithdrawals = withdrawals?.filter(
    (withdrawal) => withdrawal.status === 'PENDING' || withdrawal.status === 'PROCESSING',
  );

  return (
    <div>
      <PanelHeader title="Wallet" subtitle="One balance for everything you earn." />

      <Card tone="brand" padding={20} radius={tokens.radii.xl} style={{ marginBottom: 14 }}>
        <StatBlock
          label="Available balance"
          value={formatNaira(wallet.balanceKobo)}
          emphasis
          hint={
            wallet.pendingOutKobo > 0
              ? `${formatNaira(wallet.pendingOutKobo)} being processed`
              : `${formatNaira(wallet.lifetimeEarnedKobo)} earned all time`
          }
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <Button
            style={{ flex: 1 }}
            disabled={!wallet.withdrawals.open}
            onClick={() => setSheet('withdraw')}
          >
            Withdraw cash
          </Button>
          <Button
            variant="secondary"
            style={{ flex: 1 }}
            onClick={() => setSheet('rewards')}
            leadingIcon={<GiftIcon />}
          >
            Rewards
          </Button>
        </div>
      </Card>

      {!wallet.withdrawals.open && (
        <Card tone="warning" padding={14} style={{ marginBottom: 20 }}>
          <Badge tone="warning" mark="clock">Withdrawals closed</Badge>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.sm,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.colors.warning.strong,
            }}
          >
            {wallet.withdrawals.notice ?? 'Withdrawals are currently closed.'}
            {wallet.withdrawals.opensAt
              ? ` Opening ${relativeTime(wallet.withdrawals.opensAt)}.`
              : ''}
          </p>
        </Card>
      )}

      {openWithdrawals && openWithdrawals.length > 0 && (
        <Section title="In progress">
          {openWithdrawals.map((withdrawal) => (
            <Row
              key={withdrawal.id}
              leading={<IconTile tone="warning"><WalletIcon /></IconTile>}
              title={formatNaira(withdrawal.amountKobo)}
              subtitle={`${withdrawal.bank.bankName} · ${maskAccountNumber(
                withdrawal.bank.accountNumber,
              )} · ${relativeTime(withdrawal.requestedAt)}`}
              trailing={
                <Badge tone="warning" mark="clock">
                  {WITHDRAWAL_STATUS_LABELS[withdrawal.status]}
                </Badge>
              }
            />
          ))}
        </Section>
      )}

      <Section title="Recent activity">
        {transactions === null ? (
          <SkeletonList count={4} lines={2} />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={<WalletIcon active />}
            title="No activity yet"
            description="Once you complete a task or a friend joins through your link, it appears here."
          />
        ) : (
          transactions.map((transaction) => (
            <TransactionRowItem key={transaction.id} transaction={transaction} />
          ))
        )}
      </Section>

      <WithdrawSheet
        open={sheet === 'withdraw'}
        onClose={() => setSheet(null)}
        wallet={wallet}
        onDone={afterMoneyMoved}
      />
      <RewardsSheet
        open={sheet === 'rewards'}
        onClose={() => setSheet(null)}
        balanceKobo={wallet.balanceKobo}
        onDone={afterMoneyMoved}
      />
    </div>
  );
}

function TransactionRowItem({ transaction }: { transaction: TransactionRow }) {
  const credit = transaction.direction === 'CREDIT';
  const failed = transaction.status === 'FAILED' || transaction.status === 'REVERSED';

  return (
    <Row
      leading={
        <IconTile tone={failed ? 'neutral' : credit ? 'success' : 'brand'}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {credit ? <path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7" /> : <path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />}
          </svg>
        </IconTile>
      }
      title={transaction.description || TRANSACTION_LABELS[transaction.type]}
      subtitle={`${TRANSACTION_LABELS[transaction.type]} · ${relativeTime(transaction.createdAt)}`}
      trailing={
        <div style={{ textAlign: 'right' }}>
          <div
            className="fx-tabular"
            style={{
              fontSize: tokens.typography.size.base,
              fontWeight: tokens.typography.weight.semibold,
              color: failed
                ? tokens.semantic.inkFaint
                : credit
                  ? tokens.colors.success.strong
                  : tokens.semantic.ink,
              textDecoration: failed ? 'line-through' : 'none',
            }}
          >
            {formatNaira(transaction.amountKobo, { signed: credit })}
          </div>
          {transaction.status !== 'COMPLETED' && (
            <div
              style={{
                marginTop: 2,
                fontSize: tokens.typography.size['2xs'],
                color: tokens.semantic.inkFaint,
              }}
            >
              {transaction.status === 'PENDING'
                ? 'Processing'
                : transaction.status === 'REVERSED'
                  ? 'Refunded'
                  : 'Failed'}
            </div>
          )}
        </div>
      }
    />
  );
}

/**
 * Cash withdrawal.
 *
 * Deliberately a short, explicit form: amount, bank, account number, account
 * name, PIN. There is no account-name lookup because no payout provider has
 * been selected yet, and inventing one would mean either guessing an API or
 * silently accepting a name nobody verified. The user enters it and the form
 * says plainly that it must match.
 */
function WithdrawSheet({
  open,
  onClose,
  wallet,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  wallet: WalletPayload;
  onDone: (balanceAfterKobo?: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<'form' | 'pin' | 'done'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setStep('form');
      setPin('');
      setFieldErrors({});
      setFailure(null);
    }
  }, [open]);

  const amountKobo = useMemo(() => parseNairaInput(amount), [amount]);
  const netKobo = amountKobo === null ? null : amountKobo - wallet.withdrawals.feeKobo;

  const formValid =
    amountKobo !== null &&
    amountKobo >= wallet.withdrawals.minAmountKobo &&
    amountKobo <= Math.min(wallet.withdrawals.maxAmountKobo, wallet.balanceKobo) &&
    bankCode.length > 0 &&
    /^\d{10}$/.test(accountNumber) &&
    accountName.trim().length >= 3;

  const submit = useCallback(async () => {
    if (amountKobo === null) return;
    setSubmitting(true);
    setFieldErrors({});
    setFailure(null);
    try {
      await api.post('/wallet/withdrawals', {
        amountKobo,
        bankCode,
        accountNumber,
        accountName: accountName.trim(),
        pin,
      });
      haptic.success();
      setStep('done');
      await onDone();
    } catch (caught) {
      haptic.error();
      if (caught instanceof ApiError && caught.fields) {
        setFieldErrors(caught.fields);
        setStep('form');
      }
      setFailure({
        message: errorMessage(caught),
        ...(errorRequestId(caught) ? { requestId: errorRequestId(caught) } : {}),
      });
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }, [amountKobo, bankCode, accountNumber, accountName, pin, onDone]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Withdraw cash"
      dismissible={!submitting}
      footer={
        step === 'done' ? (
          <Button fullWidth size="lg" onClick={onClose}>
            Done
          </Button>
        ) : step === 'form' ? (
          <Button fullWidth size="lg" disabled={!formValid} onClick={() => setStep('pin')}>
            Continue
          </Button>
        ) : (
          <Button
            fullWidth
            size="lg"
            loading={submitting}
            disabled={pin.length !== 4 || submitting}
            onClick={() => void submit()}
          >
            {amountKobo !== null ? `Send ${formatNaira(amountKobo)}` : 'Confirm'}
          </Button>
        )
      }
    >
      {step === 'done' && (
        <SuccessState
          title="Withdrawal requested"
          message={`${formatNaira(
            amountKobo ?? 0,
          )} is on its way to ${accountName}. We will update the status in your wallet.`}
        />
      )}

      {step === 'pin' && (
        <div>
          <Card padding={14} tone="brand" style={{ marginBottom: 24 }}>
            <div style={{ display: 'grid', gap: 6, fontSize: tokens.typography.size.sm }}>
              <SummaryLine label="Amount" value={formatNaira(amountKobo ?? 0)} />
              {wallet.withdrawals.feeKobo > 0 && (
                <>
                  <SummaryLine label="Fee" value={formatNaira(wallet.withdrawals.feeKobo)} />
                  <SummaryLine label="You receive" value={formatNaira(netKobo ?? 0)} strong />
                </>
              )}
              <SummaryLine
                label="To"
                value={`${accountName} · ${maskAccountNumber(accountNumber)}`}
              />
              <SummaryLine
                label="Bank"
                value={NIGERIAN_BANKS.find((bank) => bank.code === bankCode)?.name ?? ''}
              />
            </div>
          </Card>

          <PinInput
            value={pin}
            onChange={setPin}
            label="Enter your PIN to approve"
            error={failure?.message}
            disabled={submitting}
            autoFocus
          />

          <button
            type="button"
            onClick={() => setStep('form')}
            style={{
              display: 'block',
              margin: '20px auto 0',
              background: 'none',
              border: 'none',
              fontSize: tokens.typography.size.sm,
              color: tokens.semantic.inkMuted,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            Change the details
          </button>
        </div>
      )}

      {step === 'form' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Field
            label="Amount"
            hint={`${formatNaira(wallet.withdrawals.minAmountKobo)} minimum · ${formatNaira(
              wallet.balanceKobo,
            )} available`}
            error={
              fieldErrors.amountKobo ??
              (amount.length > 0 && amountKobo === null
                ? 'Enter a valid amount'
                : amountKobo !== null && amountKobo > wallet.balanceKobo
                  ? 'That is more than your balance'
                  : amountKobo !== null && amountKobo < wallet.withdrawals.minAmountKobo
                    ? `The minimum is ${formatNaira(wallet.withdrawals.minAmountKobo)}`
                    : undefined)
            }
          >
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </Field>

          <Field label="Bank" error={fieldErrors.bankCode}>
            <select
              value={bankCode}
              onChange={(event) => setBankCode(event.target.value)}
              style={inputStyle}
            >
              <option value="">Select your bank</option>
              {NIGERIAN_BANKS.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Account number" error={fieldErrors.accountNumber}>
            <input
              inputMode="numeric"
              maxLength={10}
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ''))}
              placeholder="10 digits"
              style={inputStyle}
            />
          </Field>

          <Field
            label="Account name"
            hint="Must match the name on the account exactly"
            error={fieldErrors.accountName}
          >
            <input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="As it appears at your bank"
              autoComplete="name"
              style={inputStyle}
            />
          </Field>

          {failure && (
            <ErrorState
              message={failure.message}
              requestId={failure.requestId}
              supportUrl={supportUrl}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Reward redemption.
 *
 * The catalogue is shown in full with real prices even when nothing can be
 * delivered yet, and unavailable items say so with the server's own reason.
 * Showing a priced catalogue that admits what is not live is more trustworthy
 * than hiding the category until launch — and it is what the spec asked for.
 */
function RewardsSheet({
  open,
  onClose,
  balanceKobo,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  balanceKobo: number;
  onDone: (balanceAfterKobo?: number) => Promise<void>;
}) {
  const [catalogue, setCatalogue] = useState<{
    products: RewardProduct[];
    providerConfigured: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .get<{ products: RewardProduct[]; providerName: string; providerConfigured: boolean }>(
        '/wallet/rewards',
      )
      .then(setCatalogue)
      .catch((caught) => setError(errorMessage(caught)));
  }, [open]);

  const grouped = useMemo(() => {
    const groups = new Map<RewardKind, RewardProduct[]>();
    for (const product of catalogue?.products ?? []) {
      const existing = groups.get(product.kind) ?? [];
      existing.push(product);
      groups.set(product.kind, existing);
    }
    return [...groups.entries()];
  }, [catalogue]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Rewards"
      description={`Spend your ${formatNaira(balanceKobo)} balance on airtime, data, Telegram Stars or Telegram Premium.`}
    >
      {error && <ErrorState message={error} supportUrl={supportUrl} />}

      {!catalogue && !error && <SkeletonList count={3} lines={2} />}

      {catalogue && !catalogue.providerConfigured && (
        <Card tone="info" padding={14} style={{ marginBottom: 18 }}>
          <Badge tone="info" mark="clock">Coming soon</Badge>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.sm,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.colors.info.strong,
            }}
          >
            Reward delivery goes live as soon as our fulfilment partner opens their service.
            Prices below are final. Cash withdrawal is available now.
          </p>
        </Card>
      )}

      {catalogue && grouped.length === 0 && (
        <EmptyState
          icon={<GiftIcon active />}
          title="No rewards listed yet"
          description="Airtime, data, Telegram Stars and Telegram Premium are on the way. You can withdraw cash in the meantime."
        />
      )}

      {grouped.map(([kind, products]) => (
        <div key={kind} style={{ marginBottom: 22 }}>
          <h3
            style={{
              marginBottom: 10,
              fontSize: tokens.typography.size.sm,
              fontWeight: tokens.typography.weight.semibold,
              letterSpacing: tokens.typography.tracking.wider,
              textTransform: 'uppercase',
              color: tokens.semantic.inkSubtle,
            }}
          >
            {REWARD_KIND_LABELS[kind]}
          </h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {products.map((product) => {
              const affordable = balanceKobo >= product.priceKobo;
              return (
                <Row
                  key={product.id}
                  title={product.name}
                  subtitle={
                    product.available
                      ? affordable
                        ? product.description
                        : `You need ${formatNaira(product.priceKobo - balanceKobo)} more`
                      : (product.unavailableReason ?? 'Coming soon')
                  }
                  trailing={
                    <div style={{ textAlign: 'right' }}>
                      <div
                        className="fx-tabular"
                        style={{
                          fontSize: tokens.typography.size.base,
                          fontWeight: tokens.typography.weight.semibold,
                          color: tokens.semantic.brandInk,
                        }}
                      >
                        {formatNaira(product.priceKobo)}
                      </div>
                      {!product.available && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="neutral" mark="clock">Soon</Badge>
                        </div>
                      )}
                    </div>
                  }
                  {...(product.available && affordable
                    ? {
                        onClick: () => {
                          // Redemption flow proper is wired per reward kind;
                          // support is the honest fallback until a provider
                          // exists to deliver against.
                          openExternal(supportUrl);
                          void onDone();
                        },
                      }
                    : {})}
                />
              );
            })}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          marginBottom: 6,
          fontSize: tokens.typography.size.sm,
          fontWeight: tokens.typography.weight.medium,
        }}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p
          role="alert"
          style={{
            marginTop: 6,
            fontSize: tokens.typography.size.xs,
            color: tokens.colors.danger.strong,
          }}
        >
          {error}
        </p>
      ) : (
        hint && (
          <p
            style={{
              marginTop: 6,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkSubtle,
            }}
          >
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: tokens.colors.cocoa[700], opacity: 0.8 }}>{label}</span>
      <span
        className="fx-tabular"
        style={{
          fontWeight: strong
            ? tokens.typography.weight.bold
            : tokens.typography.weight.medium,
          color: tokens.colors.cocoa[800],
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  // 48px keeps every field above the touch-target floor and stops iOS zooming
  // in on focus, which a smaller font size would trigger.
  minHeight: 48,
  padding: '0 14px',
  fontSize: tokens.typography.size.md,
  background: tokens.semantic.bgSubtle,
  border: `1px solid ${tokens.semantic.border}`,
  borderRadius: tokens.radii.md,
  appearance: 'none',
};
