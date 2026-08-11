import assert from 'node:assert/strict';
import test from 'node:test';
import { ModeAError, ModeAUsageReportService } from '../../dist/youtube/ModeAUsageReportService.js';

test('buildEvidence always labels the result "app usage only"', () => {
  const service = new ModeAUsageReportService(() => new Date('2026-01-01T00:00:00Z'));
  const evidence = service.buildEvidence('fam-1', 'prof-1', 'ANDROID_USAGE_STATS', 'GRANTED', 60_000);
  assert.equal(evidence.label, 'app usage only');
});

test('buildEvidence marks a coverage gap when capability is not GRANTED, never a fabricated zero', () => {
  const service = new ModeAUsageReportService();
  const evidence = service.buildEvidence('fam-1', 'prof-1', 'UNAVAILABLE', 'REVOKED', null);
  assert.equal(evidence.coverageGap, true);
  assert.equal(evidence.durationMs, null);
});

test('buildEvidence rejects a duration figure without GRANTED capability status', () => {
  const service = new ModeAUsageReportService();
  assert.throws(
    () => service.buildEvidence('fam-1', 'prof-1', 'ANDROID_USAGE_STATS', 'REVOKED', 60_000),
    (err) => err instanceof ModeAError && err.code === 'DURATION_WITHOUT_GRANT',
  );
});

test('buildEvidence rejects a negative or non-finite duration', () => {
  const service = new ModeAUsageReportService();
  assert.throws(() => service.buildEvidence('fam-1', 'prof-1', 'ANDROID_USAGE_STATS', 'GRANTED', -1), ModeAError);
  assert.throws(() => service.buildEvidence('fam-1', 'prof-1', 'ANDROID_USAGE_STATS', 'GRANTED', Infinity), ModeAError);
});

test('the ModeAUsageEvidence shape has no field capable of carrying a per-video watch list', () => {
  const service = new ModeAUsageReportService();
  const evidence = service.buildEvidence('fam-1', 'prof-1', 'ANDROID_USAGE_STATS', 'GRANTED', 1000);
  const keys = Object.keys(evidence).sort();
  assert.deepEqual(keys, [
    'capabilityStatus',
    'coverageGap',
    'durationMs',
    'familyId',
    'label',
    'observedAt',
    'profileId',
    'source',
  ]);
});
