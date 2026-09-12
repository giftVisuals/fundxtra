import { describe, expect, it } from 'vitest';
import { BLOCKED_PINS, LIMITS } from './constants';
import { pinSchema } from './schemas';

/**
 * Which PINs a user may choose.
 *
 * The rule has to be explainable, because the user is told their PIN is "too
 * easy to guess" and deserves that to be consistent. Three categories are
 * refused — one digit repeated, four consecutive digits, and two notoriously
 * common codes — and nothing else. An earlier hand-written list refused 1010
 * and 1212 while allowing 2020 and 3030, which is the inconsistency these
 * tests exist to prevent returning.
 */

const accepts = (pin: string) => pinSchema.safeParse(pin).success;

describe('PINs that must be refused', () => {
  it('refuses one digit repeated four times', () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(accepts(String(digit).repeat(4))).toBe(false);
    }
  });

  it('refuses ascending runs, including the 7890 wrap', () => {
    for (const pin of ['0123', '1234', '4567', '6789', '7890', '8901', '9012']) {
      expect(accepts(pin)).toBe(false);
    }
  });

  it('refuses descending runs, including the 0987 wrap', () => {
    for (const pin of ['3210', '4321', '9876', '6543', '0987', '1098', '2109']) {
      expect(accepts(pin)).toBe(false);
    }
  });

  it('refuses the two notoriously common codes', () => {
    // 1004 leads every leaked-PIN dataset; 2580 is a straight line down a keypad.
    expect(accepts('1004')).toBe(false);
    expect(accepts('2580')).toBe(false);
  });
});

describe('PINs that must be accepted', () => {
  it('accepts alternating pairs, which are no weaker than any other pair', () => {
    for (const pin of ['3030', '2020', '1010', '0101', '1212', '2121', '2323', '9090']) {
      expect(accepts(pin)).toBe(true);
    }
  });

  it('accepts ordinary PINs', () => {
    for (const pin of ['7391', '4802', '9137', '5061', '8264']) {
      expect(accepts(pin)).toBe(true);
    }
  });

  it('accepts a repeated digit that is not the whole PIN', () => {
    for (const pin of ['1141', '7727', '3003', '5155']) {
      expect(accepts(pin)).toBe(true);
    }
  });
});

describe('shape', () => {
  it('requires exactly the configured number of digits', () => {
    expect(accepts('303')).toBe(false);
    expect(accepts('30300')).toBe(false);
    expect(LIMITS.PIN_LENGTH).toBe(4);
  });

  it('refuses anything that is not digits', () => {
    for (const pin of ['30 0', 'abcd', '30.0', '', '３０３０']) {
      expect(accepts(pin)).toBe(false);
    }
  });
});

describe('the denylist itself', () => {
  it('stays small, because rate limiting is the real defence', () => {
    // A denylist only needs the codes a stranger would try first. Growing it
    // into the hundreds would reject legitimate choices for no real gain.
    expect(BLOCKED_PINS.length).toBeLessThan(60);
    expect(BLOCKED_PINS.length).toBeGreaterThan(20);
  });

  it('contains only well-formed, unique PINs', () => {
    expect(new Set(BLOCKED_PINS).size).toBe(BLOCKED_PINS.length);
    for (const pin of BLOCKED_PINS) {
      expect(pin).toMatch(/^\d{4}$/);
    }
  });
});
