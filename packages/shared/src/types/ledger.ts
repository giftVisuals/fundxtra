import type { Kobo } from '../money';
import type { WithdrawalStatus } from './payout';
import type { IsoDate } from './common';

/**
 * Every kind of balance movement. Credits are positive, debits negative; the
 * sign is stored on the amount and also implied by the type, and the ledger
 * service asserts the two agree.
 */
export type TransactionType =
  | 'TASK_REWARD'
  | 'REFERRAL_REWARD'
  | 'CASH_WITHDRAWAL'
  | 'AIRTIME_REDEMPTION'
  | 'DATA_REDEMPTION'
  | 'TELEGRAM_STARS_REDEMPTION'
  | 'TELEGRAM_PREMIUM_REDEMPTION'
  | 'REVERSAL'
  | 'ADMIN_ADJUSTMENT'
  | 'BONUS';

export type TransactionDirection = 'CREDIT' | 'DEBIT';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

export const CREDIT_TYPES: readonly TransactionType[] = [
  'TASK_REWARD',
  'REFERRAL_REWARD',
  'REVERSAL',
  'BONUS',
];

export const DEBIT_TYPES: readonly TransactionType[] = [
  'CASH_WITHDRAWAL',
  'AIRTIME_REDEMPTION',
  'DATA_REDEMPTION',
  'TELEGRAM_STARS_REDEMPTION',
  'TELEGRAM_PREMIUM_REDEMPTION',
];

/**
 * An immutable ledger entry.
 *
 * Written exactly once, inside a Firestore transaction that also moves the
 * balance cache. Nothing in the codebase updates an existing transaction's
 * `amountKobo`; a correction is a new `REVERSAL` entry that points back via
 * `reversalOf`. Status *may* advance (PENDING -> COMPLETED/FAILED) for
 * provider-backed debits, which is the one mutable field and is append-only in
 * spirit: FAILED always ships with a compensating REVERSAL credit.
 */
export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  direction: TransactionDirection;
  /** Signed. Negative for debits. Always integer kobo. */
  amountKobo: Kobo;
  status: TransactionStatus;
  /** Balance after this entry was applied. Makes disputes auditable. */
  balanceAfterKobo: Kobo;
  /** Short, user-facing line shown in transaction history. */
  description: string;
  /** Human-readable external reference (provider ref, withdrawal id, task id). */
  reference: string | null;
  /** The idempotency key that authorised this entry. */
  idempotencyKey: string;
  /** Set on REVERSAL entries. */
  reversalOf: string | null;
  /** Admin telegram id when the entry was created by an admin action. */
  actorAdminId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/** Transaction row as rendered in the wallet. */
export interface TransactionRow {
  id: string;
  type: TransactionType;
  direction: TransactionDirection;
  amountKobo: Kobo;
  status: TransactionStatus;
  description: string;
  reference: string | null;
  /**
   * Balance immediately after this entry.
   *
   * Sent to the client because it is what makes a receipt settle an
   * argument: "you were owed X before, Y after" is checkable, where an
   * amount alone is not. It is stored on every entry regardless; this only
   * stops the API discarding it on the way out.
   */
  balanceAfterKobo: Kobo;
  createdAt: IsoDate;
}

/**
 * Everything a receipt prints, for one transaction.
 *
 * Assembled rather than stored: the ledger entry is the source of truth for
 * the money, and the withdrawal record — when there is one — is the source of
 * truth for where it went. A receipt that copied either at write time would
 * drift the moment an admin reviewed the payout.
 */
export interface TransactionReceipt {
  transaction: TransactionRow & {
    /** Populated for entries an admin created, so a query can be answered. */
    actorAdminId: string | null;
    reversalOf: string | null;
  };
  /** Present when this entry is a cash withdrawal. */
  withdrawal: {
    id: string;
    status: WithdrawalStatus;
    amountKobo: Kobo;
    feeKobo: Kobo;
    netKobo: Kobo;
    bankName: string;
    accountNumber: string;
    accountName: string;
    requestedAt: IsoDate;
    reviewedAt: IsoDate | null;
    failureReason: string | null;
  } | null;
  /** Support handle to quote the reference to, from settings. */
  supportHandle: string;
  /** When the receipt was assembled — printed on it, like a bank does. */
  issuedAt: IsoDate;
}

export type ReferralStatus = 'PENDING' | 'QUALIFIED' | 'REJECTED';

/**
 * A referral edge. Document id is the *referred* user's id, which makes it
 * structurally impossible to attribute one Telegram account to two referrers.
 */
export interface Referral {
  id: string;
  referrerId: string;
  referredId: string;
  referredUsername: string | null;
  referredFirstName: string;
  status: ReferralStatus;
  rewardKobo: Kobo;
  /** Transaction id of the ₦100 credit. Null until qualified. */
  transactionId: string | null;
  /** Why a referral was rejected (self-referral, fraud review, …). */
  rejectionReason: string | null;
  createdAt: IsoDate;
  qualifiedAt: IsoDate | null;
}

export interface ReferralSummary {
  referralCode: string;
  referralLink: string;
  rewardPerReferralKobo: Kobo;
  totalReferrals: number;
  qualifiedReferrals: number;
  pendingReferrals: number;
  earningsKobo: Kobo;
}
