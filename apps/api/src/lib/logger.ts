import pino from 'pino';
import { env, isProduction, isTest } from '../config/env';

/**
 * Structured logging.
 *
 * Redaction is defined here rather than at call sites, so a stray
 * `logger.info({ body })` cannot leak a PIN, token or private key into the log
 * stream even if someone forgets.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'pin', '*.pin', '*.currentPin', '*.newPin', '*.confirmPin',
      'pinHash', '*.pinHash',
      'initData', '*.initData',
      'token', '*.token', 'authorization', 'req.headers.authorization',
      'FIREBASE_PRIVATE_KEY', 'SESSION_SECRET', 'TELEGRAM_BOT_TOKEN', 'NASFAMPAY_API_KEY',
      '*.accountNumber',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino/file', options: { destination: 1 } } }),
});

export type Logger = typeof logger;
