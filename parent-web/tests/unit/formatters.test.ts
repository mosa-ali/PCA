// The bug these formatters exist to prevent, observed in the running app:
//
//     ينتهي بتاريخ October 3, 2026
//
// -- an English month name inside an Arabic sentence, because the call site
// passed `undefined` as the locale, which means "the host browser's locale",
// not "the app's language".
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_VALUE,
  formatDate,
  formatDateTime,
  formatMinutes,
  formatNumber,
  formatRelative,
  formatTime,
} from '../../src/i18n/formatters';

const ISO = '2026-10-03T21:30:00.000Z';

afterEach(() => {
  vi.useRealTimers();
});

describe('the language argument is honoured, never the host locale', () => {
  it('renders an Arabic month name for ar and an English one for en', () => {
    const en = formatDate(ISO, 'en');
    const ar = formatDate(ISO, 'ar');
    expect(en).toMatch(/October/);
    // The whole point: the Arabic rendering must NOT contain the English month.
    expect(ar).not.toMatch(/October/);
    expect(ar).not.toBe(en);
  });

  it('renders a locale-specific date-time and time', () => {
    expect(formatDateTime(ISO, 'ar')).not.toBe(formatDateTime(ISO, 'en'));
    expect(formatTime(ISO, 'ar')).not.toBe(formatTime(ISO, 'en'));
  });

  it('renders locale-specific numbers and durations', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234');
    // Modern CLDR gives plain `ar` Latin digits, so the digit SHAPE is not the
    // signal here -- a region/numbering-system tag is. What must differ under
    // Arabic is the unit word, which is where an English "minutes" would
    // otherwise end up glued into an Arabic sentence.
    expect(formatNumber(1234, 'ar-EG')).not.toBe(formatNumber(1234, 'en'));
    expect(formatMinutes(45, 'ar')).not.toBe(formatMinutes(45, 'en'));
    expect(formatMinutes(45, 'ar')).not.toMatch(/minutes/);
  });

  it('falls back to English, not to the host locale, for a malformed tag', () => {
    expect(formatDate(ISO, 'not a language tag!')).toBe(formatDate(ISO, 'en'));
    expect(formatDate(ISO, '')).toBe(formatDate(ISO, 'en'));
  });
});

describe('missing and invalid input renders a stable dash, never "Invalid Date"', () => {
  it.each([
    ['formatDate', formatDate],
    ['formatDateTime', formatDateTime],
    ['formatTime', formatTime],
    ['formatRelative', formatRelative],
  ] as const)('%s returns the dash for null / empty / unparseable input', (_name, fn) => {
    expect(fn(null, 'en')).toBe(NO_VALUE);
    expect(fn(undefined, 'en')).toBe(NO_VALUE);
    expect(fn('', 'en')).toBe(NO_VALUE);
    expect(fn('not-a-date', 'en')).toBe(NO_VALUE);
    expect(fn('not-a-date', 'en')).not.toMatch(/Invalid/i);
  });

  it('formatNumber and formatMinutes reject null and NaN rather than printing them', () => {
    expect(formatNumber(null, 'en')).toBe(NO_VALUE);
    expect(formatNumber(Number.NaN, 'en')).toBe(NO_VALUE);
    expect(formatNumber(Number.POSITIVE_INFINITY, 'en')).toBe(NO_VALUE);
    expect(formatMinutes(null, 'en')).toBe(NO_VALUE);
    expect(formatMinutes(Number.NaN, 'en')).toBe(NO_VALUE);
    // Zero is a real answer and must survive.
    expect(formatNumber(0, 'en')).toBe('0');
  });
});

describe('formatRelative keeps the dashboard behaviour it was lifted from', () => {
  it('uses minutes, then hours, then days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    expect(formatRelative('2026-10-03T11:48:00.000Z', 'en')).toMatch(/12 minutes ago/);
    expect(formatRelative('2026-10-03T07:00:00.000Z', 'en')).toMatch(/5 hours ago/);
    expect(formatRelative('2026-09-30T12:00:00.000Z', 'en')).toMatch(/3 days ago/);
  });

  it('localizes the relative phrase itself', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    const ar = formatRelative('2026-10-03T11:48:00.000Z', 'ar');
    expect(ar).not.toMatch(/minutes ago/);
    expect(ar).not.toBe(NO_VALUE);
  });
});
