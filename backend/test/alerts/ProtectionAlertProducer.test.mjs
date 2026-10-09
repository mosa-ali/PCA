import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtectionAlertProducer } from '../../dist/alerts/ProtectionAlertProducer.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-08-19T12:00:00.000Z');

const NOW = new Date('2026-08-19T12:00:00.000Z');
const OPAQUE = { encryptedPayloadB64: 'AQID', nonceB64: 'BAUG' };

function createProducer(composer, options = {}) {
  return new ProtectionAlertProducer(
    options.ledger ?? new InMemoryProtectionAlertLedger(() => LEDGER_NOW),
    composer,
    () => NOW,
    () => 'alert-generated-1',
  );
}

test('runtime producer composes opaque payload, generates typed event, and records it', async () => {
  const compositionInputs = [];
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
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
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
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

test('out-of-range key epoch is rejected before encryption composition or ledger effects', async () => {
  let composerCalls = 0;
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const producer = createProducer(async () => {
    composerCalls += 1;
    return OPAQUE;
  }, { ledger });

  await assert.rejects(() => producer.produce({
    familyId: 'family-1',
    deviceId: 'device-1',
    parentDeviceId: 'parent-1',
    trigger: 'REPEATED_INVALID_PIN',
    keyEpoch: MAX_FAMILY_EPOCH + 1,
    alertsEnabled: true,
  }), /outside the supported family epoch range/);

  assert.equal(composerCalls, 0);
  assert.deepEqual(await ledger.listForFamily('family-1'), []);
});

function alertInput(overrides = {}) {
  return { familyId: 'family-1', deviceId: 'device-1', parentDeviceId: 'parent-1',
    trigger: 'TIME_TAMPERING', keyEpoch: 4, alertsEnabled: true,
    generatedAtUtc: new Date(NOW), ...overrides };
}

test('caller mutation during deferred composition cannot change captured routing or timestamp', async () => {
  let resolveComposition;
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const producer = createProducer(() => new Promise(resolve => { resolveComposition = resolve; }), { ledger });
  const input = alertInput();
  const pending = producer.produce(input);
  input.familyId = 'foreign-family';
  input.deviceId = 'foreign-device';
  input.parentDeviceId = 'foreign-parent';
  input.keyEpoch = 99;
  input.generatedAtUtc.setTime(NOW.getTime() + 86400000);
  resolveComposition(OPAQUE);
  const result = await pending;
  assert.equal(result.event.familyId, 'family-1');
  assert.equal(result.event.deviceId, 'device-1');
  assert.equal(result.event.parentDeviceId, 'parent-1');
  assert.equal(result.event.keyEpoch, 4);
  assert.equal(result.event.generatedAtUtc.getTime(), NOW.getTime());
  assert.equal((await ledger.listForFamily('foreign-family')).length, 0);
});

test('composer timestamp mutation is isolated from the caller and rejected before storage', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const input = alertInput();
  const producer = createProducer(async composition => {
    composition.generatedAtUtc.setTime(NOW.getTime() + 86400000);
    return OPAQUE;
  }, { ledger });
  await assert.rejects(producer.produce(input), /composition timestamp changed/);
  assert.equal(input.generatedAtUtc.getTime(), NOW.getTime());
  assert.equal((await ledger.listForFamily('family-1')).length, 0);
});

test('composer extra routing fields and malformed opaque shapes never reach storage', async () => {
  const invalid = [
    { ...OPAQUE, familyId: 'foreign-family', deviceId: 'foreign-device', parentDeviceId: 'foreign-parent', keyEpoch: 99, generatedAtUtc: new Date() },
    { ...OPAQUE, alertsEnabled: false }, null, [], {},
    { ...OPAQUE, encryptedPayloadB64: 'not base64' },
    { ...OPAQUE, encryptedPayloadB64: Buffer.alloc(16385).toString('base64') },
    { ...OPAQUE, nonceB64: Buffer.alloc(65).toString('base64') },
  ];
  for (const payload of invalid) {
    let stored = false;
    const producer = createProducer(async () => payload, { ledger: { record: async () => { stored = true; return { outcome: 'RECORDED' }; } } });
    await assert.rejects(producer.produce(alertInput()), /invalid opaque alert payload/);
    assert.equal(stored, false);
  }
});

test('invalid routing metadata and inherited trigger names are rejected before composition', async () => {
  const invalid = [
    { alertId: '' },
    { alertId: 'a'.repeat(129) },
    { familyId: '' },
    { deviceId: '' },
    { deviceId: null },
    { parentDeviceId: '' },
    { trigger: 'toString' },
    { trigger: '__proto__' },
    { trigger: 'constructor' },
  ];
  for (const overrides of invalid) {
    let composerCalls = 0;
    let ledgerCalls = 0;
    const producer = createProducer(async () => {
      composerCalls += 1;
      return OPAQUE;
    }, { ledger: { record: async () => { ledgerCalls += 1; return { outcome: 'RECORDED' }; } } });
    await assert.rejects(producer.produce(alertInput(overrides)));
    assert.equal(composerCalls, 0, `invalid routing reached composer: ${JSON.stringify(overrides)}`);
    assert.equal(ledgerCalls, 0, `invalid routing reached ledger: ${JSON.stringify(overrides)}`);
  }
});
