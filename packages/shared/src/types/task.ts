import type { Kobo } from '../money';
import type { IsoDate } from './common';

export type TaskStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'COMPLETED';

export type TaskCategory =
  | 'TELEGRAM'
  | 'SOCIAL'
  | 'APP_INSTALL'
  | 'SURVEY'
  | 'CONTENT'
  | 'SIGNUP'
  | 'OTHER';

/**
 * How a completion is proven.
 *
 * - `TELEGRAM_MEMBERSHIP` is checked server-side with the Bot API `getChatMember`
 *   method. It requires the Fundxtra bot to be a member (and for most channels an
 *   administrator) of the target chat; if it is not, the task surfaces an admin
 *   configuration warning rather than silently approving anyone.
 * - `SCREENSHOT` requires an uploaded image and an explicit admin decision.
 *   No reward is credited before approval.
 * - `MANUAL_REVIEW` is a screenshot-less human check (e.g. a submitted username).
 * - `HONOUR` credits on click. It exists only for zero-cost tasks and is capped
 *   by the same budget machinery; admins are warned in the UI when they pick it.
 */
export type VerificationMethod =
  | 'TELEGRAM_MEMBERSHIP'
  | 'SCREENSHOT'
  | 'MANUAL_REVIEW'
  | 'HONOUR';

export interface TaskSponsor {
  name: string;
  /** Optional logo URL. Rendered with a fallback monogram when absent. */
  logoUrl: string | null;
  /** Shown as "Sponsored by …" on the task card when present. */
  verified: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  instructions: string[];
  category: TaskCategory;
  status: TaskStatus;

  rewardKobo: Kobo;
  /** Total campaign budget. */
  budgetKobo: Kobo;
  /** Budget already committed (approved completions + pending submissions). */
  spentKobo: Kobo;
  /** Hard cap on completions, derived from budget/reward at creation but stored. */
  maxCompletions: number;
  completionCount: number;
  /** Completions awaiting an admin decision; they hold budget. */
  pendingCount: number;
  /** How many times one user may complete this task. Usually 1. */
  perUserLimit: number;

  verification: VerificationMethod;
  requiresProof: boolean;
  /** External destination the user must visit. */
  targetUrl: string | null;
  /**
   * For `TELEGRAM_MEMBERSHIP`: the chat to check, as `@publicname` or a numeric
   * `-100…` id. Never rendered to users raw — the UI shows a friendly label.
   */
  telegramChatId: string | null;
  telegramChatLabel: string | null;
  /** Set when the bot lacks the access needed to verify. Admin-facing. */
  verificationWarning: string | null;

  sponsor: TaskSponsor | null;
  startsAt: IsoDate | null;
  endsAt: IsoDate | null;
  /** Seconds a user must wait after opening before submitting. Anti-bot. */
  minimumDwellSeconds: number;
  sortWeight: number;

  createdBy: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/** Budget view shared with users — the campaign progress card. */
export interface TaskBudgetView {
  rewardKobo: Kobo;
  budgetKobo: Kobo;
  spentKobo: Kobo;
  remainingKobo: Kobo;
  completionCount: number;
  maxCompletions: number;
  /** 0..100. */
  percentClaimed: number;
}

/** A task as the Mini App sees it, including this user's own state. */
export interface TaskListItem {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  rewardKobo: Kobo;
  verification: VerificationMethod;
  requiresProof: boolean;
  targetUrl: string | null;
  telegramChatLabel: string | null;
  instructions: string[];
  sponsor: TaskSponsor | null;
  budget: TaskBudgetView;
  endsAt: IsoDate | null;
  minimumDwellSeconds: number;
  /** This user's relationship to the task. */
  userState: 'AVAILABLE' | 'PENDING_REVIEW' | 'COMPLETED' | 'REJECTED' | 'UNAVAILABLE';
  /** Set when `userState` is REJECTED. */
  rejectionReason: string | null;
}

export type SubmissionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface TaskSubmission {
  id: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  userTelegramId: string;
  username: string | null;
  status: SubmissionStatus;
  rewardKobo: Kobo;
  /** Storage path of the proof image. Served to admins through a signed URL. */
  proofPath: string | null;
  /** Free-text answer for MANUAL_REVIEW tasks. */
  answer: string | null;
  reviewedBy: string | null;
  reviewedAt: IsoDate | null;
  rejectionReason: string | null;
  /** Transaction id created on approval. Guards against double credit. */
  transactionId: string | null;
  submittedAt: IsoDate;
}

/**
 * One row per (user, task) pair, created inside the crediting transaction.
 * Its deterministic id is the uniqueness constraint that makes a duplicate
 * completion impossible even under concurrent requests.
 */
export interface TaskCompletion {
  id: string;
  taskId: string;
  userId: string;
  rewardKobo: Kobo;
  transactionId: string;
  verification: VerificationMethod;
  completedAt: IsoDate;
}
