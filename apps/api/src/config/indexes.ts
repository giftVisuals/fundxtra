/**
 * Composite Firestore indexes this API requires.
 *
 * The single source of truth. `firebase/firestore.indexes.json` is generated
 * from this list by `npm run indexes:write --workspace @fundxtra/api`, and a
 * test fails if the two drift — so the file the Firebase CLI deploys and the
 * list the server creates for itself can never disagree.
 *
 * Why the server creates them at all: Firestore refuses a query whose
 * composite index does not exist, and a refused query took the wallet and
 * referrals screens down with it. Deploying indexes normally means running the
 * Firebase CLI, which needs a machine to run it on. The API already holds
 * service-account credentials, so it can create them through the Firestore
 * Admin API itself and no one has to.
 */

export interface IndexField {
  fieldPath: string;
  order?: 'ASCENDING' | 'DESCENDING';
  arrayConfig?: 'CONTAINS';
}

export interface RequiredIndex {
  collectionGroup: string;
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP';
  fields: IndexField[];
}

export const REQUIRED_INDEXES: readonly RequiredIndex[] = [
  {
    // Wallet transaction history, newest first, with the type filter.
    collectionGroup: 'transactions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Today's earnings: credits for one user since the start of the platform day.
    collectionGroup: 'transactions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'direction', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'ASCENDING' }],
  },
  {
    // Filtered transaction history by type.
    collectionGroup: 'transactions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'type', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Admin review queue by status, newest first.
    collectionGroup: 'taskSubmissions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'submittedAt', order: 'DESCENDING' }],
  },
  {
    // Per-task review queue.
    collectionGroup: 'taskSubmissions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'taskId', order: 'ASCENDING' }, { fieldPath: 'submittedAt', order: 'DESCENDING' }],
  },
  {
    // The oldest unreviewed submission, for the stale-work alert. One row.
    collectionGroup: 'taskSubmissions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'submittedAt', order: 'ASCENDING' }],
  },
  {
    // The oldest unpaid withdrawal, for the same alert.
    collectionGroup: 'withdrawals',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'requestedAt', order: 'ASCENDING' }],
  },
  {
    // Duplicate-submission guard: this user's pending submission for this task.
    collectionGroup: 'taskSubmissions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'taskId', order: 'ASCENDING' }, { fieldPath: 'status', order: 'ASCENDING' }],
  },
  {
    // The user's own withdrawal list, and the daily-limit window.
    collectionGroup: 'withdrawals',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'requestedAt', order: 'DESCENDING' }],
  },
  {
    // Admin withdrawal queue by status.
    collectionGroup: 'withdrawals',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'requestedAt', order: 'DESCENDING' }],
  },
  {
    // The whole-platform daily payout ceiling: what was paid today.
    collectionGroup: 'withdrawals',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'reviewedAt', order: 'ASCENDING' }],
  },
  {
    // A referrer's referral list.
    collectionGroup: 'referrals',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'referrerId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Referral velocity check: qualified referrals for one referrer in a window.
    collectionGroup: 'referrals',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'referrerId', order: 'ASCENDING' }, { fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'qualifiedAt', order: 'ASCENDING' }],
  },
  {
    // Task expiry sweep: active tasks whose end date has passed.
    collectionGroup: 'tasks',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'endsAt', order: 'ASCENDING' }],
  },
  {
    // The user's redemption history.
    collectionGroup: 'redemptions',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Audit log filtered by the object acted on.
    collectionGroup: 'auditLogs',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'targetId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Audit log filtered by the admin who acted.
    collectionGroup: 'auditLogs',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'actorId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Fraud dashboard: PIN failures across the platform in a recent window.
    collectionGroup: 'securityEvents',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'type', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'ASCENDING' }],
  },
  {
    // Security events for one account.
    collectionGroup: 'securityEvents',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
  {
    // Admin user browsing, and the flagged-accounts filter.
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }],
  },
];
