import { describe, expect, it } from 'vitest';
import {
  addKobo, assertPositiveKobo, formatCount, formatNaira, isKobo, koboToNaira,
  MoneyError, multiplyKobo, nairaToKobo, parseNairaInput, percentageOf, subtractKobo,
} from './money';

describe('kobo validation', () => {
  it('accepts safe integers in range', () => {
    expect(isKobo(0)).toBe(true);
    expect(isKobo(-100)).toBe(true);
    expect(isKobo(100_000_000_000)).toBe(true);
  });

  it('rejects floats, NaN and out-of-range values', () => {
    expect(isKobo(10.5)).toBe(false);
    expect(isKobo(Number.NaN)).toBe(false);
    expect(isKobo(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isKobo(100_000_000_001)).toBe(false);
    expect(isKobo('100')).toBe(false);
  });

  it('assertPositiveKobo rejects zero and negatives', () => {
    expect(() => assertPositiveKobo(0)).toThrow(MoneyError);
    expect(() => assertPositiveKobo(-1)).toThrow(MoneyError);
    expect(assertPositiveKobo(1)).toBe(1);
  });
});

describe('naira <-> kobo conversion', () => {
  it('converts whole naira', () => {
    expect(nairaToKobo(1_000)).toBe(100_000);
    expect(nairaToKobo(300)).toBe(30_000);
    expect(koboToNaira(30_000)).toBe(300);
  });

  it('rounds fractional naira deterministically instead of inheriting float drift', () => {
    expect(nairaToKobo(0.1)).toBe(10);
    expect(nairaToKobo(1.005)).toBe(101);
    expect(nairaToKobo(10_683)).toBe(1_068_300);
  });

  it('rejects non-finite input', () => {
    expect(() => nairaToKobo(Number.NaN)).toThrow(MoneyError);
  });
});

describe('arithmetic stays exact', () => {
  it('sums without float error', () => {
    // 0.1 + 0.2 in naira is the classic float trap; in kobo it is exact.
    expect(addKobo(10, 20)).toBe(30);
    let total = 0;
    for (let i = 0; i < 1_000; i += 1) total = addKobo(total, 10);
    expect(total).toBe(10_000);
    expect(koboToNaira(total)).toBe(100);
  });

  it('subtracts and multiplies', () => {
    expect(subtractKobo(100_000, 30_000)).toBe(70_000);
    expect(multiplyKobo(15_000, 333)).toBe(4_995_000);
  });

  it('refuses to overflow the representable range', () => {
    expect(() => addKobo(100_000_000_000, 1)).toThrow(MoneyError);
  });
});

describe('formatNaira', () => {
  it('renders whole naira with grouping and no trailing kobo', () => {
    expect(formatNaira(485_000)).toBe('₦4,850');
    expect(formatNaira(0)).toBe('₦0');
    expect(formatNaira(10_000)).toBe('₦100');
  });

  it('renders kobo only when present', () => {
    expect(formatNaira(485_050)).toBe('₦4,850.50');
    expect(formatNaira(485_005)).toBe('₦4,850.05');
    expect(formatNaira(10_000, { alwaysShowKobo: true })).toBe('₦100.00');
  });

  it('places the minus sign before the currency symbol', () => {
    expect(formatNaira(-30_000)).toBe('-₦300');
    expect(formatNaira(30_000, { signed: true })).toBe('+₦300');
  });

  it('supports compact headline figures', () => {
    expect(formatNaira(nairaToKobo(1_250_000), { compact: true })).toBe('₦1.25M');
    expect(formatNaira(nairaToKobo(31_450), { compact: true })).toBe('₦31.45K');
  });

  it('never throws on malformed input', () => {
    expect(formatNaira(Number.NaN)).toBe('₦0');
  });
});

describe('parseNairaInput', () => {
  it('accepts human input', () => {
    expect(parseNairaInput('1,500')).toBe(150_000);
    expect(parseNairaInput(' ₦300 ')).toBe(30_000);
    expect(parseNairaInput('10.50')).toBe(1_050);
  });

  it('rejects junk rather than coercing to zero', () => {
    expect(parseNairaInput('')).toBeNull();
    expect(parseNairaInput('abc')).toBeNull();
    expect(parseNairaInput('1.234')).toBeNull();
    expect(parseNairaInput('1e5')).toBeNull();
  });
});

describe('misc helpers', () => {
  it('percentageOf is safe when the total is zero', () => {
    expect(percentageOf(5, 0)).toBe(0);
    expect(percentageOf(123, 333)).toBeCloseTo(36.936, 2);
    expect(percentageOf(400, 100)).toBe(100);
  });

  it('formatCount groups and compacts', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(125_000, true)).toBe('125K');
  });
});
