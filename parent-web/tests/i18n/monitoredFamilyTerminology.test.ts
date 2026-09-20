import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

function text(locale: unknown, path: string): string {
  const value = path.split('.').reduce<unknown>((current, part) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, locale);
  expect(typeof value).toBe('string');
  return value as string;
}

describe('monitored-family terminology boundaries', () => {
  it('uses Children wording for parent-visible monitored data in both locales', () => {
    expect(text(en, 'deviceEnrollment.consentMonitored')).toContain("children's");
    expect(text(en, 'deviceEnrollment.consentNotMonitored')).toContain("your children's devices");
    expect(text(en, 'deviceEnrollment.consentMonitored')).not.toContain('The family');

    expect(text(ar, 'deviceEnrollment.consentMonitored')).toContain('أطفالك');
    expect(text(ar, 'deviceEnrollment.consentNotMonitored')).toContain('أجهزة أطفالك');
    expect(text(ar, 'deviceEnrollment.consentMonitored')).not.toContain('العائلة');
  });

  it('uses Parent account and protection language for account-facing boundaries', () => {
    expect(text(en, 'nav.family')).toBe('Parent account');
    expect(text(en, 'nav.familyMembers')).toBe('Parents & Guardians');
    expect(text(en, 'trustedBrowser.BROWSER_NOT_TRUSTED')).toBe('This browser is not trusted for protected information yet.');
    expect(text(en, 'trustedBrowser.trustSetEpoch')).toBe('Security status');

    expect(text(ar, 'nav.family')).toBe('حساب الوالدين');
    expect(text(ar, 'nav.familyMembers')).toBe('الوالدان ومقدمو الرعاية');
    expect(text(ar, 'trustedBrowser.BROWSER_NOT_TRUSTED')).toBe('هذا المتصفح غير موثوق بعد لعرض المعلومات المحمية.');
    expect(text(ar, 'trustedBrowser.trustSetEpoch')).toBe('حالة الأمان');
  });
});
