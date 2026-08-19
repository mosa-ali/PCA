import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canEmitAggregateTelemetry,
  defaultAggregateTelemetryConsent,
  emitAggregateTelemetryIfConsented,
  grantAggregateTelemetry,
  isAllowedAggregateTelemetryEvent,
  revokeAggregateTelemetry,
} from '../../dist/telemetry/consent.js';

const CHANGED_AT = new Date('2026-08-19T12:00:00.000Z');
const EVENT = { metric: 'FEATURE_INTERACTION_COUNT', bucket: 'YOUTUBE_MODE', count: 1 };

test('PCA-NFR-014 consent defaults off and is independent from account creation consent', () => {
  const consent = defaultAggregateTelemetryConsent();
  assert.deepEqual(consent, { aggregateProductTelemetry: false, changedAtUtc: null });
  assert.equal(canEmitAggregateTelemetry(consent), false);
  assert.equal('accountCreationConsent' in consent, false);
});

test('PCA-NFR-014 grant and revoke are separate, explicit, and reversible', () => {
  const granted = grantAggregateTelemetry(defaultAggregateTelemetryConsent(), CHANGED_AT);
  assert.equal(canEmitAggregateTelemetry(granted), true);
  assert.equal(granted.changedAtUtc?.toISOString(), CHANGED_AT.toISOString());

  const revoked = revokeAggregateTelemetry(granted, new Date(CHANGED_AT.getTime() + 1_000));
  assert.equal(canEmitAggregateTelemetry(revoked), false);
  assert.equal(revoked.changedAtUtc?.getTime(), CHANGED_AT.getTime() + 1_000);
});

test('PCA-NFR-014 only aggregate allowlisted events can reach a consented sink', () => {
  const delivered = [];
  const granted = grantAggregateTelemetry(defaultAggregateTelemetryConsent(), CHANGED_AT);

  assert.equal(emitAggregateTelemetryIfConsented(granted, EVENT, (event) => delivered.push(event)), true);
  assert.deepEqual(delivered, [EVENT]);

  for (const forbidden of [
    { ...EVENT, familyId: 'family-1' },
    { ...EVENT, childId: 'child-1' },
    { ...EVENT, url: 'https://example.test/private' },
    { ...EVENT, count: -1 },
    { ...EVENT, bucket: 'free text' },
  ]) {
    assert.equal(isAllowedAggregateTelemetryEvent(forbidden), false);
    assert.equal(emitAggregateTelemetryIfConsented(granted, forbidden, (event) => delivered.push(event)), false);
  }

  const revoked = revokeAggregateTelemetry(granted, new Date(CHANGED_AT.getTime() + 1_000));
  assert.equal(emitAggregateTelemetryIfConsented(revoked, EVENT, (event) => delivered.push(event)), false);
  assert.equal(delivered.length, 1);
});

test('PCA-NFR-014 rejects invalid consent timestamps before changing state', () => {
  assert.throws(
    () => grantAggregateTelemetry(defaultAggregateTelemetryConsent(), new Date('invalid')),
    /changedAtUtc must be a valid Date/,
  );
});
