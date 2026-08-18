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

  it('keeps account, authority, and trust-boundary family terminology intact', () => {
    expect(text(en, 'rbac.deniedBody')).toContain('family authority gateway');
    expect(text(en, 'trustedBrowser.BROWSER_NOT_TRUSTED')).toContain('family decryption authority');
    expect(text(en, 'trustedBrowser.PAIRING_REQUIRED')).toContain('family data');
    expect(text(en, 'retention.description')).toContain('family-level policy');
    expect(text(en, 'trustedBrowser.trustSetEpoch')).toContain('Trust-set epoch');

    expect(text(ar, 'rbac.deniedBody')).toContain('سلطة العائلة');
    expect(text(ar, 'trustedBrowser.BROWSER_NOT_TRUSTED')).toContain('بيانات العائلة');
    expect(text(ar, 'retention.description')).toContain('على مستوى العائلة');
    expect(text(ar, 'trustedBrowser.trustSetEpoch')).toContain('حقبة');
  });
});
