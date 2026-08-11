import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneSamples } from '../../dist/location/retention.js';

function sample(id, measuredAtUtc) {
  return {
    deviceId: 'device-1',
    sampleId: id,
    measuredAtUtc,
    receivedAtUtc: measuredAtUtc,
    latitude: 0,
    longitude: 0,
    horizontalAccuracyMeters: 10,
    source: 'precise',
    batteryPercent: 80,
    trustEpoch: 1,
    expiresAtUtc: measuredAtUtc,
  };
}

test('CURRENT_LAST_ONLY keeps exactly the single most recent sample', () => {
  const samples = [
    sample('a', new Date('2026-01-05T00:00:00.000Z')),
    sample('b', new Date('2026-01-07T00:00:00.000Z')),
    sample('c', new Date('2026-01-06T00:00:00.000Z')),
  ];
  const retained = pruneSamples(samples, { mode: 'CURRENT_LAST_ONLY', historyRetentionDays: null }, new Date('2026-01-07T01:00:00.000Z'));
  assert.equal(retained.length, 1);
  assert.equal(retained[0].sampleId, 'b');
});

test('HISTORY mode drops samples older than the retention window', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  const samples = [
    sample('recent', new Date('2026-01-09T00:00:00.000Z')),
    sample('old', new Date('2026-01-01T00:00:00.000Z')),
  ];
  const retained = pruneSamples(samples, { mode: 'HISTORY', historyRetentionDays: 3 }, now);
  assert.deepEqual(retained.map((s) => s.sampleId), ['recent']);
});

test('reducing the retention window (re-pruning) removes over-age samples deterministically', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  const samples = [sample('a', new Date('2026-01-08T00:00:00.000Z')), sample('b', new Date('2026-01-03T00:00:00.000Z'))];
  const wide = pruneSamples(samples, { mode: 'HISTORY', historyRetentionDays: 30 }, now);
  assert.equal(wide.length, 2);
  const narrowed = pruneSamples(wide, { mode: 'HISTORY', historyRetentionDays: 1 }, now);
  assert.equal(narrowed.length, 0);
});

test('empty input yields empty output for both modes', () => {
  assert.deepEqual(pruneSamples([], { mode: 'CURRENT_LAST_ONLY', historyRetentionDays: null }, new Date()), []);
  assert.deepEqual(pruneSamples([], { mode: 'HISTORY', historyRetentionDays: 30 }, new Date()), []);
});
