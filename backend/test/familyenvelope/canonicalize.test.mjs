import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';

function baseEnvelope(overrides = {}) {
  return {
    protocolVersion: 1,
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    senderKeyId: 'key-1',
    messageType: 'POLICY_PUSH',
    sequenceOrNonce: 'seq-1',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    dataVersion: 1,
    trustSetEpoch: 1,
    keyEpoch: 1,
    payload: Buffer.from('hello'),
    ...overrides,
  };
}

test('canonicalizeEnvelope is deterministic for identical input', () => {
  const a = canonicalizeEnvelope(baseEnvelope());
  const b = canonicalizeEnvelope(baseEnvelope());
  assert.equal(a, b);
});

test('canonicalizeEnvelope changes when any signable field changes', () => {
  const base = canonicalizeEnvelope(baseEnvelope());
  const variants = [
    canonicalizeEnvelope(baseEnvelope({ protocolVersion: 2 })),
    canonicalizeEnvelope(baseEnvelope({ familyId: 'family-2' })),
    canonicalizeEnvelope(baseEnvelope({ senderDeviceId: 'device-2' })),
    canonicalizeEnvelope(baseEnvelope({ senderKeyId: 'key-2' })),
    canonicalizeEnvelope(baseEnvelope({ messageType: 'ROLLBACK' })),
    canonicalizeEnvelope(baseEnvelope({ sequenceOrNonce: 'seq-2' })),
    canonicalizeEnvelope(baseEnvelope({ issuedAt: new Date('2026-01-02T00:00:00.000Z') })),
    canonicalizeEnvelope(baseEnvelope({ expiresAt: new Date('2026-01-02T01:00:00.000Z') })),
    canonicalizeEnvelope(baseEnvelope({ dataVersion: 2 })),
    canonicalizeEnvelope(baseEnvelope({ trustSetEpoch: 2 })),
    canonicalizeEnvelope(baseEnvelope({ keyEpoch: 2 })),
    canonicalizeEnvelope(baseEnvelope({ payload: Buffer.from('goodbye') })),
  ];
  for (const variant of variants) assert.notEqual(variant, base);
});

test('canonicalizeEnvelope length-prefixing prevents field-boundary ambiguity across adjacent string fields', () => {
  // Without length-prefixing, "fa" + "milyId2" and "family" + "Id2" (etc.)
  // could collide under naive concatenation. Prove two structurally
  // different envelopes whose naively-concatenated fields WOULD collide
  // still canonicalize differently.
  const a = canonicalizeEnvelope(baseEnvelope({ familyId: 'fa', senderDeviceId: 'milyId-rest' }));
  const b = canonicalizeEnvelope(baseEnvelope({ familyId: 'famil', senderDeviceId: 'yId-rest' }));
  assert.notEqual(a, b);
});
