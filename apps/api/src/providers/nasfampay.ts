import type { RewardKind } from '@fundxtra/shared';
import { env } from '../config/env';
import {
  ProviderNotConfiguredError,
  type FulfilmentRequest,
  type FulfilmentResult,
  type ProviderCapabilities,
  type RewardProvider,
} from './types';

/**
 * NasfamPay provider — NOT YET IMPLEMENTED, deliberately.
 *
 * NasfamPay have confirmed their public API is still in development, with
 * documentation and a testing environment expected next month. Until that
 * exists, this file contains **no endpoint paths, no authentication scheme, no
 * request bodies and no response parsing**, because every one of those would be
 * a guess — and a guess that looks like working code is worse than an honest
 * gap: it would pass review, ship, and then fail against the real API while
 * having already debited users.
 *
 * What this class does instead is fail loudly and specifically, so the
 * surrounding machinery (balance debit, reversal, status tracking, admin views)
 * can be built and tested today against `MockProvider`.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE REAL DOCUMENTATION ARRIVES
 * ---------------------------------------------------------------------------
 * Everything that needs to change is in this file. Specifically:
 *
 *   1. Set `configured` to depend on the credentials the docs actually
 *      require (NASFAMPAY_BASE_URL and NASFAMPAY_API_KEY are already wired
 *      through `config/env.ts` as placeholders — rename or extend as needed).
 *   2. Implement `fulfil()` against the documented endpoint. It MUST:
 *        - pass `request.idempotencyKey` as the provider's client reference,
 *          so a retry cannot deliver twice;
 *        - map the provider's terminal states onto COMPLETED / FAILED, and
 *          anything ambiguous (timeout, 5xx, "processing") onto PENDING —
 *          never onto FAILED, because FAILED triggers a balance reversal;
 *        - return the provider's reference in `providerReference`;
 *        - keep the user-facing `message` generic and put provider text in
 *          `detail`.
 *   3. Implement `checkStatus()` if the API offers a lookup, and set
 *      `statusLookup: true` in `capabilities()`. The reconciliation job in
 *      `services/rewards.ts` will then resolve PENDING redemptions
 *      automatically.
 *   4. Map the reward catalogue onto the provider's product codes. Data
 *      bundles and Stars packs almost certainly need a code per SKU; store it
 *      on `rewardProducts` rather than hardcoding it here.
 *   5. Add a timeout and a bounded retry policy for *idempotent* calls only.
 *
 * Nothing outside this file should need to change.
 */
export class NasfamPayProvider implements RewardProvider {
  readonly name = 'nasfampay';

  /**
   * Always false: credentials alone do not make an unimplemented integration
   * work. This flips to a credential check only when `fulfil()` is real.
   */
  readonly configured = false;

  capabilities(): ProviderCapabilities {
    // The planned service list, recorded so the admin UI can show what is
    // coming. None of it is claimed to work yet.
    return {
      airtime: false,
      data: false,
      telegramStars: false,
      telegramPremium: false,
      statusLookup: false,
    };
  }

  unavailableReason(_kind: RewardKind): string | null {
    return 'Coming soon — awaiting the NasfamPay public API launch.';
  }

  async fulfil(_request: FulfilmentRequest): Promise<FulfilmentResult> {
    throw new ProviderNotConfiguredError(
      this.name,
      'The NasfamPay integration is not implemented yet: their public API is still in development. ' +
        'Set REWARD_PROVIDER=mock for development, or keep it unset to show rewards as coming soon.',
    );
  }

  /** True once real credentials are present — used only for admin diagnostics. */
  get hasCredentials(): boolean {
    return Boolean(env.NASFAMPAY_BASE_URL && env.NASFAMPAY_API_KEY);
  }
}
