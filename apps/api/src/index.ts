import { createApp } from './app';
import { configureBot } from './lib/bot-setup';
import { env, readiness } from './config/env';
import { logger } from './lib/logger';

/**
 * Entry point.
 *
 * The process starts even when configuration is incomplete, so `/health` can
 * report what is missing. It logs the gap loudly instead of exiting, because a
 * container that boots and explains itself beats one that restarts forever.
 */
function main(): void {
  const status = readiness();
  if (!status.ready) {
    logger.error(
      { missing: status.missing },
      'Starting with incomplete configuration; authenticated routes will fail until it is set',
    );
  }
  for (const warning of status.warnings) logger.warn(warning);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV, ready: status.ready },
      'Fundxtra API listening',
    );

    // After the port is open, so the health check never waits on Telegram, and
    // so the webhook URL Telegram is told about is already being served.
    // Non-fatal by design: see lib/bot-setup.ts.
    void configureBot().catch((error: unknown) => {
      logger.error({ err: error }, 'Bot configuration failed');
    });
  });

  // Railway sends SIGTERM on redeploy; finish in-flight requests first so a
  // deploy cannot interrupt a transaction mid-commit.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close((error) => {
      if (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
      process.exit(0);
    });
    // Do not hang forever if a connection refuses to close.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception; exiting');
    process.exit(1);
  });
}

main();
