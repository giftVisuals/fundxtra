import type { Kobo } from '../money';
import type { IsoDate } from './common';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

/** Coarse risk banding derived from `riskScore`. Never used to auto-ban. */
export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH';

export type AccountFlag =
  | 'SELF_REFERRAL_ATTEMPT'
  | 'REFERRAL_VELOCITY'
  | 'TASK_VELOCITY'
  | 'DUPLICATE_DEVICE'
  | 'WITHDRAWAL_ANOMALY'
  | 'REPEATED_FAILED_PIN'
  | 'PROOF_REUSE'
  | 'MANUAL_REVIEW';

/**
 * A Fundxtra user. The document id is the Telegram id as a string — Telegram
 * identity *is* the primary key, so a user can never end up with two accounts
 * through a race on registration.
 */
export interface User {
  /** Telegram id, stringified. Also the Firestore document id. */
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  isPremiumTelegram: boolean;

  status: UserStatus;
  /** True once the user has created a PIN. The hash itself lives in `pins/{uid}`. */
  hasPin: boolean;
  /** True once the user has reached the dashboard — the referral qualification gate. */
  onboardedAt: IsoDate | null;

  /** Derived cache of the ledger. The ledger is authoritative. */
  balanceKobo: Kobo;
  /** Lifetime credited earnings, for display. */
  lifetimeEarnedKobo: Kobo;
  /** Lifetime debits that left the platform (withdrawals + redemptions). */
  lifetimePaidOutKobo: Kobo;
  /** Balance currently committed to pending withdrawals/redemptions. */
  pendingOutKobo: Kobo;

  tasksCompleted: number;
  referralCode: string;
  /** Telegram id of the referrer, set once and never changed. */
  referredBy: string | null;
  referralCount: number;
  qualifiedReferralCount: number;
  referralEarningsKobo: Kobo;

  riskScore: number;
  riskBand: RiskBand;
  flags: AccountFlag[];

  createdAt: IsoDate;
  updatedAt: IsoDate;
  lastSeenAt: IsoDate;
}

/** The shape the Mini App receives. Excludes every internal/security field. */
export interface UserProfile {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  status: UserStatus;
  hasPin: boolean;
  balanceKobo: Kobo;
  pendingOutKobo: Kobo;
  lifetimeEarnedKobo: Kobo;
  tasksCompleted: number;
  referralCode: string;
  referralLink: string;
  referralCount: number;
  qualifiedReferralCount: number;
  referralEarningsKobo: Kobo;
  createdAt: IsoDate;
}

export interface DashboardSummary {
  user: UserProfile;
  /** Sum of credits timestamped today, in the platform timezone. */
  todayEarnedKobo: Kobo;
  tasksCompletedToday: number;
  availableTaskCount: number;
  pendingSubmissionCount: number;
  withdrawalsOpen: boolean;
  withdrawalNotice: string | null;
}
