import { REQUIRED_INDEXES, type RequiredIndex } from '../config/indexes';
import { env } from '../config/env';
import { getApp } from './firebase';
import { logger } from './logger';

/**
 * Composite index provisioning.
 *
 * Firestore rejects a query whose composite index does not exist, and a
 * rejected query is not a degraded feature — it took the wallet and referrals
 * screens down entirely. Indexes are normally deployed with the Firebase CLI,
 * which needs a machine to run it on; this platform is operated from a phone.
 *
 * So the API creates them itself, through the Firestore Admin REST API, using
 * the service-account credentials it already holds. Nothing new to configure
 * and nothing for an operator to do.
 *
 * Three properties this has to have:
 *
 * 1. **Idempotent.** Creating an index that exists returns ALREADY_EXISTS,
 *    which is a success here, not an error.
 * 2. **Non-fatal.** A service account without index permissions must not stop
 *    the API from serving. The failure is logged with the manual alternative.
 * 3. **Asynchronous on Google's side.** Creation returns an operation that
 *    takes minutes to build. Queries keep failing until it finishes, so this
 *    reports what it started rather than claiming readiness.
 */

const FIRESTORE_ADMIN_ROOT = 'https://firestore.googleapis.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export interface IndexProvisionResult {
  created: number;
  existing: number;
  failed: number;
  skipped: string | null;
  failures: Array<{ collectionGroup: string; reason: string }>;
}

/**
 * An access token for the Firestore Admin API.
 *
 * Taken from the same credential the Admin SDK uses, so there is no second
 * secret and no second place for one to leak. The `datastore` scope that
 * credential already carries covers index administration.
 */
async function accessToken(): Promise<string | null> {
  try {
    const credential = getApp().options.credential;
    if (!credential || typeof credential.getAccessToken !== 'function') return null;
    const token = await credential.getAccessToken();
    return token.access_token;
  } catch (error) {
    logger.warn({ err: error }, 'Could not mint a Firestore Admin access token');
    return null;
  }
}

function indexUrl(projectId: string, collectionGroup: string): string {
  // The (default) database name is literal, parentheses included.
  return `${FIRESTORE_ADMIN_ROOT}/projects/${projectId}/databases/(default)/collectionGroups/${collectionGroup}/indexes`;
}

type CreateOutcome = 'created' | 'existing' | { error: string };

async function createIndex(
  token: string,
  projectId: string,
  index: RequiredIndex,
): Promise<CreateOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(indexUrl(projectId, index.collectionGroup), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      // `collectionGroup` is part of the URL, not the body.
      body: JSON.stringify({ queryScope: index.queryScope, fields: index.fields }),
      signal: controller.signal,
    });

    if (response.ok) return 'created';

    const body = (await response.json().catch(() => null)) as
      | { error?: { status?: string; message?: string } }
      | null;
    const status = body?.error?.status ?? String(response.status);
    const message = body?.error?.message ?? 'unknown error';

    // An index that already exists is the desired state.
    if (status === 'ALREADY_EXISTS' || response.status === 409) return 'existing';

    return { error: `${status}: ${message}` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'timed out' };
    }
    return { error: error instanceof Error ? error.message : 'network failure' };
  } finally {
    clearTimeout(timeout);
  }
}

/** Describes an index the way a log reader can match it to a query. */
function describe(index: RequiredIndex): string {
  const fields = index.fields
    .map((field) => `${field.fieldPath}${field.order === 'DESCENDING' ? ' desc' : ''}`)
    .join(', ');
  return `${index.collectionGroup}(${fields})`;
}

export async function ensureIndexes(): Promise<IndexProvisionResult> {
  const result: IndexProvisionResult = {
    created: 0,
    existing: 0,
    failed: 0,
    skipped: null,
    failures: [],
  };

  if (env.FIRESTORE_EMULATOR_HOST) {
    // The emulator serves any query without an index, so there is nothing to
    // create and the Admin API is not running.
    result.skipped = 'using the Firestore emulator';
    return result;
  }

  const token = await accessToken();
  if (!token) {
    result.skipped = 'no Firestore Admin access token could be minted';
    return result;
  }

  for (const index of REQUIRED_INDEXES) {
    const outcome = await createIndex(token, env.FIREBASE_PROJECT_ID, index);

    if (outcome === 'created') {
      result.created += 1;
      logger.info({ index: describe(index) }, 'Requested a Firestore index');
    } else if (outcome === 'existing') {
      result.existing += 1;
    } else {
      result.failed += 1;
      result.failures.push({ collectionGroup: describe(index), reason: outcome.error });
    }
  }

  if (result.failed > 0) {
    logger.error(
      {
        failures: result.failures,
        remedy:
          'Grant the service account the Cloud Datastore Index Admin role, or deploy firebase/firestore.indexes.json with the Firebase CLI.',
      },
      'Some Firestore indexes could not be created; queries that need them will keep failing',
    );
  }

  logger.info(
    { created: result.created, existing: result.existing, failed: result.failed, skipped: result.skipped },
    result.created > 0
      ? 'Firestore indexes requested; they take a few minutes to build before the queries that need them succeed'
      : 'Firestore indexes verified',
  );

  return result;
}
