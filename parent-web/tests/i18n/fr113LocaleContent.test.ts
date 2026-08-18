import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';
import { isRtl } from '../../src/i18n';

function flatten(value: unknown, prefix = '', result: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    result[prefix] = value;
  }
  return result;
}

function text(locale: unknown, path: string): string {
  const value = path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, locale);
  expect(typeof value).toBe('string');
  return value as string;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1]).sort();
}

const TARGET_KEYS = [
  'privacy.childDataNotice',
  'privacy.serverNotice',
  'privacy.notAUniversalView',
  'deviceEnrollment.invitationSecurityNotice',
  'deviceEnrollment.pairingSecurityNotice',
  'location.safeZoneBoundaryNotice',
  'youtube.modeA',
  'youtube.modeB',
  'youtube.capabilityNotice',
  'export.scopeNotice',
  'export.externalCopyNotice',
  'retention.localEnforcementNotice',
  'retention.auditRetentionNotice',
  'deleteNow.scopeNotice',
  'deleteNow.offlineNotice',
  'deleteNow.externalCopyNotice',
  'deleteNow.secureEraseNotice',
  'requestsPage.decisionNotice',
  'devicesTable.removalNotice',
  'reports.description',
  'reports.unavailable',
  'reports.stale',
  'reports.appUsageOnly',
  'reports.locationApproximate',
  'reports.modeBEvents',
  'transparency.scopeNotice',
] as const;

describe('PCA-FR-113 parent-web locale contract', () => {
  it('keeps English and Arabic leaf-key sets exactly identical', () => {
    const enKeys = Object.keys(flatten(en)).sort();
    const arKeys = Object.keys(flatten(ar)).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it('keeps named interpolation placeholders identical between locales', () => {
    const enFlat = flatten(en);
    const arFlat = flatten(ar);
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(String(arFlat[key]))).toEqual(placeholders(String(enFlat[key])));
    }
  });

  it('provides non-empty English and Arabic copy for every FR-113 notice surface', () => {
    for (const key of TARGET_KEYS) {
      expect(text(en, key).trim(), `English ${key}`).not.toBe('');
      expect(text(ar, key).trim(), `Arabic ${key}`).not.toBe('');
    }
  });

  it('keeps Arabic RTL and the monitored-family/child terminology boundary', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);

    expect(text(en, 'deviceEnrollment.consentMonitored')).toContain("children's");
    expect(text(en, 'deviceEnrollment.consentMonitored')).not.toContain('The family');
    expect(text(en, 'retention.description')).toContain("children's activity");
    expect(text(en, 'deleteNow.description')).toContain("children's devices");
    expect(text(ar, 'deviceEnrollment.consentMonitored')).toContain('أطفالك');
    expect(text(ar, 'deviceEnrollment.consentMonitored')).not.toContain('العائلة');
    expect(text(ar, 'retention.description')).toContain('نشاط أطفالك');
    expect(text(ar, 'deleteNow.description')).toContain('أجهزة أطفالك');
  });
});

describe('PCA-FR-113 honest capability and privacy notices', () => {
  it('states that deletion is local/pending-aware and does not erase external copies', () => {
    expect(text(en, 'retention.localEnforcementNotice')).toContain('local copy');
    expect(text(en, 'deleteNow.offlineNotice')).toContain('cannot be reported as erased');
    expect(text(en, 'deleteNow.externalCopyNotice')).toContain('does not erase');
    expect(text(ar, 'retention.localEnforcementNotice')).toContain('النسخة المحلية');
    expect(text(ar, 'deleteNow.offlineNotice')).toContain('معلّقاً');
    expect(text(ar, 'deleteNow.externalCopyNotice')).toContain('لا يحذف');
  });

  it('discloses export scope and the external-copy boundary', () => {
    expect(text(en, 'export.description')).toContain('not yet a downloadable file');
    expect(text(en, 'export.externalCopyNotice')).toContain('external copy');
    expect(text(ar, 'export.description')).toContain('ليس بعد ملفاً قابلاً للتنزيل');
    expect(text(ar, 'export.externalCopyNotice')).toContain('نسخة خارجية');
  });

  it('does not turn unsupported YouTube evidence into a normal-app watch-history claim', () => {
    expect(text(en, 'youtube.modeA')).toContain('app-usage duration only');
    expect(text(en, 'youtube.modeA')).toContain('does not show an exact video list');
    expect(text(en, 'youtube.modeB')).toContain('started inside that player');
    expect(text(en, 'reports.modeBEvents')).toContain('do not claim normal-app watch history');
    expect(text(ar, 'youtube.modeA')).toContain('مدة استخدام التطبيق فقط');
    expect(text(ar, 'youtube.modeA')).toContain('لا تعرض PCA قائمة فيديوهات دقيقة');
    expect(text(ar, 'youtube.modeB')).toContain('تبدأ داخل ذلك المشغّل');
    expect(text(ar, 'reports.modeBEvents')).toContain('ولا تدعي سجل المشاهدة');
  });

  it('labels safe zones and reports with bounded capability language', () => {
    expect(text(en, 'location.safeZoneBoundaryNotice')).toContain('not continuous live tracking');
    expect(text(en, 'reports.unavailable')).toContain('does not mean zero activity');
    expect(text(en, 'reports.locationApproximate')).toContain('not a continuous precise GPS trace');
    expect(text(ar, 'location.safeZoneBoundaryNotice')).toContain('ليست تتبعاً مباشراً مستمراً');
    expect(text(ar, 'reports.unavailable')).toContain('لا يعني عدم وجود نشاط');
    expect(text(ar, 'reports.locationApproximate')).toContain('وليس مسار GPS دقيقاً');
  });

  it('separates child-request decisions and device removal from Delete Now', () => {
    expect(text(en, 'requestsPage.decisionNotice')).toContain('authorized parent role');
    expect(text(en, 'devicesTable.removalNotice')).toContain('separate from Delete Now');
    expect(text(ar, 'requestsPage.decisionNotice')).toContain('أدوار الوالدين المخوّلة');
    expect(text(ar, 'devicesTable.removalNotice')).toContain('منفصل عن إجراء الحذف الآن');
  });
});
