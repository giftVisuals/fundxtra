import type { RewardKind } from '@fundxtra/shared';
import {
  ProviderNotConfiguredError,
  type FulfilmentRequest,
  type FulfilmentResult,
  type ProviderCapabilities,
  type RewardProvider,
} from './types';

/**
 * The default provider: none.
 *
 * Fundxtra ships with no fulfilment configured, which is the honest default —
 * the reward catalogue is visible and priced, every item is marked "coming
 * soon", and no redemption can debit a balance for something that cannot be
 * delivered. Failing closed here is what stops a misconfigured deployment from
 * taking users' money for undeliverable rewards.
 */
export class NoneProvider implements RewardProvider {
  readonly name = 'none';
  readonly configured = false;

  capabilities(): ProviderCapabilities {
    return {
      airtime: false,
      data: false,
      telegramStars: false,
      telegramPremium: false,
      statusLookup: false,
    };
  }

  unavailableReason(_kind: RewardKind): string | null {
    return 'Coming soon.';
  }

  async fulfil(_request: FulfilmentRequest): Promise<FulfilmentResult> {
    throw new ProviderNotConfiguredError(
      this.name,
      'No reward fulfilment provider is configured. Set REWARD_PROVIDER once a provider is available.',
    );
  }
}
