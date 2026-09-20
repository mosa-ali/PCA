import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

function visibleValues(value: unknown, path = ''): Array<[string, string]> {
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => visibleValues(child, path ? `${path}.${key}` : key));
  }
  return typeof value === 'string' && !path.startsWith('_arReviewPending') ? [[path, value]] : [];
}

describe('Parent Web editorial guard', () => {
  it('keeps banned family terminology and security implementation jargon out of displayed locale copy', () => {
    const englishBanned = /\bfamily\b|\bsalted\b|slow\s+verifier|deliberately\s+slow|trust[- ]set|\bepoch\b|crypto-review|something went wrong|unknown error/i;
    const arabicBanned = /عائل|أسرة|أفراد الأسرة|أفراد العائلة|مملّح|مملّحة|متعمّد البطء|حقبة|مجموعة الثقة|فك التشفير|حدث خطأ ما/;

    expect(visibleValues(en).filter(([, value]) => englishBanned.test(value))).toEqual([]);
    expect(visibleValues(ar).filter(([, value]) => arabicBanned.test(value))).toEqual([]);
  });

  it('keeps the management-code explanation parent-friendly in both locales', () => {
    const enPin = visibleValues(en).find(([path]) => path === 'protectionAdministration.pinBody')?.[1];
    const arPin = visibleValues(ar).find(([path]) => path === 'protectionAdministration.pinBody')?.[1];

    expect(enPin).toBe('Choose a management code with at least 6 digits. The code is stored securely. Repeated incorrect attempts will temporarily increase the waiting time.');
    expect(arPin).toBe('اختر رمز إدارة مكوّنًا من 6 أرقام على الأقل. يُحفظ الرمز بطريقة آمنة. وتزداد مدة الانتظار مؤقتًا بعد المحاولات غير الصحيحة المتكررة.');
  });
});
