import { Router } from 'express';
import { authenticated } from '../middleware/auth';
import { ok } from '../middleware/respond';
import { listLiveAnnouncements } from '../services/announcements';

/**
 * In-app announcements.
 *
 * Scheduling and audience filtering happen in the service at read time, so
 * this route returns exactly what is live for the Mini App right now.
 */
export const announcementsRouter = Router();

announcementsRouter.get('/', ...authenticated, async (_req, res, next) => {
  try {
    ok(res, { announcements: await listLiveAnnouncements('APP') });
  } catch (error) {
    next(error);
  }
});
