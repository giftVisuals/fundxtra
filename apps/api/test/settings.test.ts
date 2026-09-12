import { describe, expect, it } from 'vitest';
import { LIMITS } from '@fundxtra/shared';
import { defaultSettings, withdrawalAvailability } from '../src/services/settings';

/**
 * Withdrawal availability.
 *
 * The portal is the highest-consequence switch on the platform, and the
 * interaction between the manual toggle and the scheduled window is the part
 * that is easy to get wrong. These pin the precedence down.
 */

function settings(overrides: Partial<ReturnType<typeof defaultSettings>['withdrawals']> = {}) {
  const base = defaultSettings();
  return { ...base, withdrawals: { ...base.withdrawals, ...overrides } };
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

describe('withdrawal availability', () => {
  it('ships open for cash, but never pays out without an admin', () => {
    /*
      Cash withdrawals are open by default so a working platform is not gated
      behind a switch nobody knew to flip. The protection is not the closed
      portal, it is the approval: `requireManualApproval` means a request only
      ever queues, and money moves when a person approves it. Airtime, data,
      Stars and Premium stay off, because those need a fulfilment provider that
      does not exist yet.
    */
    const defaults = defaultSettings();

    expect(withdrawalAvailability(defaults).open).toBe(true);
    expect(defaults.withdrawals.requireManualApproval).toBe(true);
    expect(defaults.withdrawals.minAmountKobo).toBe(LIMITS.MIN_CASH_WITHDRAWAL_KOBO);

    expect(defaults.rewards.airtimeEnabled).toBe(false);
    expect(defaults.rewards.dataEnabled).toBe(false);
    expect(defaults.rewards.starsEnabled).toBe(false);
    expect(defaults.rewards.premiumEnabled).toBe(false);
  });

  it('still reports the maintenance message once an admin closes it', () => {
    const availability = withdrawalAvailability(settings({ enabled: false }));
    expect(availability.open).toBe(false);
    expect(availability.reason).toContain('Your balance is safe');
  });

  it('is open when enabled with no schedule', () => {
    expect(withdrawalAvailability(settings({ enabled: true })).open).toBe(true);
  });

  it('is closed when disabled, and reports the maintenance message', () => {
    const availability = withdrawalAvailability(
      settings({ enabled: false, maintenanceMessage: 'Opens Friday at 9am.' }),
    );
    expect(availability.open).toBe(false);
    expect(availability.reason).toBe('Opens Friday at 9am.');
  });

  it('a future scheduled open keeps the portal closed even when enabled', () => {
    // This is the precedence that matters: an admin schedules the window and
    // does not have to remember to flip the switch at the right moment.
    const availability = withdrawalAvailability(
      settings({ enabled: true, opensAt: inAnHour() }),
    );
    expect(availability.open).toBe(false);
    expect(availability.opensAt).toBeTruthy();
  });

  it('a past scheduled open lets the portal be open', () => {
    expect(
      withdrawalAvailability(settings({ enabled: true, opensAt: anHourAgo() })).open,
    ).toBe(true);
  });

  it('a passed scheduled close shuts the portal even when enabled', () => {
    const availability = withdrawalAvailability(
      settings({ enabled: true, opensAt: anHourAgo(), closesAt: anHourAgo() }),
    );
    expect(availability.open).toBe(false);
  });

  it('a future scheduled close leaves the portal open', () => {
    expect(
      withdrawalAvailability(
        settings({ enabled: true, opensAt: anHourAgo(), closesAt: inAnHour() }),
      ).open,
    ).toBe(true);
  });

  it('a schedule does not open a portal whose window has not started', () => {
    // enabled=false plus a window still in the future: closed, and the reason
    // is the "opens soon" message rather than the maintenance text.
    const availability = withdrawalAvailability(
      settings({ enabled: false, opensAt: inAnHour() }),
    );
    expect(availability.open).toBe(false);
    expect(availability.reason).toBe('Withdrawals open soon.');
  });
});

describe('default settings are fail-closed', () => {
  it('has every reward method switched off', () => {
    const { rewards } = defaultSettings();
    expect(rewards.airtimeEnabled).toBe(false);
    expect(rewards.dataEnabled).toBe(false);
    expect(rewards.starsEnabled).toBe(false);
    expect(rewards.premiumEnabled).toBe(false);
  });

  it('keeps task earning and referrals on, since those cost nothing to expose', () => {
    const settings = defaultSettings();
    expect(settings.tasks.earningEnabled).toBe(true);
    expect(settings.referrals.enabled).toBe(true);
    expect(settings.referrals.rewardKobo).toBe(10_000);
  });

  it('caps task rewards at ₦1,000 and requires manual withdrawal approval', () => {
    const settings = defaultSettings();
    expect(settings.tasks.maxRewardKobo).toBe(100_000);
    expect(settings.withdrawals.requireManualApproval).toBe(true);
    expect(settings.withdrawals.minAmountKobo).toBe(30_000);
  });
});
