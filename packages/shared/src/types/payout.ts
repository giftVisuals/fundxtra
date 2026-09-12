import type { Kobo } from '../money';
import type { Network } from '../constants';
import type { IsoDate } from './common';

export type WithdrawalStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

/** Statuses where the user's money is still committed and not yet spendable. */
export const OPEN_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['PENDING', 'PROCESSING'];

export interface BankAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  /** Supplied by the user. Verified by the payout provider once one is selected. */
  accountName: string;
}

export interface Withdrawal {
  id: string;
  userId: string;
  userTelegramId: string;
  username: string | null;
  amountKobo: Kobo;
  /** Platform fee, if the admin configures one. Zero by default. */
  feeKobo: Kobo;
  /** amount - fee. What actually lands in the bank account. */
  netKobo: Kobo;
  status: WithdrawalStatus;
  bank: BankAccount;
  /** Debit transaction created when the request was accepted. */
  transactionId: string;
  /** Compensating credit created if the payout fails or is rejected. */
  reversalTransactionId: string | null;
  /** Provider reference once a payout provider is wired in. */
  providerReference: string | null;
  providerName: string | null;
  failureReason: string | null;
  reviewedBy: string | null;
  reviewedAt: IsoDate | null;
  requestedAt: IsoDate;
  updatedAt: IsoDate;
}

export type RewardKind = 'AIRTIME' | 'DATA' | 'TELEGRAM_STARS' | 'TELEGRAM_PREMIUM';

export type RedemptionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * A purchasable reward. Airtime is open-amount; data/Stars/Premium are bundles.
 * `available` is false whenever no provider can fulfil the item, so the
 * catalogue can be shown honestly without promising delivery.
 */
export interface RewardProduct {
  id: string;
  kind: RewardKind;
  name: string;
  description: string;
  priceKobo: Kobo;
  /** Airtime only: user chooses the amount within [min,max]. */
  openAmount: boolean;
  minAmountKobo: Kobo | null;
  maxAmountKobo: Kobo | null;
  network: Network | null;
  /** Data bundles: "1.5GB", "30 days". */
  dataVolume: string | null;
  validityDays: number | null;
  /** Stars bundles. */
  stars: number | null;
  /** Premium plans. */
  months: number | null;
  available: boolean;
  /** Shown when unavailable, e.g. "Coming soon — awaiting provider launch". */
  unavailableReason: string | null;
  sortWeight: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Redemption {
  id: string;
  userId: string;
  userTelegramId: string;
  kind: RewardKind;
  productId: string;
  productName: string;
  amountKobo: Kobo;
  status: RedemptionStatus;
  /** Phone number for airtime/data; Telegram username for Stars/Premium. */
  target: string;
  network: Network | null;
  transactionId: string;
  reversalTransactionId: string | null;
  providerName: string | null;
  providerReference: string | null;
  failureReason: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}
