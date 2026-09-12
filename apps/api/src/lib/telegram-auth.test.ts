import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from './telegram-auth';

const BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 6438544386, first_name: 'Gift', username: 'giftvisuals' }),
    ...overrides,
  };
}

describe('verifyInitData', () => {
  it('accepts data signed with the real algorithm and extracts the user', () => {
    const initData = signInitData(validFields({ start_param: 'ABCD2345' }), BOT_TOKEN);
    const result = verifyInitData(initData, BOT_TOKEN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user.id).toBe(6438544386);
    expect(result.data.user.username).toBe('giftvisuals');
    expect(result.data.startParam).toBe('ABCD2345');
  });

  it('rejects a payload signed with a different bot token', () => {
    const initData = signInitData(validFields(), BOT_TOKEN);
    const result = verifyInitData(initData, '7000000000:AAdifferentTokenEntirely_0123456789');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a tampered user id even though the hash is present', () => {
    const initData = signInitData(validFields(), BOT_TOKEN);
    // An attacker swaps themselves for the primary admin's id.
    const tampered = initData.replace('6438544386', '1111111111');
    const result = verifyInitData(tampered, BOT_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects an added field that was not part of the signature', () => {
    const initData = `${signInitData(validFields(), BOT_TOKEN)}&is_admin=true`;
    const result = verifyInitData(initData, BOT_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects stale data outside the replay window', () => {
    const oneHourAgo = String(Math.floor(Date.now() / 1000) - 3600);
    const initData = signInitData(validFields({ auth_date: oneHourAgo }), BOT_TOKEN);
    const result = verifyInitData(initData, BOT_TOKEN);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('EXPIRED');
  });

  it('accepts stale data when the caller widens the window', () => {
    const tenMinutesAgo = String(Math.floor(Date.now() / 1000) - 600);
    const initData = signInitData(validFields({ auth_date: tenMinutesAgo }), BOT_TOKEN);
    expect(verifyInitData(initData, BOT_TOKEN, { maxAgeSeconds: 3600 }).ok).toBe(true);
  });

  it('rejects data with no hash at all', () => {
    const result = verifyInitData('auth_date=123&user=%7B%7D', BOT_TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('MISSING_HASH');
  });

  it('rejects a correctly signed payload that carries no user', () => {
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)) }, BOT_TOKEN);
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('MISSING_USER');
  });

  it('rejects a signed payload whose user id is not a positive integer', () => {
    const initData = signInitData(
      validFields({ user: JSON.stringify({ id: -5, first_name: 'X' }) }),
      BOT_TOKEN,
    );
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('BAD_USER');
  });

  it('rejects empty and oversized input without throwing', () => {
    expect(verifyInitData('', BOT_TOKEN).ok).toBe(false);
    expect(verifyInitData('a'.repeat(9000), BOT_TOKEN).ok).toBe(false);
  });
});
