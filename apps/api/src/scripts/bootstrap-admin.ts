/**
 * Ensure the primary admin record exists.
 *
 * Authorisation never depends on this row — `resolveAdmin` synthesises
 * SUPER_ADMIN for the primary Telegram id regardless, so the platform cannot
 * lock itself out. This script only makes the owner visible in the admin list.
 *
 * Run:  npm run bootstrap-admin --workspace @fundxtra/api
 */

import { Timestamp } from 'firebase-admin/firestore';
import { env } from '../config/env';
import { COLLECTIONS, db } from '../lib/firebase';
import { logger } from '../lib/logger';

async function main(): Promise<void> {
  const adminId = env.PRIMARY_ADMIN_TELEGRAM_ID;

  await db()
    .collection(COLLECTIONS.admins)
    .doc(adminId)
    .set(
      {
        telegramId: adminId,
        displayName: 'Fundxtra Owner',
        role: 'SUPER_ADMIN',
        extraPermissions: [],
        active: true,
        addedBy: null,
        createdAt: Timestamp.now(),
      },
      { merge: true },
    );

  logger.info({ adminId }, 'Primary admin record ensured');
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Bootstrap failed');
  process.exit(1);
});
