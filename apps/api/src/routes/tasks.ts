import { Router } from 'express';
import multer from 'multer';
import { completeTaskSchema, LIMITS } from '@fundxtra/shared';
import { AppError } from '../lib/errors';
import { RATE_LIMITS } from '../lib/rate-limit';
import { authenticated, pinProtected } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { ok } from '../middleware/respond';
import { parsed, pathParam, validateBody } from '../middleware/validate';
import { completeTask } from '../services/completions';
import { expireFinishedTasks, listTasksForUser, requireTask } from '../services/tasks';
import { storeProof } from '../services/uploads';
import { logger } from '../lib/logger';

/**
 * Task routes for the Mini App.
 *
 * The client never sends a reward amount, a task's budget, or a verification
 * result — only which task it is attempting and, where required, the proof.
 * Everything that decides whether money moves is read from the task document
 * server-side.
 */

export const tasksRouter = Router();

/** Screenshots are held in memory briefly, then streamed to Cloud Storage. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.MAX_PROOF_BYTES, files: 1 },
});

tasksRouter.get('/', ...authenticated, async (req, res, next) => {
  try {
    // Opportunistic sweep: cheap, indexed, and keeps ended campaigns out of the
    // list without needing a scheduler.
    void expireFinishedTasks().catch((error: unknown) =>
      logger.warn({ err: error }, 'Task expiry sweep failed'),
    );

    const tasks = await listTasksForUser(req.user!.id);
    ok(res, { tasks });
  } catch (error) {
    next(error);
  }
});

tasksRouter.get('/:taskId', ...authenticated, async (req, res, next) => {
  try {
    const task = await requireTask(pathParam(req, 'taskId'));
    const tasks = await listTasksForUser(req.user!.id);
    const item = tasks.find((entry) => entry.id === task.id);
    if (!item) {
      throw new AppError('TASK_UNAVAILABLE', { detail: `task ${task.id} not visible to user` });
    }
    ok(res, { task: item });
  } catch (error) {
    next(error);
  }
});

/**
 * Upload proof, returning a storage path the completion call then references.
 *
 * Splitting upload from completion keeps the completion request small and
 * retryable: a flaky connection during upload does not risk a partially
 * committed completion.
 */
tasksRouter.post(
  '/:taskId/proof',
  ...pinProtected,
  rateLimit(RATE_LIMITS.upload, { name: 'proof-upload', by: 'user' }),
  upload.single('proof'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError('VALIDATION_FAILED', {
          fields: { proof: 'Please attach your screenshot' },
        });
      }
      const task = await requireTask(pathParam(req, 'taskId'));
      const stored = await storeProof({
        userId: req.user!.id,
        taskId: task.id,
        buffer: file.buffer,
        declaredMimeType: file.mimetype,
      });
      ok(res, { proofPath: stored.path, bytes: stored.bytes });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Attempt a completion.
 *
 * PIN-protected: this is the endpoint that can move money into a balance, so it
 * requires the session to have been PIN-verified.
 */
tasksRouter.post(
  '/:taskId/complete',
  ...pinProtected,
  rateLimit(RATE_LIMITS.taskComplete, { name: 'task-complete', by: 'user' }),
  validateBody(completeTaskSchema),
  async (req, res, next) => {
    try {
      const input = parsed(res, completeTaskSchema);
      const outcome = await completeTask({
        user: req.user!,
        taskId: pathParam(req, 'taskId'),
        proofPath: input.proofPath,
        answer: input.answer,
        dwellSeconds: input.dwellSeconds,
      });
      ok(res, outcome);
    } catch (error) {
      next(error);
    }
  },
);
