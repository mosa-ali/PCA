import { describe, expect, it } from 'vitest';
import { applyDocumentDirection, isRtl } from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n / RTL', () => {
  it('treats ar (and ar-* variants) as RTL, and en as LTR', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('ar-SA')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });

  it('applyDocumentDirection sets dir="rtl" and lang="ar" for Arabic', () => {
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('applyDocumentDirection sets dir="ltr" and lang="en" for English', () => {
    applyDocumentDirection('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('every English translation key has an Arabic counterpart and vice versa (no hardcoded/missing strings)', () => {
    const enKeys = flattenKeys(en).sort();
    const arKeys = flattenKeys(ar).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it('no translation value is empty', () => {
    for (const locale of [en, ar]) {
      const values = flattenKeys(locale).map((key) =>
        key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], locale),
      );
      for (const value of values) {
        expect(typeof value === 'string' && value.length > 0).toBe(true);
      }
    }
  });
});
