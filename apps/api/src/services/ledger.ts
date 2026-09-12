import { FieldValue, Timestamp, type Transaction as FirestoreTransaction } from 'firebase-admin/firestore';
import {
  CREDIT_TYPES,
  DEBIT_TYPES,
  ERROR_CODES,
  assertKobo,
  assertPositiveKobo,
  type Kobo,
  type Transaction,
  type TransactionRow,
  type TransactionStatus,
  type TransactionType,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { AppError, internal, notFound } from '../lib/errors';
import { newTransactionId } from '../lib/ids';
import { logger } from '../lib/logger';
import { nowIso, startOfPlatformDay, toIsoRequired } from '../lib/time';

/**
 * The ledger.
 *
 * Two rules govern every function in this file, and together they are what make
 * the balance trustworthy:
 *
 * 1. **A balance never moves outside a Firestore transaction.** The user
 *    document's `balanceKobo` is a *cache*; the authoritative record is the
 *    immutable row in `transactions`. Both are written in the same atomic
 *    commit, so the two can never disagree.
 *
 * 2. **Every movement carries an idempotency key.** The key is written as a
 *    document via `create()` *inside the same transaction*. Firestore fails a
 *    `create()` on an existing document, so a retried request — a double tap, a
 *    network retry, a webhook redelivery — reuses the original transaction
 *    instead of creating a second one. This is the whole double-credit defence,
 *    and it is enforced by the database rather than by a check-then-act read
 *    that a concurrent request could slip between.
 */

export interface PostEntryInput {
  userId: string;
  type: TransactionType;
  /** Always positive. Direction is derived from `type`. */
  amountKobo: Kobo;
  description: string;
  /** Caller-supplied key that uniquely names this *intent*. */
  idempotencyKey: string;
  reference?: string | null;
  status?: TransactionStatus;
  actorAdminId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  /** Signed adjustments (ADMIN_ADJUSTMENT) set the direction explicitly. */
  direction?: 'CREDIT' | 'DEBIT';
  /** Allow the balance to go negative. Only ever used by admin adjustments. */
  allowNegativeBalance?: boolean;
  /** REVERSAL entries point back at what they undo. */
  reversalOf?: string | null;
}

export interface PostEntryResult {
  transaction: Transaction;
  balanceAfterKobo: Kobo;
  /** True when the key had already been used and the original row was returned. */
  replayed: boolean;
}

function directionFor(type: TransactionType, explicit?: 'CREDIT' | 'DEBIT'): 'CREDIT' | 'DEBIT' {
  if (explicit) return explicit;
  if (CREDIT_TYPES.includes(type)) return 'CREDIT';
  if (DEBIT_TYPES.includes(type)) return 'DEBIT';
  throw internal(`Transaction type ${type} has no implied direction; pass one explicitly`);
}

/**
 * Post a ledger entry and move the balance, atomically and idempotently.
 *
 * The caller may pass its own Firestore transaction (`existing`) so a reward
 * credit and a task-completion record commit together as one unit. When it does
 * not, a transaction is opened here.
 */
export async function postEntry(input: PostEntryInput): Promise<PostEntryResult> {
  return db().runTransaction((tx) => postEntryIn(tx, input));
}

/** `postEntry` inside a caller-owned Firestore transaction. */
export async function postEntryIn(
  tx: FirestoreTransaction,
  input: PostEntryInput,
): Promise<PostEntryResult> {
  const amount = assertPositiveKobo(input.amountKobo, 'transaction amount');
  const direction = directionFor(input.type, input.direction);
  const signed = direction === 'CREDIT' ? amount : -amount;

  const firestore = db();
  const keyRef = firestore.collection(COLLECTIONS.idempotencyKeys).doc(input.idempotencyKey);
  const userRef = firestore.collection(COLLECTIONS.users).doc(input.userId);

  // Read the key first. If this intent was already executed, return the original
  // row rather than creating a second one.
  const keySnapshot = await tx.get(keyRef);
  if (keySnapshot.exists) {
    const existingTransactionId = keySnapshot.get('transactionId') as string | undefined;
    if (!existingTransactionId) {
      throw internal(`Idempotency key ${input.idempotencyKey} exists without a transaction id`);
    }
    const existingSnapshot = await tx.get(
      firestore.collection(COLLECTIONS.transactions).doc(existingTransactionId),
    );
    if (!existingSnapshot.exists) {
      throw internal(`Idempotency key points at missing transaction ${existingTransactionId}`);
    }
    const transaction = mapTransaction(existingSnapshot.id, existingSnapshot.data() ?? {});
    return {
      transaction,
      balanceAfterKobo: transaction.balanceAfterKobo,
      replayed: true,
    };
  }

  const userSnapshot = await tx.get(userRef);
  if (!userSnapshot.exists) throw notFound('that account', `user ${input.userId} missing`);

  const currentBalance = assertKobo(
    (userSnapshot.get('balanceKobo') as number | undefined) ?? 0,
    'current balance',
  );
  const balanceAfter = currentBalance + signed;

  if (balanceAfter < 0 && !input.allowNegativeBalance) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, {
      detail: `balance ${currentBalance} cannot absorb ${signed}`,
    });
  }

  const transactionId = newTransactionId();
  const transactionRef = firestore.collection(COLLECTIONS.transactions).doc(transactionId);
  const now = Timestamp.now();
  const status: TransactionStatus = input.status ?? 'COMPLETED';

  const record = {
    userId: input.userId,
    type: input.type,
    direction,
    amountKobo: signed,
    status,
    balanceAfterKobo: balanceAfter,
    description: input.description,
    reference: input.reference ?? null,
    idempotencyKey: input.idempotencyKey,
    reversalOf: input.reversalOf ?? null,
    actorAdminId: input.actorAdminId ?? null,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };

  // `create` (not `set`) so a racing request with the same key fails the whole
  // transaction instead of silently overwriting the first one.
  tx.create(transactionRef, record);
  tx.create(keyRef, {
    transactionId,
    userId: input.userId,
    type: input.type,
    createdAt: now,
    // Keys are prunable after 30 days; see scripts/prune-idempotency-keys.
    expiresAt: Timestamp.fromMillis(now.toMillis() + 30 * 86_400_000),
  });

  const userUpdate: Record<string, unknown> = {
    balanceKobo: balanceAfter,
    updatedAt: now,
  };
  if (direction === 'CREDIT') {
    userUpdate.lifetimeEarnedKobo = FieldValue.increment(amount);
  } else {
    userUpdate.lifetimePaidOutKobo = FieldValue.increment(amount);
  }
  tx.update(userRef, userUpdate);

  return {
    transaction: mapTransaction(transactionId, { ...record, createdAt: now, updatedAt: now }),
    balanceAfterKobo: balanceAfter,
    replayed: false,
  };
}

/**
 * Reverse a completed entry with a compensating entry of the opposite sign.
 *
 * The original row is never edited; its `status` becomes REVERSED and a new
 * REVERSAL row restores the money. That leaves both halves of the story visible
 * to an admin investigating a dispute.
 */
export async function reverseEntry(input: {
  transactionId: string;
  reason: string;
  actorAdminId?: string | null;
  idempotencyKey: string;
}): Promise<PostEntryResult> {
  const firestore = db();
  return firestore.runTransaction(async (tx) => {
    const originalRef = firestore.collection(COLLECTIONS.transactions).doc(input.transactionId);
    const originalSnapshot = await tx.get(originalRef);
    if (!originalSnapshot.exists) throw notFound('that transaction');

    const original = mapTransaction(originalSnapshot.id, originalSnapshot.data() ?? {});
    if (original.status === 'REVERSED') {
      throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, {
        detail: `transaction ${input.transactionId} is already reversed`,
      });
    }

    const result = await postEntryIn(tx, {
      userId: original.userId,
      type: 'REVERSAL',
      amountKobo: Math.abs(original.amountKobo),
      // A reversal moves money the opposite way to the original.
      direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      description: `Reversal: ${original.description}`,
      reference: original.reference,
      idempotencyKey: input.idempotencyKey,
      reversalOf: original.id,
      actorAdminId: input.actorAdminId ?? null,
      metadata: { reason: input.reason, originalType: original.type },
      // Reversing a credit may push a spent balance negative; that is correct,
      // and the admin sees it rather than the platform absorbing the loss.
      allowNegativeBalance: original.direction === 'CREDIT',
    });

    if (!result.replayed) {
      tx.update(originalRef, {
        status: 'REVERSED',
        updatedAt: Timestamp.now(),
        'metadata.reversedBy': result.transaction.id,
        'metadata.reversalReason': input.reason,
      });
    }
    return result;
  });
}

/** Advance a provider-backed debit from PENDING to a terminal status. */
export async function setTransactionStatus(
  transactionId: string,
  status: TransactionStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await db()
    .collection(COLLECTIONS.transactions)
    .doc(transactionId)
    .update({ status, updatedAt: Timestamp.now(), ...patch });
}

export async function getTransaction(transactionId: string): Promise<Transaction | null> {
  const snapshot = await db().collection(COLLECTIONS.transactions).doc(transactionId).get();
  return snapshot.exists ? mapTransaction(snapshot.id, snapshot.data() ?? {}) : null;
}

export interface HistoryPage {
  items: TransactionRow[];
  nextCursor: string | null;
}

/**
 * Paginated transaction history, newest first.
 *
 * The cursor is the **last document's id**, not its timestamp. Several entries
 * can share a millisecond (a task reward and a referral reward credited in the
 * same request, for instance), and a timestamp cursor would then skip every row
 * that ties with the boundary. Firestore implicitly orders by `__name__` after
 * the last explicit `orderBy`, so a document-snapshot cursor is unambiguous.
 */
export async function listUserTransactions(
  userId: string,
  options: { limit?: number; cursor?: string | undefined; type?: TransactionType } = {},
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const collection = db().collection(COLLECTIONS.transactions);

  let query = collection.where('userId', '==', userId);
  if (options.type) query = query.where('type', '==', options.type);
  query = query.orderBy('createdAt', 'desc').limit(limit + 1);

  if (options.cursor) {
    const cursorDoc = await collection.doc(options.cursor).get();
    // A stale or forged cursor simply starts from the beginning rather than
    // erroring out on the user.
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, limit);
  const hasMore = snapshot.docs.length > limit;
  const last = docs[docs.length - 1];

  return {
    items: docs.map((doc) => {
      const transaction = mapTransaction(doc.id, doc.data());
      return {
        id: transaction.id,
        type: transaction.type,
        direction: transaction.direction,
        amountKobo: transaction.amountKobo,
        status: transaction.status,
        description: transaction.description,
        reference: transaction.reference,
        createdAt: transaction.createdAt,
      };
    }),
    nextCursor: hasMore && last ? last.id : null,
  };
}

/** Credits timestamped today, in platform-local time. Powers "Today's earnings". */
export async function sumTodayCredits(userId: string): Promise<{ kobo: Kobo; count: number }> {
  const since = Timestamp.fromDate(startOfPlatformDay());
  const snapshot = await db()
    .collection(COLLECTIONS.transactions)
    .where('userId', '==', userId)
    .where('direction', '==', 'CREDIT')
    .where('createdAt', '>=', since)
    .get();

  let kobo = 0;
  let count = 0;
  for (const doc of snapshot.docs) {
    if (doc.get('status') === 'REVERSED' || doc.get('status') === 'FAILED') continue;
    kobo += (doc.get('amountKobo') as number | undefined) ?? 0;
    count += 1;
  }
  return { kobo: assertKobo(kobo, "today's credits"), count };
}

/**
 * Recompute a balance from the ledger and compare it with the cache.
 *
 * This is the integrity check that makes the "ledger is authoritative" claim
 * verifiable rather than aspirational. Exposed to admins for dispute
 * investigation; it reports and never silently rewrites.
 */
export async function auditUserBalance(userId: string): Promise<{
  cachedKobo: Kobo;
  ledgerKobo: Kobo;
  matches: boolean;
  entryCount: number;
}> {
  const firestore = db();
  const [userSnapshot, transactionSnapshot] = await Promise.all([
    firestore.collection(COLLECTIONS.users).doc(userId).get(),
    firestore.collection(COLLECTIONS.transactions).where('userId', '==', userId).get(),
  ]);
  if (!userSnapshot.exists) throw notFound('that account');

  // Every row in this ledger moved the balance at the moment it was written,
  // including rows that later ended up PENDING, FAILED or REVERSED: a correction
  // is always a separate compensating REVERSAL row, never an edit. `status`
  // therefore describes the *external fulfilment*, not whether money moved, so
  // excluding any status here would double-count a reversal.
  let ledgerKobo = 0;
  let entryCount = 0;
  for (const doc of transactionSnapshot.docs) {
    ledgerKobo += (doc.get('amountKobo') as number | undefined) ?? 0;
    entryCount += 1;
  }

  const cachedKobo = ((userSnapshot.get('balanceKobo') as number | undefined) ?? 0) as Kobo;
  const matches = cachedKobo === ledgerKobo;
  if (!matches) {
    logger.error(
      { userId, cachedKobo, ledgerKobo, entryCount },
      'Balance cache disagrees with the ledger',
    );
  }
  return { cachedKobo, ledgerKobo, matches, entryCount };
}

export function mapTransaction(id: string, data: Record<string, unknown>): Transaction {
  return {
    id,
    userId: String(data.userId ?? ''),
    type: (data.type as TransactionType) ?? 'ADMIN_ADJUSTMENT',
    direction: (data.direction as 'CREDIT' | 'DEBIT') ?? 'CREDIT',
    amountKobo: (data.amountKobo as number | undefined) ?? 0,
    status: (data.status as TransactionStatus) ?? 'COMPLETED',
    balanceAfterKobo: (data.balanceAfterKobo as number | undefined) ?? 0,
    description: String(data.description ?? ''),
    reference: (data.reference as string | null) ?? null,
    idempotencyKey: String(data.idempotencyKey ?? ''),
    reversalOf: (data.reversalOf as string | null) ?? null,
    actorAdminId: (data.actorAdminId as string | null) ?? null,
    metadata: (data.metadata as Transaction['metadata']) ?? {},
    createdAt: toIsoRequired(data.createdAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
  };
}

/** Build a stable idempotency key from its parts. */
export function idempotencyKey(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^\w.-]/g, '_'))
    .join('__')
    .slice(0, 1_400);
}
