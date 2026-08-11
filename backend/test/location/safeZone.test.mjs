import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSafeZoneTransition } from '../../dist/location/safeZone.js';

const HOME = { latitude: 24.7136, longitude: 46.6753 };
const FAR_AWAY = { latitude: 25.2854, longitude: 51.531 }; // Doha, ~far outside a small home radius

function zone(overrides = {}) {
  return {
    id: 'zone-1',
    label: 'Home',
    centerLatitude: HOME.latitude,
    centerLongitude: HOME.longitude,
    radiusMeters: 200,
    transitionTypes: ['ENTER', 'EXIT', 'DWELL'],
    alertRecipientRoles: ['OWNER'],
    policyRevision: 1,
    enabled: true,
    ...overrides,
  };
}

function sample(overrides = {}) {
  return {
    deviceId: 'device-1',
    sampleId: 'sample-1',
    measuredAtUtc: new Date('2026-01-07T12:00:00.000Z'),
    receivedAtUtc: new Date('2026-01-07T12:00:01.000Z'),
    latitude: HOME.latitude,
    longitude: HOME.longitude,
    horizontalAccuracyMeters: 10,
    source: 'precise',
    batteryPercent: 80,
    trustEpoch: 1,
    expiresAtUtc: new Date('2026-01-08T12:00:00.000Z'),
    ...overrides,
  };
}

const now = new Date('2026-01-07T12:00:00.000Z');

test('transition from outside to inside is ENTER', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: false,
    sample: sample(),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'ENTER');
  assert.equal(result.currentInside, true);
});

test('transition from inside to outside is EXIT', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: true,
    sample: sample({ latitude: FAR_AWAY.latitude, longitude: FAR_AWAY.longitude }),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'EXIT');
  assert.equal(result.currentInside, false);
});

test('staying inside across two samples is DWELL', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: true,
    sample: sample(),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'DWELL');
});

test('a missing sample never manufactures ENTER/EXIT -- it is UNKNOWN', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: true,
    sample: null,
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'UNKNOWN');
  assert.equal(result.currentInside, true); // last known inside/outside is preserved, not flipped
});

test('a stale sample (delayed geofence signal) never manufactures an exit', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: true,
    sample: sample({
      latitude: FAR_AWAY.latitude,
      longitude: FAR_AWAY.longitude,
      measuredAtUtc: new Date('2026-01-07T10:00:00.000Z'), // 2h old, older than the 15-min threshold
    }),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'UNKNOWN');
  assert.equal(result.currentInside, true);
});

test('a disabled zone is NOT_MONITORED regardless of sample', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone({ enabled: false }),
    previousInside: false,
    sample: sample(),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'NOT_MONITORED');
});

test('a denied/disabled location capability is NOT_MONITORED even with a stale cached sample', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: false,
    sample: sample(),
    capabilityState: 'PERMISSION_DENIED',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'NOT_MONITORED');
});

test('an untyped transition (ENTER not in configured transitionTypes) never fires', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone({ transitionTypes: ['EXIT'] }),
    previousInside: false,
    sample: sample(),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'UNKNOWN');
});

test('no prior known inside/outside state yields UNKNOWN on the first sample, not an assumed ENTER', () => {
  const result = evaluateSafeZoneTransition({
    zone: zone(),
    previousInside: null,
    sample: sample(),
    capabilityState: 'ACTIVE',
    freshnessThresholdMs: 900_000,
    nowUtc: now,
  });
  assert.equal(result.event, 'UNKNOWN');
  assert.equal(result.currentInside, true);
});
