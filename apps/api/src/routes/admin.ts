import { Router } from 'express';
import {
  addAdminSchema,
  announcementSchema,
  balanceAdjustmentSchema,
  canAssignRole,
  createTaskSchema,
  effectivePermissions,
  formatNaira,
  paginationSchema,
  reviewSubmissionSchema,
  rewardProductSchema,
  submissionListSchema,
  systemSettingsUpdateSchema,
  taskStatusChangeSchema,
  updateAdminSchema,
  updateTaskSchema,
  userSearchSchema,
  userStatusChangeSchema,
  withdrawalDecisionSchema,
  withdrawalListSchema,
  type Kobo,
  type WithdrawalStatus,
} from '@fundxtra/shared';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { COLLECTIONS, db } from '../lib/firebase';
import { AppError, forbidden, notFound } from '../lib/errors';
import { adminOnly, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/respond';
import { parsed, pathParam, query, validateBody, validateQuery } from '../middleware/validate';
import {
  createInvite,
  isPrimaryAdmin,
  listAdmins,
  listPendingInvites,
  removeAdmin,
  updateAdmin,
  upsertAdmin,
} from '../services/admins';
import { adjustBalance, adminDashboard, changeUserStatus, getUserDetail, searchUsers } from '../services/admin-users';
import { listAuditLogs, recordAudit } from '../services/audit';
import { resetPinByAdmin, unlockPin } from '../services/auth';
import { findSubmission, listSubmissions, reviewSubmission } from '../services/completions';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAllAnnouncements,
  updateAnnouncement,
} from '../services/announcements';
import { reconcilePendingRedemptions } from '../services/rewards';
import { listSecurityEvents } from '../services/security';
import { getSettings, updateSettings } from '../services/settings';
import { recomputeStats } from '../services/stats';
import { createTask, listAllTasks, requireTask, setTaskStatus, updateTask } from '../services/tasks';
import { signedProofUrl } from '../services/uploads';
import { clearFlag, requireUser } from '../services/users';
import { listWithdrawals, transitionWithdrawal } from '../services/withdrawals';
import { auditUserBalance } from '../services/ledger';
import { provider } from '../providers';
import { NasfamPayProvider } from '../providers/nasfampay';
import { env } from '../config/env';

/**
 * Admin routes.
 *
 * Every route declares the permission it needs. No handler compares a role
 * string, so adding a role or shifting a capability is a change in
 * `packages/shared/src/permissions.ts` rather than an audit of this file.
 *
 * Financial and structural actions write an audit record before they take
 * effect, and `recordAudit` throws for those actions — so a failure to record
 * aborts the change instead of performing it invisibly.
 */

export const adminRouter = Router();

// Every route below requires a verified session that resolves to an admin.
adminRouter.use(...adminOnly);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

adminRouter.get('/dashboard', requirePermission('users:view'), async (req, res, next) => {
  try {
    const [stats, settings] = await Promise.all([adminDashboard(), getSettings()]);
    const active = provider();
    const nasfampay = new NasfamPayProvider();

    ok(res, {
      stats,
      admin: {
        telegramId: req.admin!.telegramId,
        displayName: req.admin!.displayName,
        role: req.admin!.role,
        permissions: effectivePermissions(req.admin!.role, req.admin!.extraPermissions),
        isPrimary: isPrimaryAdmin(req.admin!.telegramId),
      },
      settings,
      // Surfaced so an operator can see at a glance why rewards are not live.
      provider: {
        name: active.name,
        configured: active.configured,
        capabilities: active.capabilities(),
        nasfampay: {
          implemented: false,
          hasCredentials: nasfampay.hasCredentials,
          note: 'NasfamPay public API is still in development. Rewards stay "coming soon" until it launches.',
        },
      },
      environment: {
        nodeEnv: env.NODE_ENV,
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
        devAuthEnabled: env.ALLOW_DEV_AUTH,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

adminRouter.get(
  '/users',
  requirePermission('users:view'),
  validateQuery(userSearchSchema),
  async (_req, res, next) => {
    try {
      const options = query<{
        q?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED'; flagged?: boolean;
        limit: number; cursor?: string;
      }>(res);
      ok(res, await searchUsers(options));
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get('/users/:userId', requirePermission('users:view'), async (req, res, next) => {
  try {
    ok(res, await getUserDetail(pathParam(req, 'userId')));
  } catch (error) {
    next(error);
  }
});

/** Recompute a balance from the ledger — the dispute-investigation tool. */
adminRouter.get(
  '/users/:userId/balance-audit',
  requirePermission('users:view'),
  async (req, res, next) => {
    try {
      ok(res, await auditUserBalance(pathParam(req, 'userId')));
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/users/:userId/status',
  requirePermission('users:manage'),
  validateBody(userStatusChangeSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, userStatusChangeSchema);
      const user = await changeUserStatus({
        userId: pathParam(req, 'userId'),
        status: input.status,
        reason: input.reason,
        actor: req.admin!,
        ip: req.clientIp,
      });
      ok(res, { user });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Manual balance adjustment.
 *
 * Requires `finance:adjust`, which only a super admin holds. The reason is
 * mandatory and the audit record is written first.
 */
adminRouter.post(
  '/users/:userId/adjust-balance',
  requirePermission('finance:adjust'),
  validateBody(balanceAdjustmentSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, balanceAdjustmentSchema);
      const result = await adjustBalance({
        userId: pathParam(req, 'userId'),
        amountKobo: input.amountKobo,
        reason: input.reason,
        actor: req.admin!,
        ip: req.clientIp,
      });
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

/** Reset a PIN. The hash is deleted, never set to a value an admin knows. */
adminRouter.post(
  '/users/:userId/reset-pin',
  requirePermission('users:manage'),
  async (req, res, next) => {
    try {
      const userId = pathParam(req, 'userId');
      const user = await requireUser(userId);

      await recordAudit({
        action: 'USER_PIN_RESET',
        actor: req.admin!,
        targetType: 'user',
        targetId: userId,
        summary: `PIN reset for ${user.firstName}`,
        reason: 'Requested through support',
        ip: req.clientIp,
      });
      await resetPinByAdmin(userId, req.admin!.telegramId);
      ok(res, { reset: true });
    } catch (error) {
      next(error);
    }
  },
);

/** Clear a lockout without touching the PIN. */
adminRouter.post(
  '/users/:userId/unlock-pin',
  requirePermission('users:manage'),
  async (req, res, next) => {
    try {
      const userId = pathParam(req, 'userId');
      await unlockPin(userId, req.admin!.telegramId);
      ok(res, { unlocked: true });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/users/:userId/clear-flag',
  requirePermission('users:manage'),
  async (req, res, next) => {
    try {
      const userId = pathParam(req, 'userId');
      const flag = String((req.body as { flag?: string }).flag ?? '');
      if (!flag) {
        throw new AppError('VALIDATION_FAILED', { fields: { flag: 'Name the flag to clear' } });
      }
      await clearFlag(userId, flag as never);
      await recordAudit({
        action: 'USER_UNFLAGGED',
        actor: req.admin!,
        targetType: 'user',
        targetId: userId,
        summary: `Cleared the ${flag} flag`,
        ip: req.clientIp,
      });
      ok(res, { cleared: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

adminRouter.get('/tasks', requirePermission('tasks:manage'), async (_req, res, next) => {
  try {
    ok(res, { tasks: await listAllTasks() });
  } catch (error) {
    next(error);
  }
});

adminRouter.post(
  '/tasks',
  requirePermission('tasks:manage'),
  validateBody(createTaskSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, createTaskSchema);
      const task = await createTask(input, req.admin!.telegramId);

      await recordAudit({
        action: 'TASK_CREATED',
        actor: req.admin!,
        targetType: 'task',
        targetId: task.id,
        summary: `Created "${task.title}" at ${formatNaira(task.rewardKobo)} on a ${formatNaira(task.budgetKobo)} budget`,
        after: { rewardKobo: task.rewardKobo, budgetKobo: task.budgetKobo, status: task.status },
        ip: req.clientIp,
      });
      ok(res, { task }, 201);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  '/tasks/:taskId',
  requirePermission('tasks:manage'),
  validateBody(updateTaskSchema),
  async (req, res, next) => {
    try {
      const taskId = pathParam(req, 'taskId');
      const input = parsed(res, updateTaskSchema);
      const before = await requireTask(taskId);
      const task = await updateTask(taskId, input as Record<string, unknown>);

      await recordAudit({
        action: 'TASK_UPDATED',
        actor: req.admin!,
        targetType: 'task',
        targetId: taskId,
        summary: `Updated "${task.title}"`,
        before: { rewardKobo: before.rewardKobo, budgetKobo: before.budgetKobo },
        after: { rewardKobo: task.rewardKobo, budgetKobo: task.budgetKobo },
        ip: req.clientIp,
      });
      ok(res, { task });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/tasks/:taskId/status',
  requirePermission('tasks:manage'),
  validateBody(taskStatusChangeSchema),
  async (req, res, next) => {
    try {
      const taskId = pathParam(req, 'taskId');
      const input = parsed(res, taskStatusChangeSchema);
      const before = await requireTask(taskId);
      const task = await setTaskStatus(taskId, input.status);

      await recordAudit({
        action: 'TASK_STATUS_CHANGED',
        actor: req.admin!,
        targetType: 'task',
        targetId: taskId,
        summary: `"${task.title}" set to ${input.status}`,
        before: { status: before.status },
        after: { status: input.status },
        reason: input.reason ?? null,
        ip: req.clientIp,
      });
      ok(res, { task });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

adminRouter.get(
  '/submissions',
  requirePermission('submissions:review'),
  validateQuery(submissionListSchema),
  async (_req, res, next) => {
    try {
      const options = query<{
        status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
        taskId?: string; limit: number; cursor?: string;
      }>(res);
      const page = await listSubmissions(options);

      // Signed URLs are minted per request and expire, so the bucket stays
      // private and a link cannot be forwarded indefinitely.
      const items = await Promise.all(
        page.items.map(async (submission) => ({
          ...submission,
          proofUrl: submission.proofPath ? await signedProofUrl(submission.proofPath) : null,
        })),
      );
      ok(res, { items, nextCursor: page.nextCursor });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/submissions/:submissionId',
  requirePermission('submissions:review'),
  async (req, res, next) => {
    try {
      const submission = await findSubmission(pathParam(req, 'submissionId'));
      if (!submission) throw notFound('that submission');

      const [task, user] = await Promise.all([
        requireTask(submission.taskId).catch(() => null),
        requireUser(submission.userId).catch(() => null),
      ]);

      ok(res, {
        submission: {
          ...submission,
          proofUrl: submission.proofPath ? await signedProofUrl(submission.proofPath) : null,
        },
        task,
        user,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/submissions/:submissionId/review',
  requirePermission('submissions:review'),
  validateBody(reviewSubmissionSchema),
  async (req, res, next) => {
    try {
      const submissionId = pathParam(req, 'submissionId');
      const input = parsed(res, reviewSubmissionSchema);

      const result = await reviewSubmission({
        submissionId,
        decision: input.decision,
        reason: input.reason,
        reviewerId: req.admin!.telegramId,
      });

      await recordAudit({
        action: input.decision === 'APPROVE' ? 'SUBMISSION_APPROVED' : 'SUBMISSION_REJECTED',
        actor: req.admin!,
        targetType: 'submission',
        targetId: submissionId,
        summary:
          input.decision === 'APPROVE'
            ? `Approved a submission worth ${formatNaira(result.rewardKobo)}`
            : 'Rejected a submission',
        after: { status: result.status, transactionId: result.transactionId },
        reason: input.reason ?? null,
        ip: req.clientIp,
      });
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

adminRouter.get(
  '/withdrawals',
  requirePermission('withdrawals:view'),
  validateQuery(withdrawalListSchema),
  async (_req, res, next) => {
    try {
      const options = query<{ status?: WithdrawalStatus; limit: number; cursor?: string }>(res);
      ok(res, await listWithdrawals(options));
    } catch (error) {
      next(error);
    }
  },
);

const DECISION_TO_STATUS: Record<string, WithdrawalStatus> = {
  APPROVE: 'PROCESSING',
  REJECT: 'REJECTED',
  COMPLETE: 'COMPLETED',
  FAIL: 'FAILED',
};

adminRouter.post(
  '/withdrawals/:withdrawalId/decision',
  requirePermission('withdrawals:process'),
  validateBody(withdrawalDecisionSchema),
  async (req, res, next) => {
    try {
      const withdrawalId = pathParam(req, 'withdrawalId');
      const input = parsed(res, withdrawalDecisionSchema);
      const status = DECISION_TO_STATUS[input.decision];
      if (!status) {
        throw new AppError('VALIDATION_FAILED', { fields: { decision: 'Unknown decision' } });
      }

      const auditAction =
        input.decision === 'APPROVE'
          ? 'WITHDRAWAL_APPROVED'
          : input.decision === 'REJECT'
            ? 'WITHDRAWAL_REJECTED'
            : input.decision === 'COMPLETE'
              ? 'WITHDRAWAL_COMPLETED'
              : 'WITHDRAWAL_FAILED';

      const withdrawal = await transitionWithdrawal({
        withdrawalId,
        status,
        actorAdminId: req.admin!.telegramId,
        reason: input.reason,
        providerReference: input.providerReference,
      });

      await recordAudit({
        action: auditAction,
        actor: req.admin!,
        targetType: 'withdrawal',
        targetId: withdrawalId,
        summary: `${formatNaira(withdrawal.amountKobo)} withdrawal set to ${status}`,
        after: { status, providerReference: input.providerReference ?? null },
        reason: input.reason ?? null,
        ip: req.clientIp,
      });
      ok(res, { withdrawal });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

adminRouter.post(
  '/rewards/products',
  requirePermission('rewards:manage'),
  validateBody(rewardProductSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, rewardProductSchema);
      const id = `${input.kind.toLowerCase()}-${Date.now().toString(36)}`;
      const now = Timestamp.now();

      await db()
        .collection(COLLECTIONS.rewardProducts)
        .doc(id)
        .create({ ...input, createdAt: now, updatedAt: now });

      await recordAudit({
        action: 'REWARD_PRODUCT_CREATED',
        actor: req.admin!,
        targetType: 'rewardProduct',
        targetId: id,
        summary: `Created reward "${input.name}" at ${formatNaira(input.priceKobo as Kobo)}`,
        ip: req.clientIp,
      });
      ok(res, { id }, 201);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  '/rewards/products/:productId',
  requirePermission('rewards:manage'),
  validateBody(rewardProductSchema.partial()),
  async (req, res, next) => {
    try {
      const productId = pathParam(req, 'productId');
      const input = parsed(res, rewardProductSchema.partial());

      await db()
        .collection(COLLECTIONS.rewardProducts)
        .doc(productId)
        .update({ ...input, updatedAt: Timestamp.now() });

      await recordAudit({
        action: 'REWARD_PRODUCT_UPDATED',
        actor: req.admin!,
        targetType: 'rewardProduct',
        targetId: productId,
        summary: `Updated reward ${productId}`,
        after: input as Record<string, unknown>,
        ip: req.clientIp,
      });
      ok(res, { updated: true });
    } catch (error) {
      next(error);
    }
  },
);

/** Resolve redemptions the provider left in an unknown state. */
adminRouter.post(
  '/rewards/reconcile',
  requirePermission('rewards:manage'),
  async (_req, res, next) => {
    try {
      ok(res, await reconcilePendingRedemptions());
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

adminRouter.get('/settings', requirePermission('settings:manage'), async (_req, res, next) => {
  try {
    ok(res, { settings: await getSettings({ fresh: true }) });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch(
  '/settings',
  requirePermission('settings:manage'),
  validateBody(systemSettingsUpdateSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, systemSettingsUpdateSchema);
      const { reason, ...patch } = input;
      const before = await getSettings({ fresh: true });

      await recordAudit({
        action: patch.withdrawals?.enabled !== undefined ? 'WITHDRAWALS_TOGGLED' : 'SETTINGS_UPDATED',
        actor: req.admin!,
        targetType: 'systemSettings',
        targetId: 'global',
        summary: describeSettingsChange(patch),
        before: before as unknown as Record<string, unknown>,
        after: patch as Record<string, unknown>,
        reason: reason ?? null,
        ip: req.clientIp,
      });

      const settings = await updateSettings(patch as Record<string, unknown>, req.admin!.telegramId);
      ok(res, { settings });
    } catch (error) {
      next(error);
    }
  },
);

function describeSettingsChange(patch: Record<string, unknown>): string {
  const parts: string[] = [];
  const withdrawals = patch.withdrawals as { enabled?: boolean } | undefined;
  if (withdrawals?.enabled === true) parts.push('opened withdrawals');
  if (withdrawals?.enabled === false) parts.push('closed withdrawals');
  const tasks = patch.tasks as { earningEnabled?: boolean } | undefined;
  if (tasks?.earningEnabled === false) parts.push('paused task earning');
  if (tasks?.earningEnabled === true) parts.push('resumed task earning');
  const platform = patch.platform as { maintenanceMode?: boolean } | undefined;
  if (platform?.maintenanceMode === true) parts.push('enabled maintenance mode');
  if (platform?.maintenanceMode === false) parts.push('disabled maintenance mode');

  return parts.length > 0
    ? `Settings updated: ${parts.join(', ')}`
    : `Settings updated (${Object.keys(patch).join(', ')})`;
}

adminRouter.post('/stats/recompute', requirePermission('settings:manage'), async (_req, res, next) => {
  try {
    ok(res, { stats: await recomputeStats() });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

adminRouter.get(
  '/announcements',
  requirePermission('announcements:manage'),
  async (_req, res, next) => {
    try {
      ok(res, { announcements: await listAllAnnouncements() });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/announcements',
  requirePermission('announcements:manage'),
  validateBody(announcementSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, announcementSchema);
      const announcement = await createAnnouncement(input, req.admin!.telegramId);
      await recordAudit({
        action: 'ANNOUNCEMENT_CREATED',
        actor: req.admin!,
        targetType: 'announcement',
        targetId: announcement.id,
        summary: `Created announcement "${announcement.title}"`,
        ip: req.clientIp,
      });
      ok(res, { announcement }, 201);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  '/announcements/:announcementId',
  requirePermission('announcements:manage'),
  validateBody(announcementSchema.partial()),
  async (req, res, next) => {
    try {
      const announcementId = pathParam(req, 'announcementId');
      await updateAnnouncement(announcementId, parsed(res, announcementSchema.partial()));
      await recordAudit({
        action: 'ANNOUNCEMENT_UPDATED',
        actor: req.admin!,
        targetType: 'announcement',
        targetId: announcementId,
        summary: `Updated announcement ${announcementId}`,
        ip: req.clientIp,
      });
      ok(res, { updated: true });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.delete(
  '/announcements/:announcementId',
  requirePermission('announcements:manage'),
  async (req, res, next) => {
    try {
      const announcementId = pathParam(req, 'announcementId');
      await deleteAnnouncement(announcementId);
      await recordAudit({
        action: 'ANNOUNCEMENT_DELETED',
        actor: req.admin!,
        targetType: 'announcement',
        targetId: announcementId,
        summary: `Deleted announcement ${announcementId}`,
        ip: req.clientIp,
      });
      ok(res, { deleted: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

adminRouter.get('/admins', requirePermission('admins:manage'), async (_req, res, next) => {
  try {
    const [admins, invites] = await Promise.all([listAdmins(), listPendingInvites()]);
    ok(res, { admins, invites });
  } catch (error) {
    next(error);
  }
});

/**
 * Add an admin.
 *
 * A Telegram id creates the admin immediately. A username can only create a
 * *pending invite*, claimed when that username next signs in — usernames are
 * reassignable, so treating one as an identity would be a privilege-escalation
 * path if the handle ever changed hands.
 */
adminRouter.post(
  '/admins',
  requirePermission('admins:manage'),
  validateBody(addAdminSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, addAdminSchema);
      const actor = req.admin!;

      if (!canAssignRole(actor.role, input.role)) {
        throw forbidden(`${actor.role} cannot assign the ${input.role} role`);
      }

      if (input.telegramId) {
        const admin = await upsertAdmin({
          telegramId: input.telegramId,
          username: input.username ?? null,
          displayName: input.displayName,
          role: input.role,
          extraPermissions: input.extraPermissions,
          addedBy: actor.telegramId,
        });
        await recordAudit({
          action: 'ADMIN_ADDED',
          actor,
          targetType: 'admin',
          targetId: admin.telegramId,
          summary: `Added ${admin.displayName} as ${admin.role}`,
          after: { role: admin.role, extraPermissions: admin.extraPermissions },
          ip: req.clientIp,
        });
        ok(res, { admin }, 201);
        return;
      }

      const invite = await createInvite({
        username: input.username as string,
        displayName: input.displayName,
        role: input.role,
        extraPermissions: input.extraPermissions,
        invitedBy: actor.telegramId,
      });
      await recordAudit({
        action: 'ADMIN_ADDED',
        actor,
        targetType: 'adminInvite',
        targetId: invite.username,
        summary: `Invited @${invite.username} as ${invite.role} (pending first sign-in)`,
        ip: req.clientIp,
      });
      ok(res, { invite }, 201);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  '/admins/:telegramId',
  requirePermission('admins:manage'),
  validateBody(updateAdminSchema),
  async (req, res, next) => {
    try {
      const telegramId = pathParam(req, 'telegramId');
      const input = parsed(res, updateAdminSchema);
      const actor = req.admin!;

      if (isPrimaryAdmin(telegramId)) {
        throw forbidden('The primary admin cannot be modified');
      }
      if (input.role && !canAssignRole(actor.role, input.role)) {
        throw forbidden(`${actor.role} cannot assign the ${input.role} role`);
      }

      await updateAdmin(telegramId, input);
      await recordAudit({
        action: 'ADMIN_UPDATED',
        actor,
        targetType: 'admin',
        targetId: telegramId,
        summary: `Updated admin ${telegramId}`,
        after: input as Record<string, unknown>,
        ip: req.clientIp,
      });
      ok(res, { updated: true });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.delete(
  '/admins/:telegramId',
  requirePermission('admins:manage'),
  async (req, res, next) => {
    try {
      const telegramId = pathParam(req, 'telegramId');
      const actor = req.admin!;

      if (isPrimaryAdmin(telegramId)) throw forbidden('The primary admin cannot be removed');
      if (telegramId === actor.telegramId) throw forbidden('You cannot remove your own access');

      await removeAdmin(telegramId);
      await recordAudit({
        action: 'ADMIN_REMOVED',
        actor,
        targetType: 'admin',
        targetId: telegramId,
        summary: `Removed admin ${telegramId}`,
        ip: req.clientIp,
      });
      ok(res, { removed: true });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Audit and security
// ---------------------------------------------------------------------------

/** Query shapes for the two read-only investigation endpoints. */
const auditQuerySchema = paginationSchema.extend({
  targetId: z.string().trim().max(200).optional(),
  actorId: z.string().trim().max(200).optional(),
});

const securityQuerySchema = paginationSchema.extend({
  userId: z.string().trim().max(200).optional(),
  severity: z.enum(['INFO', 'WARN', 'CRITICAL']).optional(),
});

adminRouter.get(
  '/audit',
  requirePermission('audit:view'),
  validateQuery(auditQuerySchema),
  async (_req, res, next) => {
    try {
      const options = query<{
        limit: number; cursor?: string; targetId?: string; actorId?: string;
      }>(res);
      ok(res, await listAuditLogs(options));
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  '/security-events',
  requirePermission('audit:view'),
  validateQuery(securityQuerySchema),
  async (_req, res, next) => {
    try {
      const options = query<{
        limit: number; userId?: string; severity?: 'INFO' | 'WARN' | 'CRITICAL';
      }>(res);
      ok(res, { events: await listSecurityEvents(options) });
    } catch (error) {
      next(error);
    }
  },
);
