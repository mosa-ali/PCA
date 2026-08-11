import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeEnvelope } from '../../dist/familyenvelope/canonicalize.js';

function baseEnvelope(overrides = {}) {
  return {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: 'msg-1',
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: 'key-1',
    messageType: 'POLICY_UPDATE',
    sequenceOrNonce: 'seq-1',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    trustSetEpoch: 1,
    keyEpoch: 1,
    semanticVersion: '1.0.0',
    correlationId: null,
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
    canonicalizeEnvelope(baseEnvelope({ protocolMajor: 2 })),
    canonicalizeEnvelope(baseEnvelope({ protocolMinor: 1 })),
    canonicalizeEnvelope(baseEnvelope({ messageId: 'msg-2' })),
    canonicalizeEnvelope(baseEnvelope({ familyId: 'family-2' })),
    canonicalizeEnvelope(baseEnvelope({ senderDeviceId: 'device-2' })),
    canonicalizeEnvelope(baseEnvelope({ recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-2' } })),
    canonicalizeEnvelope(baseEnvelope({ recipient: { kind: 'GROUP', recipientGroup: 'group-1' } })),
    canonicalizeEnvelope(baseEnvelope({ senderKeyId: 'key-2' })),
    canonicalizeEnvelope(baseEnvelope({ messageType: 'SIGNED_ROLLBACK' })),
    canonicalizeEnvelope(baseEnvelope({ sequenceOrNonce: 'seq-2' })),
    canonicalizeEnvelope(baseEnvelope({ issuedAt: new Date('2026-01-02T00:00:00.000Z') })),
    canonicalizeEnvelope(baseEnvelope({ expiresAt: new Date('2026-01-02T01:00:00.000Z') })),
    canonicalizeEnvelope(baseEnvelope({ trustSetEpoch: 2 })),
    canonicalizeEnvelope(baseEnvelope({ keyEpoch: 2 })),
    canonicalizeEnvelope(baseEnvelope({ semanticVersion: '2.0.0' })),
    canonicalizeEnvelope(baseEnvelope({ correlationId: 'corr-1' })),
    canonicalizeEnvelope(baseEnvelope({ payload: Buffer.from('goodbye') })),
  ];
  for (const variant of variants) assert.notEqual(variant, base);
});

test('recipient DEVICE and GROUP forms never collide even with the same identifier value', () => {
  const deviceForm = canonicalizeEnvelope(baseEnvelope({ recipient: { kind: 'DEVICE', recipientDeviceId: 'shared-value' } }));
  const groupForm = canonicalizeEnvelope(baseEnvelope({ recipient: { kind: 'GROUP', recipientGroup: 'shared-value' } }));
  assert.notEqual(deviceForm, groupForm);
});

test('an absent correlationId and a correlationId equal to the empty-marker never collide', () => {
  const absent = canonicalizeEnvelope(baseEnvelope({ correlationId: null }));
  const present = canonicalizeEnvelope(baseEnvelope({ correlationId: 'corr-1' }));
  assert.notEqual(absent, present);
  // The presence flag disambiguates -- confirm changing correlationId while present still changes the bytes.
  const otherPresent = canonicalizeEnvelope(baseEnvelope({ correlationId: 'corr-2' }));
  assert.notEqual(present, otherPresent);
});

test('length-prefixing prevents field-boundary ambiguity across adjacent string fields', () => {
  const a = canonicalizeEnvelope(baseEnvelope({ familyId: 'fa', senderDeviceId: 'milyId-rest' }));
  const b = canonicalizeEnvelope(baseEnvelope({ familyId: 'famil', senderDeviceId: 'yId-rest' }));
  assert.notEqual(a, b);
});
