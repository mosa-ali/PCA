import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtectionAlertProducer } from '../../dist/alerts/ProtectionAlertProducer.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const OPAQUE = { encryptedPayloadB64: 'AQID', nonceB64: 'BAUG' };

function createProducer(composer, options = {}) {
  return new ProtectionAlertProducer(
    options.ledger ?? new InMemoryProtectionAlertLedger(),
    composer,
    () => NOW,
    () => 'alert-generated-1',
  );
}

test('runtime producer composes opaque payload, generates typed event, and records it', async () => {
  const compositionInputs = [];
  const ledger = new InMemoryProtectionAlertLedger();
  const producer = createProducer(async (input) => {
    compositionInputs.push(input);
    return OPAQUE;
  }, { ledger });

  const result = await producer.produce({
    familyId: 'family-1',
    deviceId: 'device-1',
    parentDeviceId: 'parent-1',
    trigger: 'TIME_TAMPERING',
    keyEpoch: 4,
    alertsEnabled: true,
  });

  assert.equal(result.outcome, 'RECORDED');
  assert.equal(result.event?.alertId, 'alert-generated-1');
  assert.equal(result.event?.encryptedPayloadB64, 'AQID');
  assert.deepEqual(compositionInputs, [{
    alertId: 'alert-generated-1',
    familyId: 'family-1',
    deviceId: 'device-1',
    parentDeviceId: 'parent-1',
    trigger: 'TIME_TAMPERING',
    keyEpoch: 4,
    generatedAtUtc: NOW,
  }]);
  assert.deepEqual((await ledger.listForFamily('family-1')).map((event) => event.trigger), ['TIME_TAMPERING']);
});

test('every addendum trigger reaches the concrete runtime producer', async () => {
  const triggers = [
    'DISABLE_OR_REMOVAL_REQUESTED',
    'REPEATED_INVALID_PIN',
    'AUTHORITY_CHANGE',
    'CRITICAL_PERMISSION_OR_VPN_LOST',
    'UNEXPECTED_OFFLINE',
    'TIME_TAMPERING',
    'PROTECTION_DEGRADED',
    'REINSTALLATION',
    'INVITATION_REDEEMED',
    'UNENROLLMENT',
  ];
  const producer = createProducer(async () => OPAQUE);

  for (const trigger of triggers) {
    const result = await producer.produce({
      alertId: `alert-${trigger}`,
      familyId: 'family-1',
      deviceId: trigger === 'INVITATION_REDEEMED' ? null : 'device-1',
      parentDeviceId: 'parent-1',
      trigger,
      keyEpoch: 4,
      generatedAtUtc: NOW,
      alertsEnabled: true,
    });
    assert.equal(result.outcome, 'RECORDED');
    assert.equal(result.event?.trigger, trigger);
  }
});

test('disabled alerting does not invoke the composer or create a ledger event', async () => {
  let composerCalls = 0;
  const ledger = new InMemoryProtectionAlertLedger();
  const producer = createProducer(async () => {
    composerCalls += 1;
    return OPAQUE;
  }, { ledger });

  const result = await producer.produce({
    familyId: 'family-1',
    deviceId: 'device-1',
    parentDeviceId: 'parent-1',
    trigger: 'REPEATED_INVALID_PIN',
    keyEpoch: 4,
    alertsEnabled: false,
  });

  assert.deepEqual(result, { outcome: 'DISABLED', event: null });
  assert.equal(composerCalls, 0);
  assert.deepEqual(await ledger.listForFamily('family-1'), []);
});
