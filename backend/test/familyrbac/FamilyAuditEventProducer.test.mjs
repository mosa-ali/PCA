// Verifies FamilyAuditEventProducer's own composition/delivery chain in
// isolation (mirrors alerts/ProtectionAlertProducer's own dedicated test
// coverage) -- resolveParentDevices -> composeOpaquePayload -> ledger.record,
// one envelope per resolved parent device, never blocking or throwing on a
// per-device failure.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyAuditEventProducer } from '../../dist/familyrbac/FamilyAuditEventProducer.js';
import { InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';
import { createRejectingOpaqueFamilyAuditEventComposer } from '../../dist/familyrbac/FamilyAuditEventComposer.js';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-01-01T00:00:00.000Z');

function sampleRecord(overrides = {}) {
  return {
    eventId: 'event-1',
    familyId: 'fam-1',
    actionType: 'ADD_VIEWER',
    actorDeviceId: 'actor-device-1',
    actorMemberId: null,
    targetScope: { kind: 'FAMILY', id: 'fam-1' },
    authorizationRole: 'OWNER',
    trustSetEpoch: 0,
    policyRevision: null,
    occurredAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    clientMonotonicSequence: null,
    resultStatus: 'SUCCESS',
    targetAcknowledgementCount: 0,
    reasonCategory: null,
    correlationId: null,
    actionId: null,
    freeTextNote: null,
    ...overrides,
  };
}

test('delivers one opaque envelope per resolved parent device', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const composed = [];
  const composer = async (input) => {
    composed.push(input);
    return { encryptedPayloadB64: 'ZW5jcnlwdGVk', nonceB64: 'bm9uY2U' };
  };
  const producer = new FamilyAuditEventProducer(ledger, composer, async () => [
    { deviceId: 'parent-device-a', keyEpoch: 3 },
    { deviceId: 'parent-device-b', keyEpoch: 3 },
  ]);

  const outcomes = await producer.deliver(sampleRecord());

  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((o) => o.outcome === 'DELIVERED'));
  assert.equal(composed.length, 2);
  assert.equal(composed[0].record.eventId, 'event-1');
  assert.equal(composed[0].parentDeviceId, 'parent-device-a');
  assert.equal(composed[0].keyEpoch, 3);

  const forA = await ledger.listForParentDevice('fam-1', 'parent-device-a');
  const forB = await ledger.listForParentDevice('fam-1', 'parent-device-b');
  assert.equal(forA.length, 1);
  assert.equal(forB.length, 1);
  assert.equal(forA[0].encryptedPayloadB64, 'ZW5jcnlwdGVk');
});

test('a family with zero resolved parent devices delivers to no one and never throws', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const producer = new FamilyAuditEventProducer(ledger, async () => {
    throw new Error('composer must never be called with zero recipients');
  }, async () => []);

  const outcomes = await producer.deliver(sampleRecord());
  assert.deepEqual(outcomes, []);
});

test('a per-device composer failure is isolated -- other devices still receive delivery', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const composer = async (input) => {
    if (input.parentDeviceId === 'parent-device-fails') throw new Error('composition rejected');
    return { encryptedPayloadB64: 'b2s', nonceB64: 'bm9uY2U' };
  };
  const producer = new FamilyAuditEventProducer(ledger, composer, async () => [
    { deviceId: 'parent-device-fails', keyEpoch: 1 },
    { deviceId: 'parent-device-ok', keyEpoch: 1 },
  ]);

  const outcomes = await producer.deliver(sampleRecord());
  const byDevice = Object.fromEntries(outcomes.map((o) => [o.parentDeviceId, o.outcome]));
  assert.equal(byDevice['parent-device-fails'], 'FAILED');
  assert.equal(byDevice['parent-device-ok'], 'DELIVERED');
});

test('resolveParentDevices throwing resolves to zero deliveries rather than propagating', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const producer = new FamilyAuditEventProducer(
    ledger,
    async () => ({ encryptedPayloadB64: 'x', nonceB64: 'y' }),
    async () => {
      throw new Error('resolver unavailable');
    },
  );
  const outcomes = await producer.deliver(sampleRecord());
  assert.deepEqual(outcomes, []);
});

test('the production default (createRejectingOpaqueFamilyAuditEventComposer) fails closed -- delivery FAILS, never a fabricated payload', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const producer = new FamilyAuditEventProducer(
    ledger,
    createRejectingOpaqueFamilyAuditEventComposer(),
    async () => [{ deviceId: 'parent-device-a', keyEpoch: 1 }],
  );

  const outcomes = await producer.deliver(sampleRecord());
  assert.deepEqual(outcomes, [{ parentDeviceId: 'parent-device-a', outcome: 'FAILED' }]);
  assert.deepEqual(await ledger.listForFamily('fam-1'), []);
});

test('MySqlFamilyAuditEventLedger-shaped idempotency: a re-record of the exact same envelope id+content is IDEMPOTENT_MATCH, a conflicting one is CONFLICT', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const envelope = {
    envelopeId: 'env-1',
    familyId: 'fam-1',
    parentDeviceId: 'parent-device-a',
    keyEpoch: 1,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'aaaa',
    nonceB64: 'bbbb',
  };
  assert.deepEqual(await ledger.record(envelope), { outcome: 'RECORDED' });
  assert.deepEqual(await ledger.record(envelope), { outcome: 'IDEMPOTENT_MATCH' });
  assert.deepEqual(await ledger.record({ ...envelope, encryptedPayloadB64: 'different' }), { outcome: 'CONFLICT' });
});
