import { Timestamp } from 'firebase-admin/firestore';
import {
  ERROR_CODES,
  TELEGRAM_PREMIUM_PLANS,
  TELEGRAM_STARS_BUNDLES,
  assertPositiveKobo,
  formatNaira,
  type Kobo,
  type Network,
  type Redemption,
  type RedemptionStatus,
  type RewardKind,
  type RewardProduct,
  type User,
} from '@fundxtra/shared';
import { COLLECTIONS, db } from '../lib/firebase';
import { millisOf, runOrderedQuery } from '../lib/query-fallback';
import { AppError, notFound } from '../lib/errors';
import { newRedemptionId } from '../lib/ids';
import { logger } from '../lib/logger';
import { nowIso, toIsoRequired } from '../lib/time';
import { provider } from '../providers';
import { ProviderNotConfiguredError } from '../providers/types';
import { idempotencyKey, postEntryIn, reverseEntry, setTransactionStatus } from './ledger';
import { getSettings } from './settings';
import { bumpStats } from './stats';

/**
 * Reward redemption: airtime, data, Telegram Stars, Telegram Premium.
 *
 * The ordering here is the whole design, and it is the conservative one:
 *
 *   1. Debit the balance inside a transaction, as a PENDING ledger entry.
 *   2. Call the provider.
 *   3. COMPLETED -> mark the entry completed.
 *      FAILED    -> post a compensating REVERSAL credit immediately.
 *      PENDING   -> leave it pending for reconciliation to resolve.
 *
 * Debiting first means a user can never redeem the same balance twice by firing
 * concurrent requests. The cost is that a provider failure requires a reversal
 * — which is why `FAILED` and `PENDING` are kept strictly distinct: reversing
 * an uncertain outcome would give the user both the refund and the airtime.
 */

const TRANSACTION_TYPE: Record<RewardKind, 'AIRTIME_REDEMPTION' | 'DATA_REDEMPTION' | 'TELEGRAM_STARS_REDEMPTION' | 'TELEGRAM_PREMIUM_REDEMPTION'> = {
  AIRTIME: 'AIRTIME_REDEMPTION',
  DATA: 'DATA_REDEMPTION',
  TELEGRAM_STARS: 'TELEGRAM_STARS_REDEMPTION',
  TELEGRAM_PREMIUM: 'TELEGRAM_PREMIUM_REDEMPTION',
};

export interface RedeemArgs {
  user: User;
  kind: RewardKind;
  /** Catalogue item. Omitted for open-amount airtime. */
  productId?: string | undefined;
  /** Phone number for airtime/data, Telegram username for Stars/Premium. */
  target: string;
  network?: Network | undefined;
  /** Only honoured for open-amount airtime; otherwise the catalogue price wins. */
  amountKobo?: Kobo | undefined;
}

export interface RedeemOutcome {
  redemptionId: string;
  status: RedemptionStatus;
  amountKobo: Kobo;
  balanceAfterKobo: Kobo;
  message: string;
}

export async function redeem(args: RedeemArgs): Promise<RedeemOutcome> {
  const settings = await getSettings();
  const active = provider();

  assertKindEnabled(args.kind, settings);

  const blocked = active.unavailableReason(args.kind);
  if (!active.configured || blocked) {
    throw new AppError(ERROR_CODES.PROVIDER_NOT_CONFIGURED, {
      message: blocked ?? 'This reward is not available yet. It is coming soon.',
      detail: `provider "${active.name}" cannot fulfil ${args.kind}`,
    });
  }

  // The price is resolved server-side. A client-supplied amount is only ever
  // consulted for open-amount airtime, and even then it is range-checked.
  const priced = await resolvePrice(args, settings);

  const redemptionId = newRedemptionId();
  const firestore = db();
  const key = idempotencyKey('redemption', redemptionId);

  const debit = await firestore.runTransaction(async (tx) => {
    const entry = await postEntryIn(tx, {
      userId: args.user.id,
      type: TRANSACTION_TYPE[args.kind],
      amountKobo: priced.amountKobo,
      description: priced.description,
      reference: redemptionId,
      idempotencyKey: key,
      status: 'PENDING',
      metadata: { redemptionId, kind: args.kind, target: args.target },
    });

    tx.create(firestore.collection(COLLECTIONS.redemptions).doc(redemptionId), {
      userId: args.user.id,
      userTelegramId: args.user.telegramId,
      kind: args.kind,
      productId: args.productId ?? null,
      productName: priced.description,
      amountKobo: priced.amountKobo,
      status: 'PENDING' as RedemptionStatus,
      target: args.target,
      network: args.network ?? null,
      transactionId: entry.transaction.id,
      reversalTransactionId: null,
      providerName: active.name,
      providerReference: null,
      failureReason: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    return entry;
  });

  // From here the user's balance is already reduced, so every path below must
  // end in either a delivered reward or a reversal.
  let result;
  try {
    result = await active.fulfil({
      idempotencyKey: key,
      kind: args.kind,
      amountKobo: priced.amountKobo,
      target: args.target,
      network: args.network ?? null,
      productCode: priced.productCode,
      quantity: priced.quantity,
      reference: redemptionId,
    });
  } catch (error) {
    await failRedemption(
      redemptionId,
      debit.transaction.id,
      error instanceof ProviderNotConfiguredError
        ? 'This reward is not available yet.'
        : 'The provider could not complete this delivery.',
    );
    logger.error({ err: error, redemptionId }, 'Provider call threw; redemption reversed');
    throw new AppError(
      error instanceof ProviderNotConfiguredError
        ? ERROR_CODES.PROVIDER_NOT_CONFIGURED
        : ERROR_CODES.PROVIDER_FAILED,
      { detail: error instanceof Error ? error.message : 'provider failure' },
    );
  }

  const now = Timestamp.now();

  if (result.status === 'FAILED') {
    await failRedemption(redemptionId, debit.transaction.id, result.message, result.providerReference);
    throw new AppError(ERROR_CODES.PROVIDER_FAILED, {
      message: 'We could not complete that. Your balance has been restored.',
      detail: result.detail,
    });
  }

  await db().collection(COLLECTIONS.redemptions).doc(redemptionId).update({
    status: result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
    providerReference: result.providerReference,
    updatedAt: now,
  });

  if (result.status === 'COMPLETED') {
    await setTransactionStatus(debit.transaction.id, 'COMPLETED', {
      reference: result.providerReference ?? redemptionId,
    });
    bumpStats({ totalPaidOutKobo: priced.amountKobo });
  }

  logger.info(
    { redemptionId, kind: args.kind, status: result.status, amountKobo: priced.amountKobo },
    'Redemption processed',
  );

  return {
    redemptionId,
    status: result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING',
    amountKobo: priced.amountKobo,
    balanceAfterKobo: debit.balanceAfterKobo,
    message:
      result.status === 'COMPLETED'
        ? `${priced.description} delivered.`
        : `${priced.description} is being processed. We will update you shortly.`,
  };
}

/** Mark a redemption failed and give the money back. */
async function failRedemption(
  redemptionId: string,
  transactionId: string,
  reason: string,
  providerReference: string | null = null,
): Promise<void> {
  const reversal = await reverseEntry({
    transactionId,
    reason,
    idempotencyKey: idempotencyKey('redemption-reversal', redemptionId),
  });

  await db().collection(COLLECTIONS.redemptions).doc(redemptionId).update({
    status: 'FAILED' as RedemptionStatus,
    failureReason: reason,
    providerReference,
    reversalTransactionId: reversal.transaction.id,
    updatedAt: Timestamp.now(),
  });

  // The debit's status stays REVERSED — set by `reverseEntry` — rather than
  // becoming FAILED. The redemption is what failed; the ledger entry genuinely
  // moved money and was genuinely undone, and overwriting that status would
  // misrepresent a compensated debit as one that never happened.
  await db()
    .collection(COLLECTIONS.transactions)
    .doc(transactionId)
    .update({
      'metadata.failureReason': reason,
      'metadata.redemptionStatus': 'FAILED',
      updatedAt: Timestamp.now(),
    });
}

interface PricedRedemption {
  amountKobo: Kobo;
  description: string;
  productCode: string | null;
  quantity: number | null;
}

async function resolvePrice(
  args: RedeemArgs,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<PricedRedemption> {
  // Open-amount airtime: the user picks the value, bounded by settings.
  if (args.kind === 'AIRTIME' && !args.productId) {
    const amountKobo = assertPositiveKobo(args.amountKobo ?? 0, 'airtime amount');
    if (amountKobo < settings.rewards.minAirtimeKobo) {
      throw new AppError(ERROR_CODES.LIMIT_EXCEEDED, {
        message: `The minimum airtime top-up is ${formatNaira(settings.rewards.minAirtimeKobo)}.`,
        fields: { amountKobo: `Minimum ${formatNaira(settings.rewards.minAirtimeKobo)}` },
      });
    }
    return {
      amountKobo,
      description: `${args.network ?? ''} airtime ${formatNaira(amountKobo)}`.trim(),
      productCode: null,
      quantity: null,
    };
  }

  if (!args.productId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { productId: 'Choose a reward' },
    });
  }

  const product = await findRewardProduct(args.productId);
  if (!product) throw notFound('that reward');
  if (product.kind !== args.kind) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      detail: `product ${product.id} is ${product.kind}, not ${args.kind}`,
    });
  }
  if (!product.available) {
    throw new AppError(ERROR_CODES.PROVIDER_NOT_CONFIGURED, {
      message: product.unavailableReason ?? 'This reward is not available yet.',
    });
  }

  return {
    // Always the catalogue price; a client-supplied amount is ignored here.
    amountKobo: product.priceKobo,
    description: product.name,
    productCode: product.id,
    quantity: product.stars ?? product.months ?? null,
  };
}

function assertKindEnabled(
  kind: RewardKind,
  settings: Awaited<ReturnType<typeof getSettings>>,
): void {
  const enabled: Record<RewardKind, boolean> = {
    AIRTIME: settings.rewards.airtimeEnabled,
    DATA: settings.rewards.dataEnabled,
    TELEGRAM_STARS: settings.rewards.starsEnabled,
    TELEGRAM_PREMIUM: settings.rewards.premiumEnabled,
  };
  if (!enabled[kind]) {
    throw new AppError(ERROR_CODES.PROVIDER_NOT_CONFIGURED, {
      message: 'This reward is not available yet. It is coming soon.',
      detail: `${kind} is disabled in system settings`,
    });
  }
}

export async function findRewardProduct(productId: string): Promise<RewardProduct | null> {
  const snapshot = await db().collection(COLLECTIONS.rewardProducts).doc(productId).get();
  return snapshot.exists ? mapRewardProduct(snapshot.id, snapshot.data() ?? {}) : null;
}

/**
 * The reward catalogue.
 *
 * Every item is returned with an honest `available` flag: an item is only
 * available when the setting is on *and* the active provider says it can
 * deliver that kind. This is what lets the Mini App show the full, priced
 * catalogue while making it unmistakable which items are not live yet.
 */
export async function listRewardCatalogue(): Promise<{
  products: RewardProduct[];
  providerName: string;
  providerConfigured: boolean;
}> {
  const [settings, snapshot] = await Promise.all([
    getSettings(),
    db().collection(COLLECTIONS.rewardProducts).orderBy('sortWeight', 'asc').get(),
  ]);
  const active = provider();

  const kindEnabled: Record<RewardKind, boolean> = {
    AIRTIME: settings.rewards.airtimeEnabled,
    DATA: settings.rewards.dataEnabled,
    TELEGRAM_STARS: settings.rewards.starsEnabled,
    TELEGRAM_PREMIUM: settings.rewards.premiumEnabled,
  };
  const capabilities = active.capabilities();
  const kindSupported: Record<RewardKind, boolean> = {
    AIRTIME: capabilities.airtime,
    DATA: capabilities.data,
    TELEGRAM_STARS: capabilities.telegramStars,
    TELEGRAM_PREMIUM: capabilities.telegramPremium,
  };

  const products = snapshot.docs.map((doc) => {
    const product = mapRewardProduct(doc.id, doc.data());
    const deliverable = kindEnabled[product.kind] && kindSupported[product.kind];
    return {
      ...product,
      available: product.available && deliverable,
      unavailableReason:
        product.available && deliverable
          ? null
          : product.unavailableReason ??
            active.unavailableReason(product.kind) ??
            'Coming soon.',
    };
  });

  return { products, providerName: active.name, providerConfigured: active.configured };
}

export async function listUserRedemptions(userId: string, limit = 20): Promise<Redemption[]> {
  const capped = Math.min(limit, 100);
  const base = db().collection(COLLECTIONS.redemptions).where('userId', '==', userId);
  const snapshot = await runOrderedQuery({
    base,
    ordered: base.orderBy('createdAt', 'desc').limit(capped),
    limit: capped,
    timestampOf: (data) => millisOf(data.createdAt),
    label: 'redemptions by user, newest first',
  });
  return snapshot.docs.map((doc) => mapRedemption(doc.id, doc.data()));
}

/**
 * Resolve redemptions the provider left PENDING.
 *
 * Admin-triggered rather than scheduled, so an operator decides when to poll.
 * A provider without status lookup leaves these for manual settlement, which is
 * the honest outcome rather than guessing.
 */
export async function reconcilePendingRedemptions(limit = 50): Promise<{
  checked: number;
  completed: number;
  failed: number;
  unresolved: number;
}> {
  const active = provider();
  if (!active.checkStatus || !active.capabilities().statusLookup) {
    return { checked: 0, completed: 0, failed: 0, unresolved: 0 };
  }

  const snapshot = await db()
    .collection(COLLECTIONS.redemptions)
    .where('status', '==', 'PROCESSING')
    .limit(limit)
    .get();

  let completed = 0;
  let failed = 0;
  let unresolved = 0;

  for (const doc of snapshot.docs) {
    const redemption = mapRedemption(doc.id, doc.data());
    if (!redemption.providerReference) {
      unresolved += 1;
      continue;
    }

    const result = await active.checkStatus(redemption.providerReference);
    if (result.status === 'COMPLETED') {
      await doc.ref.update({ status: 'COMPLETED', updatedAt: Timestamp.now() });
      await setTransactionStatus(redemption.transactionId, 'COMPLETED');
      bumpStats({ totalPaidOutKobo: redemption.amountKobo });
      completed += 1;
    } else if (result.status === 'FAILED') {
      await failRedemption(redemption.id, redemption.transactionId, result.message, redemption.providerReference);
      failed += 1;
    } else {
      unresolved += 1;
    }
  }

  logger.info({ checked: snapshot.size, completed, failed, unresolved }, 'Redemptions reconciled');
  return { checked: snapshot.size, completed, failed, unresolved };
}

/**
 * Seed the catalogue from the planned price lists.
 *
 * Everything is created `available: false`, because pricing a reward is not the
 * same as being able to deliver it. An admin flips items on once a provider is
 * live.
 */
export async function seedRewardCatalogue(): Promise<number> {
  const firestore = db();
  const batch = firestore.batch();
  let count = 0;

  const unavailableReason = 'Coming soon — awaiting the fulfilment provider launch.';

  for (const bundle of TELEGRAM_STARS_BUNDLES) {
    const id = `stars-${bundle.stars}`;
    batch.set(
      firestore.collection(COLLECTIONS.rewardProducts).doc(id),
      {
        kind: 'TELEGRAM_STARS',
        name: `${bundle.stars.toLocaleString('en-NG')} Telegram Stars`,
        description: `${bundle.stars.toLocaleString('en-NG')} Stars delivered to your Telegram account`,
        priceKobo: bundle.priceKobo,
        openAmount: false,
        minAmountKobo: null,
        maxAmountKobo: null,
        network: null,
        dataVolume: null,
        validityDays: null,
        stars: bundle.stars,
        months: null,
        available: false,
        unavailableReason,
        sortWeight: 200 + bundle.stars / 10,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    count += 1;
  }

  for (const plan of TELEGRAM_PREMIUM_PLANS) {
    // Widened from the literal union so the pluralisation below stays correct
    // if a one-month plan is ever added to the price list.
    const months: number = plan.months;
    const id = `premium-${months}m`;
    batch.set(
      firestore.collection(COLLECTIONS.rewardProducts).doc(id),
      {
        kind: 'TELEGRAM_PREMIUM',
        name: `Telegram Premium \u2014 ${months} month${months === 1 ? '' : 's'}`,
        description: `${months} month${months === 1 ? '' : 's'} of Telegram Premium on your account`,
        priceKobo: plan.priceKobo,
        openAmount: false,
        minAmountKobo: null,
        maxAmountKobo: null,
        network: null,
        dataVolume: null,
        validityDays: months * 30,
        stars: null,
        months,
        available: false,
        unavailableReason,
        sortWeight: 300 + months,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    count += 1;
  }

  await batch.commit();
  logger.info({ count }, 'Reward catalogue seeded (all items start unavailable)');
  return count;
}

export function mapRewardProduct(id: string, data: Record<string, unknown>): RewardProduct {
  return {
    id,
    kind: (data.kind as RewardKind) ?? 'AIRTIME',
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    priceKobo: (data.priceKobo as number | undefined) ?? 0,
    openAmount: Boolean(data.openAmount),
    minAmountKobo: (data.minAmountKobo as number | null) ?? null,
    maxAmountKobo: (data.maxAmountKobo as number | null) ?? null,
    network: (data.network as Network | null) ?? null,
    dataVolume: (data.dataVolume as string | null) ?? null,
    validityDays: (data.validityDays as number | null) ?? null,
    stars: (data.stars as number | null) ?? null,
    months: (data.months as number | null) ?? null,
    available: Boolean(data.available),
    unavailableReason: (data.unavailableReason as string | null) ?? null,
    sortWeight: (data.sortWeight as number | undefined) ?? 100,
    createdAt: toIsoRequired(data.createdAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
  };
}

export function mapRedemption(id: string, data: Record<string, unknown>): Redemption {
  return {
    id,
    userId: String(data.userId ?? ''),
    userTelegramId: String(data.userTelegramId ?? ''),
    kind: (data.kind as RewardKind) ?? 'AIRTIME',
    productId: String(data.productId ?? ''),
    productName: String(data.productName ?? ''),
    amountKobo: (data.amountKobo as number | undefined) ?? 0,
    status: (data.status as RedemptionStatus) ?? 'PENDING',
    target: String(data.target ?? ''),
    network: (data.network as Network | null) ?? null,
    transactionId: String(data.transactionId ?? ''),
    reversalTransactionId: (data.reversalTransactionId as string | null) ?? null,
    providerName: (data.providerName as string | null) ?? null,
    providerReference: (data.providerReference as string | null) ?? null,
    failureReason: (data.failureReason as string | null) ?? null,
    createdAt: toIsoRequired(data.createdAt, nowIso()),
    updatedAt: toIsoRequired(data.updatedAt, nowIso()),
  };
}
