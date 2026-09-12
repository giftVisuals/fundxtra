import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ERROR_CODES,
  NIGERIAN_BANKS,
  OPEN_WITHDRAWAL_STATUSES,
  assertPositiveKobo,
  formatNaira,
  type BankAccount,
  type Kobo,
  type User,
  type Withdrawal,
  type WithdrawalStatus,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { AppError, notFound } from '../lib/errors';
import { newWithdrawalId } from '../lib/ids';
import { logger } from '../lib/logger';
import { nowIso, startOfPlatformDay, toIso, toIsoRequired } from '../lib/time';
import { idempotencyKey, postEntryIn, reverseEntry } from './ledger';
import { getSettings, withdrawalAvailability } from './settings';
import { bumpStats } from './stats';
import { flagUser } from './users';

/**
 * Cash withdrawals.
 *
 * The money leaves the user's spendable balance the instant the request is
 * accepted, as a real DEBIT ledger entry — not as a "pending" flag on top of an
 * untouched balance. That ordering matters: if the balance were left intact
 * until payout, a user could request three withdrawals of their full balance
 * and the platform would owe three times what it holds.
 *
 * If the payout later fails or is rejected, a compensating REVERSAL credit
 * returns the money, and both entries stay visible for the dispute.
 *
 * No payment provider is wired in yet. Payouts are recorded, tracked and
 * settled by an admin marking them complete with the bank's own reference —
 * which is exactly how this would be operated on day one anyway, and leaves the
 * provider integration a contained change.
 */

export interface WithdrawalRequestArgs {
  user: User;
  amountKobo: Kobo;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export async function requestWithdrawal(args: WithdrawalRequestArgs): Promise<Withdrawal> {
  const settings = await getSettings();
  const availability = withdrawalAvailability(settings);

  if (!availability.open) {
    throw new AppError(ERROR_CODES.WITHDRAWALS_CLOSED, {
      message: availability.reason ?? 'Withdrawals are currently closed.',
    });
  }

  const amountKobo = assertPositiveKobo(args.amountKobo, 'withdrawal amount');
  const { minAmountKobo, maxAmountKobo, dailyLimitKobo, feeKobo } = settings.withdrawals;

  if (amountKobo < minAmountKobo) {
    throw new AppError(ERROR_CODES.LIMIT_EXCEEDED, {
      message: `The minimum withdrawal is ${formatNaira(minAmountKobo)}.`,
      fields: { amountKobo: `Minimum ${formatNaira(minAmountKobo)}` },
    });
  }
  if (amountKobo > maxAmountKobo) {
    throw new AppError(ERROR_CODES.LIMIT_EXCEEDED, {
      message: `The maximum single withdrawal is ${formatNaira(maxAmountKobo)}.`,
      fields: { amountKobo: `Maximum ${formatNaira(maxAmountKobo)}` },
    });
  }
  if (feeKobo >= amountKobo) {
    throw new AppError(ERROR_CODES.LIMIT_EXCEEDED, {
      message: 'That amount does not cover the withdrawal fee.',
    });
  }

  const bank = NIGERIAN_BANKS.find((entry) => entry.code === args.bankCode);
  if (!bank) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { bankCode: 'Select a supported bank' },
    });
  }

  // Rolling daily ceiling, measured in platform-local days.
  const usedToday = await sumWithdrawnToday(args.user.id);
  if (usedToday + amountKobo > dailyLimitKobo) {
    throw new AppError(ERROR_CODES.LIMIT_EXCEEDED, {
      message: `That would pass your daily limit of ${formatNaira(dailyLimitKobo)}. You have ${formatNaira(Math.max(0, dailyLimitKobo - usedToday))} left today.`,
    });
  }

  const bankAccount: BankAccount = {
    bankCode: bank.code,
    bankName: bank.name,
    accountNumber: args.accountNumber,
    accountName: args.accountName,
  };

  const withdrawalId = newWithdrawalId();
  const netKobo = amountKobo - feeKobo;
  const firestore = db();

  const withdrawal = await firestore.runTransaction(async (tx) => {
    // The debit runs first: it re-reads the balance inside the transaction and
    // throws INSUFFICIENT_BALANCE rather than letting the request through.
    const entry = await postEntryIn(tx, {
      userId: args.user.id,
      type: 'CASH_WITHDRAWAL',
      amountKobo,
      description: `Withdrawal to ${bank.name}`,
      reference: withdrawalId,
      idempotencyKey: idempotencyKey('withdrawal', withdrawalId),
      status: 'PENDING',
      metadata: { withdrawalId, bankCode: bank.code, feeKobo },
    });

    const record = {
      userId: args.user.id,
      userTelegramId: args.user.telegramId,
      username: args.user.username,
      amountKobo,
      feeKobo,
      netKobo,
      status: 'PENDING' as WithdrawalStatus,
      bank: bankAccount,
      transactionId: entry.transaction.id,
      reversalTransactionId: null,
      providerReference: null,
      providerName: null,
      failureReason: null,
      reviewedBy: null,
      reviewedAt: null,
      requestedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    tx.create(firestore.collection(COLLECTIONS.withdrawals).doc(withdrawalId), record);

    // `pendingOutKobo` is display-only: it tells the user how much of their
    // (already debited) money is in flight.
    tx.update(firestore.collection(COLLECTIONS.users).doc(args.user.id), {
      pendingOutKobo: FieldValue.increment(amountKobo),
      updatedAt: Timestamp.now(),
    });

    return mapWithdrawal(withdrawalId, record);
  });

  await detectWithdrawalAnomaly(args.user, amountKobo);

  logger.info(
    { withdrawalId, userId: args.user.id, amountKobo },
    'Withdrawal requested and balance debited',
  );
  return withdrawal;
}

/**
 * Advance a withdrawal.
 *
 * FAILED and REJECTED both return the money with a REVERSAL entry. COMPLETED
 * is terminal and records the bank reference. Transitions are validated, so a
 * withdrawal cannot go from COMPLETED back to PENDING and be paid twice.
 */
const ALLOWED_TRANSITIONS: Record<WithdrawalStatus, readonly WithdrawalStatus[]> = {
  PENDING: ['PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  REJECTED: [],
  CANCELLED: [],
};

export async function transitionWithdrawal(input: {
  withdrawalId: string;
  status: WithdrawalStatus;
  actorAdminId: string;
  reason?: string | undefined;
  providerReference?: string | undefined;
}): Promise<Withdrawal> {
  const firestore = db();
  const ref = firestore.collection(COLLECTIONS.withdrawals).doc(input.withdrawalId);

  const { withdrawal, shouldReverse } = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw notFound('that withdrawal');

    const current = mapWithdrawal(snapshot.id, snapshot.data() ?? {});
    if (!ALLOWED_TRANSITIONS[current.status].includes(input.status)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        message: `A ${current.status.toLowerCase()} withdrawal cannot become ${input.status.toLowerCase()}.`,
        detail: `illegal transition ${current.status} -> ${input.status}`,
      });
    }

    const now = Timestamp.now();
    const patch: Record<string, unknown> = {
      status: input.status,
      reviewedBy: input.actorAdminId,
      reviewedAt: now,
      updatedAt: now,
    };
    if (input.reason) patch.failureReason = input.reason;
    if (input.providerReference) patch.providerReference = input.providerReference;

    tx.update(ref, patch);

    const settled = ['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(input.status);
    if (settled) {
      tx.update(firestore.collection(COLLECTIONS.users).doc(current.userId), {
        pendingOutKobo: FieldValue.increment(-current.amountKobo),
        updatedAt: now,
      });
    }

    if (input.status === 'COMPLETED') {
      tx.update(firestore.collection(COLLECTIONS.transactions).doc(current.transactionId), {
        status: 'COMPLETED',
        updatedAt: now,
        reference: input.providerReference ?? current.transactionId,
      });
    }

    return {
      withdrawal: { ...current, ...mapWithdrawal(current.id, { ...(snapshot.data() ?? {}), ...patch }) },
      shouldReverse: input.status === 'FAILED' || input.status === 'REJECTED' || input.status === 'CANCELLED',
    };
  });

  if (shouldReverse) {
    // Reversed outside the transaction above because `reverseEntry` opens its
    // own; it is idempotent on the withdrawal id, so a retry is safe.
    const reversal = await reverseEntry({
      transactionId: withdrawal.transactionId,
      reason: input.reason ?? `Withdrawal ${input.status.toLowerCase()}`,
      actorAdminId: input.actorAdminId,
      idempotencyKey: idempotencyKey('withdrawal-reversal', withdrawal.id),
    });
    await ref.update({ reversalTransactionId: reversal.transaction.id });
    logger.info(
      { withdrawalId: withdrawal.id, status: input.status },
      'Withdrawal reversed and balance restored',
    );
  } else if (input.status === 'COMPLETED') {
    bumpStats({ totalPaidOutKobo: withdrawal.amountKobo });
  }

  return { ...withdrawal, status: input.status };
}

/** A user cancelling their own pending request. */
export async function cancelWithdrawal(userId: string, withdrawalId: string): Promise<Withdrawal> {
  const snapshot = await db().collection(COLLECTIONS.withdrawals).doc(withdrawalId).get();
  if (!snapshot.exists) throw notFound('that withdrawal');

  const withdrawal = mapWithdrawal(snapshot.id, snapshot.data() ?? {});
  if (withdrawal.userId !== userId) throw notFound('that withdrawal');
  if (withdrawal.status !== 'PENDING') {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      message: 'This withdrawal is already being processed and can no longer be cancelled.',
    });
  }

  return transitionWithdrawal({
    withdrawalId,
    status: 'CANCELLED',
    actorAdminId: userId,
    reason: 'Cancelled by the user',
  });
}

async function sumWithdrawnToday(userId: string): Promise<Kobo> {
  const snapshot = await db()
    .collection(COLLECTIONS.withdrawals)
    .where('userId', '==', userId)
    .where('requestedAt', '>=', Timestamp.fromDate(startOfPlatformDay()))
    .get();

  let total = 0;
  for (const doc of snapshot.docs) {
    const status = doc.get('status') as WithdrawalStatus;
    // Reversed outcomes freed the money, so they do not consume the limit.
    if (status === 'FAILED' || status === 'REJECTED' || status === 'CANCELLED') continue;
    total += (doc.get('amountKobo') as number | undefined) ?? 0;
  }
  return total;
}

/**
 * Flag a withdrawal pattern worth a human look: a user cashing out nearly
 * everything they have ever earned within hours of earning it. Flagged only —
 * the withdrawal proceeds, because that pattern is also just what a legitimate
 * first-time user does.
 */
async function detectWithdrawalAnomaly(user: User, amountKobo: Kobo): Promise<void> {
  const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
  const isYoungAccount = accountAgeMs < 6 * 3_600_000;
  const isNearlyEverything = amountKobo >= user.lifetimeEarnedKobo * 0.9;

  if (isYoungAccount && isNearlyEverything && amountKobo >= 100_000) {
    await flagUser(user.id, 'WITHDRAWAL_ANOMALY', 12);
    logger.warn(
      { userId: user.id, amountKobo, accountAgeHours: Math.round(accountAgeMs / 3_600_000) },
      'Withdrawal flagged for review',
    );
  }
}

export async function listUserWithdrawals(
  userId: string,
  limit = 20,
): Promise<Withdrawal[]> {
  const snapshot = await db()
    .collection(COLLECTIONS.withdrawals)
    .where('userId', '==', userId)
    .orderBy('requestedAt', 'desc')
    .limit(Math.min(limit, 100))
    .get();
  return snapshot.docs.map((doc) => mapWithdrawal(doc.id, doc.data()));
}

export async function listWithdrawals(options: {
  status?: WithdrawalStatus;
  limit?: number;
  cursor?: string | undefined;
}): Promise<{ items: Withdrawal[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const collection = db().collection(COLLECTIONS.withdrawals);

  let query = collection as unknown as import('firebase-admin/firestore').Query;
  if (options.status) query = query.where('status', '==', options.status);
  query = query.orderBy('requestedAt', 'desc').limit(limit + 1);

  if (options.cursor) {
    const cursorDoc = await collection.doc(options.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, limit);
  const last = docs[docs.length - 1];

  return {
    items: docs.map((doc) => mapWithdrawal(doc.id, doc.data())),
    nextCursor: snapshot.docs.length > limit && last ? last.id : null,
  };
}

/** Money committed to in-flight withdrawals, for the admin dashboard. */
export async function pendingWithdrawalTotals(): Promise<{ count: number; kobo: Kobo }> {
  const snapshot = await db()
    .collection(COLLECTIONS.withdrawals)
    .where('status', 'in', OPEN_WITHDRAWAL_STATUSES as WithdrawalStatus[])
    .get();

  let kobo = 0;
  for (const doc of snapshot.docs) kobo += (doc.get('amountKobo') as number | undefined) ?? 0;
  return { count: snapshot.size, kobo };
}

export function mapWithdrawal(id: string, data: Record<string, unknown>): Withdrawal {
  const bank = (data.bank as BankAccount | undefined) ?? {
    bankCode: '', bankName: '', accountNumber: '', accountName: '',
  };
  return {
    id,
    userId: String(data.userId ?? ''),
    userTelegramId: String(data.userTelegramId ?? ''),
    username: (data.username as string | null) ?? null,
    amountKobo: (data.amountKobo as number | undefined) ?? 0,
    feeKobo: (data.feeKobo as number | undefined) ?? 0,
    netKobo: (data.netKobo as number | undefined) ?? 0,
    status: (data.status as WithdrawalStatus) ?? 'PENDING',
    bank,
    transactionId: String(data.transactionId ?? ''),
    reversalTransactionId: (data.reversalTransactionId as string | null) ?? null,
    providerReference: (data.providerReference as string | null) ?? null,
    providerName: (data.providerName as string | null) ?? null,
    failureReason: (data.failureReason as string | null) ?? null,
    reviewedBy: (data.reviewedBy as string | null) ?? null,
    reviewedAt: toIso(data.reviewedAt),
    requestedAt: toIsoRequired(data.requestedAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
  };
}
