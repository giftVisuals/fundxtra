import type { Kobo, Network, RewardKind } from '@fundxtra/shared';

/**
 * Reward fulfilment provider interface.
 *
 * Fundxtra decides *what* a user is owed; a provider decides *how* it is
 * delivered. Keeping that seam narrow is what will make the NasfamPay
 * integration a single-file change once their public API ships.
 *
 *   Reward service  ->  RewardProvider  ->  { mock | nasfampay | ... }
 *
 * Two rules every implementation must honour:
 *
 * 1. **Respect `idempotencyKey`.** Fundxtra debits the user's balance *before*
 *    calling out, so a retry must not deliver twice. Providers that support a
 *    client reference should pass this through; those that do not must dedupe
 *    locally.
 *
 * 2. **Distinguish failure from uncertainty.** `FAILED` means "definitely did
 *    not happen" and triggers an automatic reversal to the user's balance.
 *    `PENDING` means "outcome unknown" and must be resolved later. Returning
 *    FAILED for a request that actually succeeded would hand the user their
 *    money back *and* the airtime.
 */

export interface FulfilmentRequest {
  /** Stable key for this intent. Safe to retry with the same value. */
  idempotencyKey: string;
  kind: RewardKind;
  /** Naira value being spent, in kobo. */
  amountKobo: Kobo;
  /** Phone number for airtime/data; Telegram username for Stars/Premium. */
  target: string;
  network: Network | null;
  /** Provider-specific product code, when the catalogue maps to one. */
  productCode: string | null;
  /** Data volume, Stars count or Premium months, for the provider's payload. */
  quantity: number | null;
  /** For support and provider-side reconciliation. */
  reference: string;
}

export type FulfilmentStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

export interface FulfilmentResult {
  status: FulfilmentStatus;
  /** The provider's own reference, stored for dispute resolution. */
  providerReference: string | null;
  /** Safe to show a user. Never a raw provider error. */
  message: string;
  /** Diagnostics for the logs and the admin view only. */
  detail?: string;
  /** Whatever the provider returned, for the audit trail. */
  raw?: unknown;
}

export interface ProviderCapabilities {
  airtime: boolean;
  data: boolean;
  telegramStars: boolean;
  telegramPremium: boolean;
  /** Whether a completed delivery can be queried after the fact. */
  statusLookup: boolean;
}

export interface RewardProvider {
  readonly name: string;
  /** False until credentials and a real integration exist. */
  readonly configured: boolean;
  capabilities(): ProviderCapabilities;
  /** Human-readable reason a redemption cannot proceed, or null when it can. */
  unavailableReason(kind: RewardKind): string | null;
  fulfil(request: FulfilmentRequest): Promise<FulfilmentResult>;
  /** Resolve a PENDING delivery. Optional: not all providers support lookup. */
  checkStatus?(providerReference: string): Promise<FulfilmentResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(readonly providerName: string, message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}
