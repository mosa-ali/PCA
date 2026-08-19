// CURRENT_HEAD_MUTATION bounded tests for PCA-NFR-014, PCA-NFR-060, and
// PCA-NFR-051. This suite checks disclosure source and locale data, not a
// fabricated telemetry implementation.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');
const transparency = () => read('src/pages/privacy/Transparency.tsx');

const visibleKeys = [
  'appUsage', 'webBrowsing', 'contentBlocks', 'location', 'screenTime',
  'eyeProtection', 'prayerReminders', 'deviceStatus', 'policyChanges',
  'youtube', 'wellbeing', 'childRequests',
];
const notVisibleKeys = [
  'messages', 'screenshots', 'biometrics', 'preciseWithoutConsent',
  'fullBrowsing', 'thirdParty',
];

function keysFromSource(name: 'VISIBLE_KEYS' | 'NOT_VISIBLE_KEYS'): string[] {
  const match = transparency().match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`));
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('privacy disclosure mutation boundary', () => {
  it('NFR-060 enumerates every visible and not-visible category', () => {
    expect(keysFromSource('VISIBLE_KEYS')).toEqual(visibleKeys);
    expect(keysFromSource('NOT_VISIBLE_KEYS')).toEqual(notVisibleKeys);
    expect(transparency()).toContain('VISIBLE_KEYS.map');
    expect(transparency()).toContain('NOT_VISIBLE_KEYS.map');
    expect(transparency()).toContain("t('transparency.encryptionNote')");
    expect(transparency()).toContain("t('transparency.sdkNote')");
  });

  it('NFR-060 exposes the disclosure page through the application route', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("import Transparency from './pages/privacy/Transparency'");
    expect(app).toContain('path="privacy/transparency" element={<Transparency />}');
  });

  it('NFR-060 keeps English and Arabic disclosure keys in parity', () => {
    const english = JSON.parse(read('src/i18n/locales/en.json')) as { transparency: Record<string, unknown> };
    const arabic = JSON.parse(read('src/i18n/locales/ar.json')) as { transparency: Record<string, unknown> };
    expect(Object.keys(english.transparency.visible as object).sort()).toEqual([...visibleKeys].sort());
    expect(Object.keys(english.transparency.notVisible as object).sort()).toEqual([...notVisibleKeys].sort());
    expect(Object.keys(arabic.transparency.visible as object).sort()).toEqual([...visibleKeys].sort());
    expect(Object.keys(arabic.transparency.notVisible as object).sort()).toEqual([...notVisibleKeys].sort());
  });

  it('NFR-014 has no hidden browser telemetry collection in the disclosure page', () => {
    const source = transparency();
    expect(source).not.toMatch(/sendBeacon|navigator\.sendBeacon|XMLHttpRequest|fetch\s*\(/);
    expect(source).not.toMatch(/telemetry|analytics/i);
  });
});
