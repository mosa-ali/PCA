import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLocationDisplayState } from '../../dist/location/domain.js';

function sample(overrides = {}) {
  return {
    deviceId: 'device-1',
    sampleId: 'sample-1',
    measuredAtUtc: new Date('2026-01-07T12:00:00.000Z'),
    receivedAtUtc: new Date('2026-01-07T12:00:01.000Z'),
    latitude: 24.7136,
    longitude: 46.6753,
    horizontalAccuracyMeters: 10,
    source: 'precise',
    batteryPercent: 80,
    trustEpoch: 1,
    expiresAtUtc: new Date('2026-01-08T12:00:00.000Z'),
    ...overrides,
  };
}

test('precise fresh sample yields FRESH location with accuracy and source', () => {
  const result = computeLocationDisplayState({
    sample: sample(),
    lastSeen: { deviceId: 'device-1', lastAuthenticatedAtUtc: new Date('2026-01-07T12:00:00.000Z') },
    capabilityState: 'ACTIVE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.location.freshness, 'FRESH');
  assert.equal(result.location.accuracyMeters, 10);
  assert.equal(result.location.source, 'precise');
});

test('approximate capability still reports the sample honestly with its own source label', () => {
  const result = computeLocationDisplayState({
    sample: sample({ source: 'approximate', horizontalAccuracyMeters: 1500 }),
    lastSeen: null,
    capabilityState: 'APPROXIMATE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.capabilityState, 'APPROXIMATE');
  assert.equal(result.location.source, 'approximate');
  assert.equal(result.location.accuracyMeters, 1500);
});

test('missing accuracy renders as null (accuracy unavailable), never a false zero', () => {
  const result = computeLocationDisplayState({
    sample: sample({ horizontalAccuracyMeters: null }),
    lastSeen: null,
    capabilityState: 'OS_LIMITED',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.location.accuracyMeters, null);
});

test('permission denied capability state carries through with no sample', () => {
  const result = computeLocationDisplayState({
    sample: null,
    lastSeen: null,
    capabilityState: 'PERMISSION_DENIED',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.capabilityState, 'PERMISSION_DENIED');
  assert.equal(result.location.freshness, 'NO_SAMPLE');
});

test('a sample older than the freshness threshold is STALE, not treated as current', () => {
  const result = computeLocationDisplayState({
    sample: sample({ measuredAtUtc: new Date('2026-01-07T11:00:00.000Z') }),
    lastSeen: null,
    capabilityState: 'ACTIVE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.location.freshness, 'STALE');
});

test('connection OFFLINE is derived independently of location freshness', () => {
  const result = computeLocationDisplayState({
    sample: sample(), // fresh location
    lastSeen: { deviceId: 'device-1', lastAuthenticatedAtUtc: new Date('2026-01-07T11:00:00.000Z') }, // stale connection
    capabilityState: 'ACTIVE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.location.freshness, 'FRESH');
  assert.equal(result.connection.freshness, 'OFFLINE');
});

test('no last-seen record ever recorded yields UNKNOWN connection, not a fabricated OFFLINE/ONLINE guess', () => {
  const result = computeLocationDisplayState({
    sample: sample(),
    lastSeen: null,
    capabilityState: 'ACTIVE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.connection.freshness, 'UNKNOWN');
});

test('a clock rollback (measuredAt in the future relative to now) is treated as STALE, not FRESH', () => {
  const result = computeLocationDisplayState({
    sample: sample({ measuredAtUtc: new Date('2026-01-07T13:00:00.000Z') }),
    lastSeen: null,
    capabilityState: 'ACTIVE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.location.freshness, 'STALE');
});

test('reboot/offline restart: a null sample with OFFLINE capability reports NO_SAMPLE, never a stale fabricated location', () => {
  const result = computeLocationDisplayState({
    sample: null,
    lastSeen: null,
    capabilityState: 'OFFLINE',
    nowUtc: new Date('2026-01-07T12:05:00.000Z'),
  });
  assert.equal(result.location.freshness, 'NO_SAMPLE');
  assert.equal(result.capabilityState, 'OFFLINE');
});
