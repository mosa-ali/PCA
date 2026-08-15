import { describe, expect, it } from 'vitest';
import { formatMoney, parseExactMinorUnits, parseMinorUnitsString, isDecimalIntegerString, SUPPORTED_CURRENCIES, isSupportedCurrency } from '../../src/money/money';

describe('money utility', () => {
  it('only supports USD, SAR, YER (EUR excluded per PCA-ADD-BILL-019)', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(['USD', 'SAR', 'YER']);
    expect(isSupportedCurrency('EUR')).toBe(false);
    expect(isSupportedCurrency('USD')).toBe(true);
  });

  it('formats a wire-shaped decimal-string amountMinor without float arithmetic on the stored value', () => {
    expect(formatMoney({ amountMinor: '1999', currencyCode: 'USD' }, 'en-US')).toBe('$19.99');
    expect(formatMoney({ amountMinor: '0', currencyCode: 'USD' }, 'en-US')).toBe('$0.00');
  });

  it('rejects a non-decimal-integer-string amountMinor', () => {
    expect(() => formatMoney({ amountMinor: '19.99', currencyCode: 'USD' })).toThrow(TypeError);
    expect(() => formatMoney({ amountMinor: 1999 as unknown as string, currencyCode: 'USD' })).toThrow(TypeError);
  });

  it('parseMinorUnitsString parses a wire decimal string to an exact BigInt', () => {
    expect(parseMinorUnitsString('1999')).toBe(1999n);
    expect(() => parseMinorUnitsString('19.99')).toThrow(TypeError);
    expect(() => parseMinorUnitsString('abc')).toThrow(TypeError);
  });

  it('isDecimalIntegerString validates the exact wire shape', () => {
    expect(isDecimalIntegerString('1999')).toBe(true);
    expect(isDecimalIntegerString('-5')).toBe(true);
    expect(isDecimalIntegerString('19.99')).toBe(false);
    expect(isDecimalIntegerString(1999)).toBe(false);
  });

  it('formatMoney handles amounts beyond Number.MAX_SAFE_INTEGER via pure BigInt math', () => {
    const huge = (BigInt(Number.MAX_SAFE_INTEGER) + 12345n).toString(10);
    const result = formatMoney({ amountMinor: huge, currencyCode: 'USD' }, 'en-US');
    expect(result).toContain('USD');
    expect(result).not.toContain('NaN');
  });

  it('parseExactMinorUnits converts a decimal string to an exact decimal-integer string, avoiding the classic *100 float bug', () => {
    // 19.99 * 100 in naive float math is 1998.9999999999998 -- this must be exactly "1999".
    expect(parseExactMinorUnits('19.99', 'USD')).toBe('1999');
    expect(parseExactMinorUnits('0.10', 'USD')).toBe('10');
    expect(parseExactMinorUnits('100', 'USD')).toBe('10000');
    expect(parseExactMinorUnits('0', 'USD')).toBe('0');
    expect(typeof parseExactMinorUnits('19.99', 'USD')).toBe('string');
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
