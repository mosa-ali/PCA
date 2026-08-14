import { describe, expect, it } from 'vitest';
import { formatMoney, parseExactMinorUnits, SUPPORTED_CURRENCIES, isSupportedCurrency } from '../../src/money/money';

describe('money utility', () => {
  it('only supports USD, SAR, YER (EUR excluded per PCA-ADD-BILL-019)', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(['USD', 'SAR', 'YER']);
    expect(isSupportedCurrency('EUR')).toBe(false);
    expect(isSupportedCurrency('USD')).toBe(true);
  });

  it('formats an integer minor-unit amount without float arithmetic on the stored value', () => {
    expect(formatMoney({ amountMinor: 1999, currencyCode: 'USD' }, 'en-US')).toBe('$19.99');
    expect(formatMoney({ amountMinor: 0, currencyCode: 'USD' }, 'en-US')).toBe('$0.00');
  });

  it('rejects a non-integer amountMinor', () => {
    expect(() => formatMoney({ amountMinor: 19.99 as unknown as number, currencyCode: 'USD' })).toThrow(TypeError);
  });

  it('parseExactMinorUnits converts a decimal string to an exact integer, avoiding the classic *100 float bug', () => {
    // 19.99 * 100 in naive float math is 1998.9999999999998 -- this must be exactly 1999.
    expect(parseExactMinorUnits('19.99', 'USD')).toBe(1999);
    expect(parseExactMinorUnits('0.10', 'USD')).toBe(10);
    expect(parseExactMinorUnits('100', 'USD')).toBe(10000);
    expect(parseExactMinorUnits('0', 'USD')).toBe(0);
  });

  it('rejects malformed or out-of-range amount strings', () => {
    expect(() => parseExactMinorUnits('-5', 'USD')).toThrow();
    expect(() => parseExactMinorUnits('12.999', 'USD')).toThrow();
    expect(() => parseExactMinorUnits('abc', 'USD')).toThrow();
    expect(() => parseExactMinorUnits('', 'USD')).toThrow();
    expect(() => parseExactMinorUnits('1.5e3', 'USD')).toThrow();
  });

  it('round-trips format(parse(x)) for a representative set of amounts', () => {
    const expected: Record<string, string> = {
      '0.01': '$0.01',
      '1.00': '$1.00',
      '19.99': '$19.99',
      '1234.56': '$1,234.56',
    };
    for (const [input, want] of Object.entries(expected)) {
      const minor = parseExactMinorUnits(input, 'USD');
      expect(formatMoney({ amountMinor: minor, currencyCode: 'USD' }, 'en-US')).toBe(want);
    }
  });
});
