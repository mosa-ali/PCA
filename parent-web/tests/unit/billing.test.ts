import { describe, expect, it } from 'vitest';
import { formatMoney, isQuoteExpired, isSupportedCurrency, isZeroMoney, suggestedDeviceTargets } from '../../src/domain/billing';
import type { MoneyJson, QuoteSnapshot } from '../../src/domain/billing';

describe('billing money model', () => {
  it('formats an exact USD amount without floating-point drift', () => {
    const money: MoneyJson = { amountMinor: '499', currencyCode: 'USD' };
    expect(formatMoney(money, 'en-US')).toBe('$4.99');
  });

  it('formats a large amount exactly (no precision loss)', () => {
    const money: MoneyJson = { amountMinor: '123456789', currencyCode: 'USD' };
    expect(formatMoney(money, 'en-US')).toBe('$1,234,567.89');
  });

  it('formats SAR and YER using their own currency symbols/codes', () => {
    expect(formatMoney({ amountMinor: '1000', currencyCode: 'SAR' }, 'en-US')).toContain('10');
    expect(formatMoney({ amountMinor: '1000', currencyCode: 'YER' }, 'en-US')).toContain('10');
  });

  it('treats a zero amount as zero money', () => {
    expect(isZeroMoney({ amountMinor: '0', currencyCode: 'USD' })).toBe(true);
    expect(isZeroMoney({ amountMinor: '1', currencyCode: 'USD' })).toBe(false);
  });

  it('recognizes only USD/SAR/YER as supported -- EUR is explicitly out of initial scope (PCA-DEC-024)', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('SAR')).toBe(true);
    expect(isSupportedCurrency('YER')).toBe(true);
    expect(isSupportedCurrency('EUR')).toBe(false);
  });
});

describe('suggestedDeviceTargets', () => {
  it('suggests 2/3/5 above the current limit, filtering out any at or below it', () => {
    expect(suggestedDeviceTargets(1)).toEqual([2, 3, 5]);
    expect(suggestedDeviceTargets(2)).toEqual([3, 5]);
    expect(suggestedDeviceTargets(5)).toEqual([]);
  });
});

describe('isQuoteExpired', () => {
  const baseQuote: QuoteSnapshot = {
    quoteKind: 'STANDARD',
    quoteRef: 'q1',
    price: { amountMinor: '100', currencyCode: 'USD' },
    priceBookVersion: 1,
    quotedAtUtc: '2026-01-01T00:00:00.000Z',
    expiresAtUtc: null,
  };

  it('a standard quote with no expiry never expires', () => {
    expect(isQuoteExpired(baseQuote, '2099-01-01T00:00:00.000Z')).toBe(false);
  });

  it('a custom quote expires once the clock passes expiresAtUtc', () => {
    const quote: QuoteSnapshot = { ...baseQuote, quoteKind: 'CUSTOM', expiresAtUtc: '2026-01-08T00:00:00.000Z' };
    expect(isQuoteExpired(quote, '2026-01-01T00:00:00.000Z')).toBe(false);
    expect(isQuoteExpired(quote, '2026-01-08T00:00:00.000Z')).toBe(true);
    expect(isQuoteExpired(quote, '2026-01-09T00:00:00.000Z')).toBe(true);
  });
});
