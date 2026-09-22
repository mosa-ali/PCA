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

/**
 * Runs `fn` with console.warn captured. The producer's return value alone
 * cannot distinguish "resolved to no recipients" from "could not resolve
 * recipients at all" -- both are `[]` -- so the warning IS the observable
 * difference, and asserting on it is the only way to test that the two are
 * no longer conflated.
 */
async function withCapturedWarnings(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

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

test('a family with zero resolved parent devices delivers to no one, never throws, and does NOT log a failure', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const producer = new FamilyAuditEventProducer(ledger, async () => {
    throw new Error('composer must never be called with zero recipients');
  }, async () => []);

  const { result: outcomes, warnings } = await withCapturedWarnings(() => producer.deliver(sampleRecord()));
  assert.deepEqual(outcomes, []);
  // The other half of the pair below: no recipients is a NORMAL state and must
  // stay silent, or the warning would lose all diagnostic value.
  assert.deepEqual(warnings, [], 'legitimately having no parent devices must not log a delivery failure');
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

test('a per-device delivery failure is OBSERVABLE -- the returned outcomes array is discarded by the real caller, so silence would leave the failure existing only in a value nobody reads', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const composer = async (input) => {
    if (input.parentDeviceId === 'parent-device-fails') throw new Error('composition rejected');
    return { encryptedPayloadB64: 'b2s', nonceB64: 'bm9uY2U' };
  };
  const producer = new FamilyAuditEventProducer(ledger, composer, async () => [
    { deviceId: 'parent-device-fails', keyEpoch: 1 },
    { deviceId: 'parent-device-ok', keyEpoch: 1 },
  ]);

  const { result: outcomes, warnings } = await withCapturedWarnings(() => producer.deliver(sampleRecord()));
  assert.equal(outcomes.find((o) => o.parentDeviceId === 'parent-device-fails').outcome, 'FAILED');
  assert.equal(warnings.length, 1, 'a device that did not receive the event must be observable');
  assert.match(warnings[0], /family_audit_event_device_delivery_failed/);
  assert.match(warnings[0], /parent-device-fails/);
  assert.match(warnings[0], /composition rejected/);
});

test('a resolver failure resolves to zero deliveries rather than propagating, AND is distinguishable from an empty recipient list', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const producer = new FamilyAuditEventProducer(
    ledger,
    async () => ({ encryptedPayloadB64: 'x', nonceB64: 'y' }),
    async () => {
      throw new Error('resolver unavailable');
    },
  );
  // Delivering twice on purpose: the log must be emitted ONCE PER INSTANCE, not
  // once per record, or a resolver outage floods the log for its whole duration.
  const { result: outcomes, warnings } = await withCapturedWarnings(async () => [
    await producer.deliver(sampleRecord()),
    await producer.deliver(sampleRecord()),
  ]);
  assert.deepEqual(outcomes, [[], []]);
  assert.equal(warnings.length, 1, 'the warning must be rate-limited, not emitted per event');
  assert.match(warnings[0], /family_audit_event_recipient_resolution_failed/);
  assert.match(warnings[0], /resolver unavailable/);
  // The property the whole change exists for: the same `[]` now means two
  // different things depending on whether this line was emitted.
  assert.match(warnings[0], /NOT reaching this family/);
});

test('a sustained resolver failure never goes PERMANENTLY silent -- it re-logs every Nth occurrence with a running count', async () => {
  // The defect in the first version of this fix: a once-per-instance flag is
  // once per PROCESS (main.ts builds one producer for the process lifetime), and
  // the production composer rejects every call today -- so the first audit event
  // after startup would have consumed the budget and left every later failure,
  // including an unrelated ledger outage, silent forever. Rate-limiting must
  // therefore still produce a second line eventually.
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const producer = new FamilyAuditEventProducer(
    ledger,
    async () => ({ encryptedPayloadB64: 'x', nonceB64: 'y' }),
    async () => {
      throw new Error('resolver unavailable');
    },
  );

  const { warnings } = await withCapturedWarnings(async () => {
    for (let i = 0; i < 100; i += 1) await producer.deliver(sampleRecord());
  });
  assert.equal(warnings.length, 2, 'the 1st and the 100th failure must both be logged');
  assert.match(warnings[1], /"occurrences":100/);
});

test('after the dependency recovers, the NEXT failure reports immediately rather than waiting out the interval', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let failing = true;
  const producer = new FamilyAuditEventProducer(
    ledger,
    async () => ({ encryptedPayloadB64: 'x', nonceB64: 'y' }),
    async () => {
      if (failing) throw new Error('resolver unavailable');
      return [];
    },
  );

  const { warnings } = await withCapturedWarnings(async () => {
    await producer.deliver(sampleRecord()); // failure 1 -> logged
    await producer.deliver(sampleRecord()); // failure 2 -> suppressed
    failing = false;
    await producer.deliver(sampleRecord()); // recovery -> counter resets
    failing = true;
    await producer.deliver(sampleRecord()); // a NEW outage must be logged
  });
  assert.equal(warnings.length, 2, 'a fresh outage after recovery must be reported at occurrence 1');
  assert.match(warnings[1], /"occurrences":1/);
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
