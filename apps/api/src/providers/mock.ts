import type { RewardKind } from '@fundxtra/shared';
import { logger } from '../lib/logger';
import type {
  FulfilmentRequest,
  FulfilmentResult,
  ProviderCapabilities,
  RewardProvider,
} from './types';

/**
 * Development provider.
 *
 * Exists so the *whole* redemption path — debit, ledger entry, status
 * transitions, reversal on failure, admin views — can be exercised before any
 * real provider is available. It deliberately simulates the awkward cases as
 * well as the happy one, because the reversal and reconciliation logic is
 * exactly the code that never gets tested when a mock always succeeds.
 *
 * Behaviour is driven by the target so a developer can reproduce any outcome
 * on demand:
 *
 *   target contains "fail"     -> FAILED  (must reverse the user's balance)
 *   target contains "pending"  -> PENDING (must stay pending until resolved)
 *   anything else              -> COMPLETED
 *
 * Never selected in production: `resolveProvider` only returns this when
 * REWARD_PROVIDER=mock, and `/health` warns when that is set outside
 * development.
 */
export class MockProvider implements RewardProvider {
  readonly name = 'mock';
  readonly configured = true;

  /** Deliveries seen, keyed by idempotency key, to prove retries dedupe. */
  private readonly delivered = new Map<string, FulfilmentResult>();

  capabilities(): ProviderCapabilities {
    return {
      airtime: true,
      data: true,
      telegramStars: true,
      telegramPremium: true,
      statusLookup: true,
    };
  }

  unavailableReason(_kind: RewardKind): string | null {
    return null;
  }

  async fulfil(request: FulfilmentRequest): Promise<FulfilmentResult> {
    // Honour idempotency the way a real provider must: the same key returns
    // the same outcome rather than delivering again.
    const existing = this.delivered.get(request.idempotencyKey);
    if (existing) {
      logger.info({ key: request.idempotencyKey }, 'Mock provider replayed a delivery');
      return existing;
    }

    const target = request.target.toLowerCase();
    let result: FulfilmentResult;

    if (target.includes('fail')) {
      result = {
        status: 'FAILED',
        providerReference: null,
        message: 'The provider could not complete this delivery.',
        detail: 'Mock provider: target contained "fail"',
      };
    } else if (target.includes('pending')) {
      result = {
        status: 'PENDING',
        providerReference: `MOCK-${request.idempotencyKey.slice(-12)}`,
        message: 'Your reward is being processed.',
        detail: 'Mock provider: target contained "pending"',
      };
    } else {
      result = {
        status: 'COMPLETED',
        providerReference: `MOCK-${Date.now().toString(36).toUpperCase()}`,
        message: 'Delivered.',
        detail: `Mock provider delivered ${request.kind} to ${request.target}`,
      };
    }

    this.delivered.set(request.idempotencyKey, result);
    logger.info(
      { kind: request.kind, status: result.status, target: request.target },
      'Mock provider fulfilment',
    );
    return result;
  }

  async checkStatus(providerReference: string): Promise<FulfilmentResult> {
    for (const result of this.delivered.values()) {
      if (result.providerReference === providerReference) {
        // A pending mock delivery resolves to completed on first lookup, which
        // is what exercises the reconciliation path.
        if (result.status === 'PENDING') {
          const resolved: FulfilmentResult = {
            ...result,
            status: 'COMPLETED',
            message: 'Delivered.',
          };
          return resolved;
        }
        return result;
      }
    }
    return {
      status: 'FAILED',
      providerReference,
      message: 'We could not find that delivery.',
      detail: 'Mock provider has no record of this reference',
    };
  }
}
