import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

type FlatLocale = Record<string, string>;

function flatten(value: unknown, prefix = '', result: FlatLocale = {}): FlatLocale {
  if (Array.isArray(value)) {
    value.forEach((child, index) => flatten(child, `${prefix}[${index}]`, result));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    });
  } else {
    result[prefix] = String(value);
  }
  return result;
}

const EN = flatten(en);
const AR = flatten(ar);
const REVIEW_METADATA_PREFIX = '_arReviewPending';

const LATIN_ALLOWLIST: Readonly<Record<string, RegExp>> = {
  'app.nameShort': /^PCA$/,
  'deviceEnrollment.platformIos': /iOS/,
  'deviceEnrollment.dskFingerprint': /DSK/,
  'deviceEnrollment.dekFingerprint': /DEK/,
  'webProtection.addDomainPlaceholder': /^example\.com$/,
  'protectionStatus.triggers.CRITICAL_PERMISSION_OR_VPN_LOST': /VPN/,
  'permissionsPolicy.permissions.foregroundService.purpose': /VPN/,
  'permissionsPolicy.permissions.foregroundServiceSpecialUse.purpose': /VPN/,
  'downloadApp.iosPlanned': /iOS/,
};

function userFacingArabicEntries(): Array<[string, string]> {
  return Object.entries(AR).filter(([key]) => !key.startsWith(REVIEW_METADATA_PREFIX));
}

function withoutInterpolation(value: string): string {
  return value.replace(/\{\{\s*[^}]+?\s*\}\}/g, '');
}

describe('Arabic Parent Web locale contract', () => {
  it('keeps Arabic and English locale key sets exactly aligned', () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('has no prohibited parent-app or child-app terminology', () => {
    const prohibited = /PCA\s+(?:Parent|Child|Platform\s+Admin)|تطبيق\s+(?:الوالدين|الآباء|الطفل)|منصة\s+الآباء/;
    const offenders = userFacingArabicEntries()
      .filter(([, value]) => prohibited.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it('contains no unapproved Latin in user-facing Arabic values', () => {
    const offenders: string[] = [];
    for (const [key, value] of userFacingArabicEntries()) {
      const visible = withoutInterpolation(value);
      const matches = [...visible.matchAll(/[A-Za-z]+/g)];
      if (matches.length === 0) continue;
      const allowed = LATIN_ALLOWLIST[key];
      if (!allowed || !allowed.test(visible)) {
        offenders.push(`${key}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not copy English values into Arabic except concrete URL/brand identifiers', () => {
    const offenders = Object.entries(AR)
      .filter(([key]) => !key.startsWith(REVIEW_METADATA_PREFIX))
      .filter(([key, _value]) => AR[key] === EN[key] && !['app.nameShort', 'shell.languageArabic', 'webProtection.addDomainPlaceholder'].includes(key))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it('uses the approved product journey terminology', () => {
    expect(Object.values(AR).join('\n')).not.toMatch(/تطبيق الوالدين|تطبيق الآباء|تطبيق الطفل|PCA Parent|PCA Child|PCA Platform Admin/);
    expect(AR['app.name']).toBe('منصة الوالدين');
    expect(AR['deviceEnrollment.instruction1']).toBe('ثبِّت تطبيق حماية الطفل.');
    expect(AR['downloadApp.title']).toBe('تنزيل تطبيق حماية الطفل');
    expect(AR['auth.loginTitle']).toBe('تسجيل الدخول إلى منصة الوالدين');
  });
});
