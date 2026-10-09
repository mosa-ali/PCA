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
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';

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

test('out-of-range resolved parent key epoch fails before composition or ledger write', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let composerCalls = 0;
  const producer = new FamilyAuditEventProducer(ledger, async () => {
    composerCalls += 1;
    return { encryptedPayloadB64: 'x', nonceB64: 'y' };
  }, async () => [{ deviceId: 'parent-device', keyEpoch: MAX_FAMILY_EPOCH + 1 }]);

  const outcomes = await producer.deliver(sampleRecord());

  assert.deepEqual(outcomes, [{ parentDeviceId: 'parent-device', outcome: 'FAILED' }]);
  assert.equal(composerCalls, 0);
  assert.deepEqual(await ledger.listForFamily('fam-1'), []);
});

test('malformed captured family scope is rejected before recipient resolution, composition, or ledger write', async () => {
  let resolverCalls = 0;
  let composerCalls = 0;
  const ledger = {
    async record() { throw new Error('ledger must not be called'); },
  };
  const producer = new FamilyAuditEventProducer(ledger, async () => {
    composerCalls += 1;
    return { encryptedPayloadB64: 'eA==', nonceB64: 'eQ==' };
  }, async () => {
    resolverCalls += 1;
    return [{ deviceId: 'parent-device-a', keyEpoch: 1 }];
  });

  const malformedScope = `family-invalid-${'x'.repeat(129)}`;
  const { result, warnings } = await withCapturedWarnings(() =>
    producer.deliver(sampleRecord({ familyId: malformedScope })),
  );
  assert.deepEqual(result, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /family_audit_event_scope_validation_failed/);
  assert.match(warnings[0], /SCOPE_VALIDATION/);
  assert.equal(warnings[0].includes(malformedScope), false);
  assert.equal(resolverCalls, 0);
  assert.equal(composerCalls, 0);
});

test('malformed resolved parent recipient is contained before composition and ledger while valid recipients continue', async () => {
  let composerCalls = 0;
  const stored = [];
  const ledger = {
    async record(envelope) {
      stored.push(envelope);
      return { outcome: 'RECORDED' };
    },
  };
  const producer = new FamilyAuditEventProducer(ledger, async () => {
    composerCalls += 1;
    return { encryptedPayloadB64: 'eA==', nonceB64: 'eQ==' };
  }, async () => [
    { deviceId: '', keyEpoch: 1 },
    { deviceId: 'parent-device-good', keyEpoch: 1 },
  ]);

  const outcomes = await producer.deliver(sampleRecord());
  assert.deepEqual(outcomes, [
    { parentDeviceId: '', outcome: 'FAILED' },
    { parentDeviceId: 'parent-device-good', outcome: 'DELIVERED' },
  ]);
  assert.equal(composerCalls, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].parentDeviceId, 'parent-device-good');
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
  assert.match(warnings[0], /OPAQUE_COMPOSITION/);
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
  assert.match(warnings[0], /RECIPIENT_RESOLUTION/);
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

test('ledger conflicts fail only the affected device while RECORDED and IDEMPOTENT_MATCH remain delivered', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const ids = ['env-a', 'env-b', 'env-a', 'env-b'];
  const compositionCount = new Map();
  const producer = new FamilyAuditEventProducer(
    ledger,
    async ({ parentDeviceId }) => {
      const count = (compositionCount.get(parentDeviceId) ?? 0) + 1;
      compositionCount.set(parentDeviceId, count);
      return {
        encryptedPayloadB64: parentDeviceId === 'parent-device-a' ? `cipher-a-${count}` : 'cipher-b',
        nonceB64: 'bm9uY2U',
      };
    },
    async () => [
      { deviceId: 'parent-device-a', keyEpoch: 1 },
      { deviceId: 'parent-device-b', keyEpoch: 1 },
    ],
    () => ids.shift(),
  );

  const first = await producer.deliver(sampleRecord());
  assert.deepEqual(first, [
    { parentDeviceId: 'parent-device-a', outcome: 'DELIVERED' },
    { parentDeviceId: 'parent-device-b', outcome: 'DELIVERED' },
  ]);

  const { result: second, warnings } = await withCapturedWarnings(() => producer.deliver(sampleRecord()));
  assert.deepEqual(second, [
    { parentDeviceId: 'parent-device-a', outcome: 'FAILED' },
    { parentDeviceId: 'parent-device-b', outcome: 'DELIVERED' },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /family_audit_event_device_delivery_failed/);
  assert.match(warnings[0], /LEDGER_RECORD/);

  const envelopes = await ledger.listForFamily('fam-1');
  assert.equal(envelopes.length, 2);
  assert.equal(envelopes.find((entry) => entry.parentDeviceId === 'parent-device-a').encryptedPayloadB64, 'cipher-a-1');
  assert.equal(envelopes.find((entry) => entry.parentDeviceId === 'parent-device-b').encryptedPayloadB64, 'cipher-b');
});


test('audit delivery warnings never expose dependency exception text or stringify thrown values', async () => {
  const privateText = 'PRIVATE AUDIT NOTE / SECRET CIPHERTEXT / RAW SQL PARAMETERS';
  const recipients = async () => [{ deviceId: 'parent-device-a', keyEpoch: 1 }];
  const composer = async () => ({ encryptedPayloadB64: 'opaque', nonceB64: 'nonce' });
  let stringified = false;
  const hostile = { toString() { stringified = true; throw new Error(privateText); } };
  const cases = [
    new FamilyAuditEventProducer(new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW), composer, async () => { throw new Error(privateText); }),
    new FamilyAuditEventProducer(new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW), async () => { throw hostile; }, recipients),
    new FamilyAuditEventProducer({ record: async () => { throw new Error(privateText); } }, composer, recipients),
  ];
  for (const producer of cases) {
    const { warnings } = await withCapturedWarnings(() => producer.deliver(sampleRecord({ freeTextNote: privateText })));
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], /PRIVATE|SECRET|RAW SQL|freeTextNote|encryptedPayloadB64/);
    const warning = JSON.parse(warnings[0]);
    assert.ok(['RECIPIENT_RESOLUTION', 'OPAQUE_COMPOSITION', 'LEDGER_RECORD'].includes(warning.failureStage));
    assert.equal(Object.hasOwn(warning, 'message'), false);
  }
  assert.equal(stringified, false);
});

test('audit composition captures caller routing, target and timestamp before recipient resolution', async () => {
  let resolveRecipients;
  const seen = [];
  const stored = [];
  const record = sampleRecord();
  const producer = new FamilyAuditEventProducer({ record: async envelope => { stored.push(envelope); return { outcome: 'RECORDED' }; } },
    async input => { seen.push(input); return { encryptedPayloadB64: 'opaque', nonceB64: 'nonce' }; },
    () => new Promise(resolve => { resolveRecipients = resolve; }));
  const pending = producer.deliver(record);
  record.familyId = 'foreign-family';
  record.targetScope.id = 'foreign-target';
  record.occurredAtUtc.setTime(LEDGER_NOW.getTime() + 86400000);
  resolveRecipients([{ deviceId: 'parent-device-a', keyEpoch: 1 }]);
  assert.deepEqual(await pending, [{ parentDeviceId: 'parent-device-a', outcome: 'DELIVERED' }]);
  assert.equal(seen[0].record.familyId, 'fam-1');
  assert.equal(seen[0].record.targetScope.id, 'fam-1');
  assert.equal(stored[0].familyId, 'fam-1');
  assert.equal(stored[0].generatedAtUtc.getTime(), LEDGER_NOW.getTime());
});

test('audit composer routing smuggling or timestamp mutation fails only that recipient', async () => {
  const stored = [];
  const producer = new FamilyAuditEventProducer({ record: async envelope => { stored.push(envelope); return { outcome: 'RECORDED' }; } },
    async input => {
      if (input.parentDeviceId === 'bad-extra') return { encryptedPayloadB64: 'opaque', nonceB64: 'nonce', familyId: 'foreign-family', keyEpoch: 99 };
      if (input.parentDeviceId === 'bad-date') input.record.occurredAtUtc.setTime(LEDGER_NOW.getTime() + 86400000);
      return { encryptedPayloadB64: 'opaque', nonceB64: 'nonce' };
    }, async () => ['bad-extra', 'bad-date', 'good'].map(deviceId => ({ deviceId, keyEpoch: 1 })));
  const record = sampleRecord();
  const { result } = await withCapturedWarnings(() => producer.deliver(record));
  assert.deepEqual(result.map(outcome => outcome.outcome), ['FAILED', 'FAILED', 'DELIVERED']);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].familyId, 'fam-1');
  assert.equal(stored[0].parentDeviceId, 'good');
  assert.equal(stored[0].generatedAtUtc.getTime(), LEDGER_NOW.getTime());
  assert.equal(record.occurredAtUtc.getTime(), LEDGER_NOW.getTime());
});

test('audit malformed opaque payload shapes and persisted bounds fail before ledger writes', async () => {
  const invalid = [null, [], {}, { encryptedPayloadB64: '', nonceB64: 'nonce' },
    { encryptedPayloadB64: 'x'.repeat(4194305), nonceB64: 'nonce' },
    { encryptedPayloadB64: 'opaque', nonceB64: 'x'.repeat(65) },
    { encryptedPayloadB64: 'opaque-é', nonceB64: 'nonce' },
    { encryptedPayloadB64: 'opaque', nonceB64: 'nonce-é' }];
  for (const payload of invalid) {
    let stored = false;
    const producer = new FamilyAuditEventProducer({ record: async () => { stored = true; return { outcome: 'RECORDED' }; } },
      async () => payload, async () => [{ deviceId: 'parent-device-a', keyEpoch: 1 }]);
    const { result } = await withCapturedWarnings(() => producer.deliver(sampleRecord()));
    assert.deepEqual(result, [{ parentDeviceId: 'parent-device-a', outcome: 'FAILED' }]);
    assert.equal(stored, false);
  }
});
