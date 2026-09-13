import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { env, hasFirestore, serviceAccount } from '../config/env';
import { logger } from './logger';

/**
 * Firebase Admin access.
 *
 * The Admin SDK lives exclusively on the backend. The frontend never holds
 * these credentials and never writes to Firestore directly — every mutation
 * goes through an authenticated API route so it can be validated, rate limited,
 * audited, and made idempotent.
 */

let app: App | null = null;
let firestore: Firestore | null = null;

function initialise(): App {
  const existing = getApps();
  if (existing.length > 0 && existing[0]) return existing[0];

  if (env.FIRESTORE_EMULATOR_HOST) {
    // The emulator needs no credentials; the host env var is picked up by the SDK.
    logger.warn({ host: env.FIRESTORE_EMULATOR_HOST }, 'Using Firestore emulator');
    return initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
    });
  }

  if (!serviceAccount.ok) {
    // Carries the specific reason — missing variable, bad JSON, or a
    // private_key that is not a PEM key — rather than a generic message.
    throw new Error(
      serviceAccount.source === 'none'
        ? 'Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT to the service-account JSON from the Firebase console.'
        : serviceAccount.reason,
    );
  }

  const { account } = serviceAccount;

  return initializeApp({
    // Newline normalisation already happened in resolveServiceAccount, which
    // handles every shape a dashboard or shell can leave a PEM key in.
    credential: cert({
      projectId: account.projectId,
      clientEmail: account.clientEmail,
      privateKey: account.privateKey,
    }),
    projectId: account.projectId,
  });
}

export function getApp(): App {
  if (!app) app = initialise();
  return app;
}

export function db(): Firestore {
  if (!firestore) {
    firestore = getFirestore(getApp());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

/** True when Firestore is configured. Routes degrade gracefully when false. */
export const firestoreAvailable = hasFirestore;

/** Collection names in one place, so a typo cannot create a phantom collection. */
export const COLLECTIONS = {
  users: 'users',
  pins: 'pins',
  tasks: 'tasks',
  taskSubmissions: 'taskSubmissions',
  taskCompletions: 'taskCompletions',
  transactions: 'transactions',
  referrals: 'referrals',
  withdrawals: 'withdrawals',
  redemptions: 'redemptions',
  rewardProducts: 'rewardProducts',
  admins: 'admins',
  adminInvites: 'adminInvites',
  auditLogs: 'auditLogs',
  securityEvents: 'securityEvents',
  announcements: 'announcements',
  systemSettings: 'systemSettings',
  idempotencyKeys: 'idempotencyKeys',
  counters: 'counters',
} as const;

/** Singleton document ids. */
export const DOC_IDS = {
  settings: 'global',
  publicStats: 'publicStats',
  /** Per-channel signup tallies, so attribution needs no query. */
  signupSources: 'signupSources',
} as const;
