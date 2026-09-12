import type { IsoDate } from './types/common';
import type { TransactionType, TransactionStatus } from './types/ledger';
import type { TaskCategory, VerificationMethod, SubmissionStatus } from './types/task';
import type { WithdrawalStatus, RedemptionStatus, RewardKind } from './types/payout';
import type { UserStatus, RiskBand } from './types/user';

/** Display copy for enums, so no label is invented at the call site. */

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  TASK_REWARD: 'Task reward',
  REFERRAL_REWARD: 'Referral reward',
  CASH_WITHDRAWAL: 'Cash withdrawal',
  AIRTIME_REDEMPTION: 'Airtime',
  DATA_REDEMPTION: 'Data',
  TELEGRAM_STARS_REDEMPTION: 'Telegram Stars',
  TELEGRAM_PREMIUM_REDEMPTION: 'Telegram Premium',
  REVERSAL: 'Refund',
  ADMIN_ADJUSTMENT: 'Balance adjustment',
  BONUS: 'Bonus',
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REVERSED: 'Reversed',
};

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  TELEGRAM: 'Telegram',
  SOCIAL: 'Social',
  APP_INSTALL: 'Apps',
  SURVEY: 'Surveys',
  CONTENT: 'Content',
  SIGNUP: 'Sign-ups',
  OTHER: 'Other',
};

export const VERIFICATION_LABELS: Record<VerificationMethod, string> = {
  TELEGRAM_MEMBERSHIP: 'Verified automatically',
  SCREENSHOT: 'Screenshot review',
  MANUAL_REVIEW: 'Manual review',
  HONOUR: 'Instant',
};

/** Honest one-liners about how long a user waits. Shown on the task card. */
export const VERIFICATION_HINTS: Record<VerificationMethod, string> = {
  TELEGRAM_MEMBERSHIP: 'We check this with Telegram the moment you submit.',
  SCREENSHOT: 'A reviewer checks your screenshot, usually within 24 hours.',
  MANUAL_REVIEW: 'A reviewer checks your answer, usually within 24 hours.',
  HONOUR: 'Credited to your balance right away.',
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Delivered',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  AIRTIME: 'Airtime',
  DATA: 'Data',
  TELEGRAM_STARS: 'Telegram Stars',
  TELEGRAM_PREMIUM: 'Telegram Premium',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BANNED: 'Banned',
};

export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  LOW: 'Low risk',
  MEDIUM: 'Needs a look',
  HIGH: 'High risk',
};

/** "2 hours ago" / "in 3 days". Falls back to a date beyond a week. */
export function relativeTime(value: IsoDate | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';

  const deltaSeconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);

  if (absolute < 45) return deltaSeconds >= 0 ? 'in a moment' : 'just now';

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86_400],
  ];

  if (absolute < 7 * 86_400) {
    for (let index = units.length - 1; index >= 0; index -= 1) {
      const unit = units[index];
      if (!unit) continue;
      const [name, size] = unit;
      if (absolute >= size) {
        return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
          Math.round(deltaSeconds / size),
          name,
        );
      }
    }
  }
  return formatDate(value);
}

/** "12 Sep 2026" */
export function formatDate(value: IsoDate | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "12 Sep 2026, 14:05" */
export function formatDateTime(value: IsoDate | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(value)}, ${date.toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

/** Mask an account number for display: 0123456789 -> 012••••789 */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length < 6) return '•'.repeat(accountNumber.length);
  return `${accountNumber.slice(0, 3)}${'•'.repeat(accountNumber.length - 6)}${accountNumber.slice(-3)}`;
}

/** Two-letter monogram used wherever an avatar or sponsor logo is missing. */
export function initials(name: string | null | undefined): string {
  if (!name) return 'FX';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'FX';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

/** `@handle` for display, tolerant of stored values with or without the @. */
export function atHandle(username: string | null | undefined): string {
  if (!username) return '—';
  return username.startsWith('@') ? username : `@${username}`;
}

/** Deep link to the Mini App carrying a referral code. */
export function referralLink(botUsername: string, referralCode: string): string {
  const bot = botUsername.replace(/^@/, '');
  return `https://t.me/${bot}?start=${encodeURIComponent(referralCode)}`;
}
