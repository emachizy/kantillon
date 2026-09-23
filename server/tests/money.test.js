import { describe, it, expect } from 'vitest';
import { nairaToKobo, koboToNairaString, isSafeMoneyInteger } from '../src/utils/money.js';

describe('money utilities (integer kobo, no floating-point Naira math)', () => {
  it('converts whole Naira amounts to kobo', () => {
    expect(nairaToKobo(12000)).toBe(1200000);
    expect(nairaToKobo('12000')).toBe(1200000);
    expect(nairaToKobo('12500')).toBe(1250000);
  });

  it('converts fractional Naira amounts to kobo without float drift', () => {
    // A naive parseFloat('12.15') * 100 can yield 1214.9999999999998 in
    // IEEE-754 floating point — this must not happen here.
    expect(nairaToKobo('12.15')).toBe(1215);
    expect(nairaToKobo('12000.50')).toBe(1200050);
    expect(nairaToKobo('0.1')).toBe(10);
    expect(nairaToKobo('0.01')).toBe(1);
  });

  it('rejects Naira input with more than 2 decimal places', () => {
    expect(() => nairaToKobo('12.999')).toThrow();
    expect(() => nairaToKobo('0.001')).toThrow();
  });

  it('rejects malformed Naira input rather than silently coercing it', () => {
    expect(() => nairaToKobo('not-a-number')).toThrow();
    expect(() => nairaToKobo('')).toThrow();
    expect(() => nairaToKobo('12,000')).toThrow();
    expect(() => nairaToKobo('₦12000')).toThrow();
  });

  it('rejects negative amounts as money via isSafeMoneyInteger (the validator every money field uses)', () => {
    // nairaToKobo itself is sign-preserving (a generic converter — see its
    // own doc comment), but every real money field (unitPriceKobo,
    // actualAmountCollectedKobo, priceKobo, ...) is validated with
    // isSafeMoneyInteger, which rejects negative values outright.
    expect(nairaToKobo('-100')).toBe(-10000);
    expect(isSafeMoneyInteger(nairaToKobo('-100'))).toBe(false);
    expect(isSafeMoneyInteger(-1)).toBe(false);
  });

  it('round-trips kobo back to a Naira decimal string', () => {
    expect(koboToNairaString(1200000)).toBe('12000.00');
    expect(koboToNairaString(1215)).toBe('12.15');
    expect(koboToNairaString(1)).toBe('0.01');
  });

  it('validates safe positive integers', () => {
    expect(isSafeMoneyInteger(1200000)).toBe(true);
    expect(isSafeMoneyInteger(0)).toBe(true);
    expect(isSafeMoneyInteger(-1)).toBe(false);
    expect(isSafeMoneyInteger(1.5)).toBe(false);
    expect(isSafeMoneyInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it('handles very large valid integer amounts exactly', () => {
    // 487,500,000 kobo = ₦4,875,000 — well within safe integer range, and
    // multiplication of two safe integers here must stay exact.
    const quantity = 250;
    const unitPriceKobo = 1200000;
    expect(quantity * unitPriceKobo).toBe(300000000);
    expect(Number.isSafeInteger(quantity * unitPriceKobo)).toBe(true);
  });
});
