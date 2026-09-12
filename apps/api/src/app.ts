import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env, isProduction, readiness } from './config/env';
import { logger } from './lib/logger';
import { RATE_LIMITS } from './lib/rate-limit';
import { accessLog, requestContext } from './middleware/context';
import { errorHandler, notFoundHandler } from './middleware/error';
import { rateLimit } from './middleware/rate-limit';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { referralsRouter } from './routes/referrals';
import { tasksRouter } from './routes/tasks';
import { walletRouter } from './routes/wallet';
import { maintenanceGate } from './middleware/auth';

/**
 * Express application.
 *
 * Assembled separately from the server so tests can mount it with supertest
 * without binding a port.
 */
export function createApp(): Express {
  const app = express();

  // Railway terminates TLS and forwards; without this `req.ip` is the proxy's.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only, so a restrictive CSP costs nothing.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server calls arrive without an Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowed = env.CORS_ORIGINS;
        // Telegram renders the Mini App in a WebView on the app's own origin,
        // so the deployed web origins must be listed explicitly in production.
        if (allowed.length === 0 && !isProduction) {
          callback(null, true);
          return;
        }
        if (allowed.includes(origin)) {
          callback(null, true);
          return;
        }
        logger.warn({ origin }, 'Blocked a cross-origin request');
        callback(null, false);
      },
      credentials: false,
      maxAge: 86_400,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-RateLimit-Remaining'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(requestContext);
  app.use(accessLog);

  /**
   * Health and readiness.
   *
   * Deliberately unauthenticated and never rate limited, so a platform probe
   * always gets an answer. It reports *which* configuration is missing, because
   * a deploy that says why it is unhealthy is far easier to fix than one that
   * only crash-loops.
   */
  app.get('/health', (_req, res) => {
    const status = readiness();
    res.status(status.ready ? 200 : 503).json({
      ok: status.ready,
      service: 'fundxtra-api',
      environment: env.NODE_ENV,
      missingConfiguration: status.missing,
      warnings: status.warnings,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/', (_req, res) => {
    res.json({ service: 'fundxtra-api', docs: 'https://fundxtra.name.ng' });
  });

  // A broad per-IP ceiling under the per-route policies.
  app.use(rateLimit(RATE_LIMITS.general, { name: 'global', by: 'ip' }));

  // Public marketing endpoints: no session, and readable during maintenance so
  // the landing page can explain the outage rather than breaking.
  app.use('/public', publicRouter);

  app.use('/auth', authRouter);

  // Admin routes are mounted before the maintenance gate so operators can keep
  // working during an outage — usually to end it.
  app.use('/admin', adminRouter);

  app.use(maintenanceGate);
  app.use('/tasks', tasksRouter);
  app.use('/referrals', referralsRouter);
  app.use('/wallet', walletRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
