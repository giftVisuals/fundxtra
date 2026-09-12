import { env, isProduction } from '../config/env';
import { logger } from '../lib/logger';
import { MockProvider } from './mock';
import { NasfamPayProvider } from './nasfampay';
import { NoneProvider } from './none';
import type { RewardProvider } from './types';

export * from './types';
export { MockProvider } from './mock';
export { NasfamPayProvider } from './nasfampay';
export { NoneProvider } from './none';

/**
 * Provider registry.
 *
 * One place decides which implementation is live, from one environment
 * variable. Adding a provider means adding a case here and a file next to it —
 * nothing in the reward service changes.
 */

let instance: RewardProvider | null = null;

export function resolveProvider(name: string = env.REWARD_PROVIDER): RewardProvider {
  switch (name) {
    case 'mock':
      if (isProduction) {
        // A mock in production would report deliveries that never happened.
        logger.error('REWARD_PROVIDER=mock is not permitted in production; falling back to none');
        return new NoneProvider();
      }
      return new MockProvider();
    case 'nasfampay':
      return new NasfamPayProvider();
    case 'none':
      return new NoneProvider();
    default:
      logger.warn({ name }, 'Unknown REWARD_PROVIDER; falling back to none');
      return new NoneProvider();
  }
}

/** The process-wide provider. Cached so MockProvider keeps its delivery log. */
export function provider(): RewardProvider {
  if (!instance) {
    instance = resolveProvider();
    logger.info({ provider: instance.name, configured: instance.configured }, 'Reward provider ready');
  }
  return instance;
}

/** Test seam. */
export function setProvider(next: RewardProvider | null): void {
  instance = next;
}
