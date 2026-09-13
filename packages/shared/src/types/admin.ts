import type { Kobo } from '../money';
import type { IsoDate } from './common';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR';

/**
 * Fine-grained permissions. Roles expand to permission sets in
 * `packages/shared/src/permissions.ts`, and every admin route declares the
 * permission it needs rather than checking a role string inline.
 */
export type Permission =
  | 'admins:manage'
  | 'settings:manage'
  | 'finance:manage'
  | 'finance:adjust'
  | 'tasks:manage'
  | 'submissions:review'
  | 'users:view'
  | 'users:manage'
  | 'withdrawals:view'
  | 'withdrawals:process'
  | 'rewards:manage'
  | 'announcements:manage'
  | 'audit:view';

export interface Admin {
  /** Telegram id, stringified. Document id. */
  id: string;
  telegramId: string;
  username: string | null;
  displayName: string;
  role: AdminRole;
  /** Extra permissions granted on top of the role. */
  extraPermissions: Permission[];
  active: boolean;
  /** Telegram id of the admin who added this one. Null for the primary admin. */
  addedBy: string | null;
  createdAt: IsoDate;
  lastActiveAt: IsoDate | null;
}

/**
 * An admin added by username before their Telegram id is known. Resolved to a
 * real `admins/{telegramId}` document the first time that username opens the
 * app, because username is not a stable identity.
 */
export interface AdminInvite {
  id: string;
  /** Lowercased, no leading @. */
  username: string;
  role: AdminRole;
  extraPermissions: Permission[];
  invitedBy: string;
  claimedByTelegramId: string | null;
  claimedAt: IsoDate | null;
  createdAt: IsoDate;
  expiresAt: IsoDate;
}

export type AuditAction =
  | 'ADMIN_ADDED' | 'ADMIN_UPDATED' | 'ADMIN_REMOVED'
  | 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_STATUS_CHANGED' | 'TASK_DELETED'
  | 'SUBMISSION_APPROVED' | 'SUBMISSION_REJECTED'
  | 'USER_SUSPENDED' | 'USER_UNSUSPENDED' | 'USER_BANNED' | 'USER_UNBANNED'
  | 'USER_PIN_RESET' | 'USER_FLAGGED' | 'USER_UNFLAGGED'
  | 'BALANCE_ADJUSTED'
  | 'WITHDRAWAL_APPROVED' | 'WITHDRAWAL_REJECTED' | 'WITHDRAWAL_COMPLETED' | 'WITHDRAWAL_FAILED'
  | 'REDEMPTION_RETRIED' | 'REDEMPTION_CANCELLED'
  | 'SETTINGS_UPDATED' | 'WITHDRAWALS_TOGGLED'
  | 'REWARD_PRODUCT_CREATED' | 'REWARD_PRODUCT_UPDATED'
  | 'ANNOUNCEMENT_CREATED' | 'ANNOUNCEMENT_UPDATED' | 'ANNOUNCEMENT_DELETED';

/** Append-only record of every consequential admin action. */
export interface AuditLog {
  id: string;
  action: AuditAction;
  actorId: string;
  actorUsername: string | null;
  actorRole: AdminRole;
  /** What was acted on: 'user' | 'task' | 'withdrawal' | … */
  targetType: string;
  targetId: string;
  summary: string;
  /** Before/after for field changes. Money always in kobo. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Required for financial actions — admins must state a reason. */
  reason: string | null;
  ip: string | null;
  createdAt: IsoDate;
}

export type SecurityEventType =
  | 'INITDATA_INVALID'
  | 'INITDATA_EXPIRED'
  | 'PIN_FAILED'
  | 'PIN_LOCKED'
  | 'PIN_CREATED'
  | 'PIN_CHANGED'
  | 'PIN_RESET_BY_ADMIN'
  | 'SESSION_ISSUED'
  | 'SELF_REFERRAL_BLOCKED'
  | 'DUPLICATE_REFERRAL_BLOCKED'
  | 'IDEMPOTENT_REPLAY'
  | 'RATE_LIMITED'
  | 'SUSPICIOUS_VELOCITY'
  | 'FORBIDDEN_ACCESS'
  | 'ADMIN_ACTION';

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  userId: string | null;
  telegramId: string | null;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDate;
}

export type AnnouncementLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
export type AnnouncementAudience = 'APP' | 'PUBLIC' | 'BOTH';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  audience: AnnouncementAudience;
  /** Optional call to action. */
  ctaLabel: string | null;
  ctaUrl: string | null;
  published: boolean;
  /** Scheduling. Both null means "live as soon as published". */
  publishAt: IsoDate | null;
  expiresAt: IsoDate | null;
  /** Pins the announcement to the top of the dashboard. */
  pinned: boolean;
  createdBy: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/** Admin-editable configuration. Single document: `systemSettings/global`. */
export interface SystemSettings {
  withdrawals: {
    enabled: boolean;
    /** Shown to users whenever withdrawals are closed. */
    maintenanceMessage: string;
    /** Optional scheduled window; when set, overrides `enabled` by time. */
    opensAt: IsoDate | null;
    closesAt: IsoDate | null;
    minAmountKobo: Kobo;
    maxAmountKobo: Kobo;
    dailyLimitKobo: Kobo;
    /**
     * Ceiling on everything the platform can pay out in one day, across all
     * users. A circuit breaker rather than a working limit: it exists so a
     * mistake or a compromised admin cannot empty the float before anyone
     * notices. Only a super admin can change it.
     */
    platformDailyPayoutKobo: Kobo;
    feeKobo: Kobo;
    /** Payouts require an admin decision before reaching a provider. */
    requireManualApproval: boolean;
  };
  rewards: {
    airtimeEnabled: boolean;
    dataEnabled: boolean;
    starsEnabled: boolean;
    premiumEnabled: boolean;
    minAirtimeKobo: Kobo;
    minDataKobo: Kobo;
    /** Which fulfilment provider is active: 'mock' | 'nasfampay' | 'none'. */
    activeProvider: string;
  };
  referrals: {
    enabled: boolean;
    rewardKobo: Kobo;
  };
  tasks: {
    /** Server-enforced ceiling; may be lowered below the hard cap, never raised. */
    maxRewardKobo: Kobo;
    /** Global pause switch for all task earning. */
    earningEnabled: boolean;
    /**
     * Whether screenshots are read automatically before a person sees them.
     *
     * Off puts every submission back in the human queue, exactly as it worked
     * before. A setting rather than only an environment variable, so it can be
     * switched off in seconds if the reviewer starts making bad calls.
     */
    autoReviewEnabled: boolean;
  };
  platform: {
    /** Blocks all non-admin traffic with a friendly notice. */
    maintenanceMode: boolean;
    maintenanceMessage: string;
    botUsername: string;
    supportHandle: string;
    /** Whether the public site may show live statistics. */
    publicStatsEnabled: boolean;
  };
  updatedBy: string | null;
  updatedAt: IsoDate;
}

/**
 * Aggregated platform statistics.
 *
 * Maintained incrementally by the services that cause the change, then exposed
 * on the public site. `sufficientData` is false while the platform is young, so
 * the site shows an honest early-stage state instead of unimpressive or
 * invented numbers.
 */
export interface PublicStats {
  totalUsers: number;
  totalTasksCompleted: number;
  totalPaidOutKobo: Kobo;
  totalRewardsEarnedKobo: Kobo;
  activeCampaigns: number;
  activeCampaignBudgetKobo: Kobo;
  totalReferralsQualified: number;
  sufficientData: boolean;
  updatedAt: IsoDate;
}

export interface AdminDashboardStats {
  users: { total: number; active: number; suspended: number; banned: number; newToday: number };
  tasks: { active: number; paused: number; expired: number; pendingSubmissions: number };
  finance: {
    totalBalanceKobo: Kobo;
    totalEarnedKobo: Kobo;
    totalPaidOutKobo: Kobo;
    pendingWithdrawalsKobo: Kobo;
    pendingWithdrawalCount: number;
    activeCampaignBudgetKobo: Kobo;
    activeCampaignRemainingKobo: Kobo;
  };
  referrals: { total: number; qualified: number; pending: number; payoutKobo: Kobo };
  risk: { flaggedUsers: number; highRiskUsers: number; openSecurityEvents: number };
}
