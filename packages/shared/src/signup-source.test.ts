import { describe, expect, it } from 'vitest';
import {
  SIGNUP_SOURCES,
  SIGNUP_SOURCE_CODES,
  isReservedReferralCode,
  isSignupSource,
  toSignupSource,
} from './constants';

/**
 * Telling a channel name apart from a referral code.
 *
 * Both arrive in the same `?start=` payload, and the consequences differ: one
 * records where a signup came from, the other pays ₦100 to a referrer. A
 * channel name matched as a referral code would look up a referrer that does
 * not exist; a referral code swallowed as a channel name would cost someone
 * their reward.
 */

describe('reserved channel names', () => {
  it('recognises every declared source', () => {
    for (const code of SIGNUP_SOURCE_CODES) {
      expect(isSignupSource(code)).toBe(true);
      expect(toSignupSource(code)).toBe(code);
    }
  });

  it('is case and whitespace insensitive, as a pasted link can be', () => {
    expect(toSignupSource('Website')).toBe('website');
    expect(toSignupSource('WEBSITE')).toBe('website');
    expect(toSignupSource('  website  ')).toBe('website');
  });

  it('carries a human label for every code', () => {
    for (const code of SIGNUP_SOURCE_CODES) {
      expect(SIGNUP_SOURCES[code].length).toBeGreaterThan(1);
    }
  });
});

describe('referral codes must not be mistaken for channels', () => {
  it('treats a generated-looking code as not a source', () => {
    for (const code of ['GIFT2026', 'ABCD2345', 'XY9Z7QRS', 'A2B3C4D5']) {
      expect(toSignupSource(code)).toBeNull();
    }
  });

  it('is rejected by referral code generation when it could be drawn', () => {
    /*
      Codes are 8 characters from an uppercase alphabet with no I, O, 0 or 1.
      WHATSAPP and TELEGRAM satisfy that exactly, so they are reachable by
      chance — about one in a trillion, and the cost is a user who is silently
      never credited for a referral, because the payload is read as a channel
      before any referrer lookup.

      So the invariant is not "no source word is generatable"; it is "the
      generator refuses every source word". This asserts the second.
    */
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const reachable = SIGNUP_SOURCE_CODES.filter(
      (code) =>
        code.length === 8 && [...code.toUpperCase()].every((char) => alphabet.includes(char)),
    );
    expect(reachable).toEqual(['whatsapp', 'telegram']);

    for (const code of SIGNUP_SOURCE_CODES) {
      expect(isReservedReferralCode(code.toUpperCase())).toBe(true);
      expect(isReservedReferralCode(code)).toBe(true);
    }
  });

  it('does not reject an ordinary code', () => {
    for (const code of ['GIFT2026', 'ABCD2345', 'XY9Z7QRS']) {
      expect(isReservedReferralCode(code)).toBe(false);
    }
  });

  it('returns null for nothing at all', () => {
    expect(toSignupSource(null)).toBeNull();
    expect(toSignupSource(undefined)).toBeNull();
    expect(toSignupSource('')).toBeNull();
    expect(toSignupSource('   ')).toBeNull();
  });

  it('does not treat an inherited object property as a source', () => {
    // `hasOwnProperty` rather than `in`: otherwise "constructor" or "toString"
    // would read as a valid channel and swallow a referral code.
    expect(toSignupSource('constructor')).toBeNull();
    expect(toSignupSource('toString')).toBeNull();
    expect(toSignupSource('__proto__')).toBeNull();
  });
});
