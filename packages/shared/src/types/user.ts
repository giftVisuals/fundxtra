import type { Kobo } from '../money';
import type { IsoDate } from './common';
import type { SignupSource } from '../constants';

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

  /**
   * Today's earnings, kept here rather than recomputed.
   *
   * `todayKey` is the platform day these two belong to; when it is not today
   * they are simply stale and read as zero. Maintained by the ledger inside
   * the same write that moves the balance, so the dashboard costs nothing to
   * show them — the alternative was reading every credit the user had
   * received today, every time they opened the app.
   */
  todayKey: string | null;
  todayEarnedKobo: Kobo;
  todayCreditCount: number;

  referralCode: string;
  /** Telegram id of the referrer, set once and never changed. */
  referredBy: string | null;
  /** Reserved `?start=` payload the account arrived through, e.g. `website`. */
  signupSource: SignupSource | null;
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

/**
 * The Telegram channel Fundxtra points users at.
 *
 * `required` is the difference between a promotion and a gate: when it is
 * true, a user who is not a member cannot sign in or earn, and the app shows
 * them the way in instead of a dashboard.
 */
export interface ChannelInvite {
  /** '@fundxtra', or a numeric id for a private chat. */
  handle: string;
  /** Where to send someone to join. */
  url: string;
  required: boolean;
}

export interface DashboardSummary {
  user: UserProfile;
  /**
   * Sum of credits timestamped today, in the platform timezone.
   *
   * `null` when the figure could not be computed — the query behind it needs a
   * composite Firestore index, and until that index exists the honest answer
   * is "unknown", not zero. Showing ₦0 for money that was in fact earned is a
   * worse failure than showing a dash: the balance is authoritative and
   * unaffected either way, but a zeroed daily figure reads as lost earnings.
   */
  todayEarnedKobo: Kobo | null;
  /** `null` for the same reason as `todayEarnedKobo`. */
  tasksCompletedToday: number | null;
  availableTaskCount: number;
  pendingSubmissionCount: number;
  withdrawalsOpen: boolean;
  withdrawalNotice: string | null;
  /** Null when no channel is configured. */
  channel: ChannelInvite | null;
}
