import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryTamperEventLedger } from '../../dist/tamper/TamperEventLedger.js';
import { evaluateTrustedTimeAndRecordTamper } from '../../dist/tamper/TrustedTimeTamperBridge.js';

const baseInput = (overrides = {}) => ({
  persistedHighWaterMarkUtc: new Date('2026-02-01T00:00:00.000Z'),
  observedNowUtc: new Date('2026-01-01T00:00:00.000Z'),
  eventId: 'tamper-clock-1',
  familyId: 'family-1',
  deviceId: 'device-1',
  trustSetEpoch: 4,
  keyEpoch: 7,
  localSequence: 12,
  ...overrides,
});

test('rollback pins trusted time and records a typed tamper risk signal', async () => {
  const ledger = new InMemoryTamperEventLedger();
  const result = await evaluateTrustedTimeAndRecordTamper(baseInput(), ledger);

  assert.equal(result.clockEvaluation.isRollbackDetected, true);
  assert.equal(result.nextHighWaterMarkUtc.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(result.event?.condition, 'CLOCK_ROLLBACK');
  assert.equal(result.event?.evidenceClass, 'TRUSTED_TIME_HIGH_WATER_MARK');
  assert.equal(result.event?.detectedAtUtc.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.deepEqual(result.recordResult, { outcome: 'RECORDED' });
  assert.equal((await ledger.listEventsForDevice('family-1', 'device-1')).length, 1);
});

test('a non-rollback observation advances the mark without creating a tamper event', async () => {
  const ledger = new InMemoryTamperEventLedger();
  const result = await evaluateTrustedTimeAndRecordTamper(baseInput({
    observedNowUtc: new Date('2026-03-01T00:00:00.000Z'),
  }), ledger);

  assert.equal(result.clockEvaluation.isRollbackDetected, false);
  assert.equal(result.nextHighWaterMarkUtc.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(result.event, null);
  assert.equal(result.recordResult, null);
  assert.deepEqual(await ledger.listEventsForDevice('family-1', 'device-1'), []);
});
