import assert from 'node:assert/strict';
import test from 'node:test';
import { envelopeToRelayCiphertext, envelopeFromRelayCiphertext, envelopeToRawFamilyEnvelope } from '../../dist/runtime-sync/envelopeWireCodec.js';
import { MAX_CIPHERTEXT_BYTES } from '../../dist/relay/policy.js';

function buildEnvelope(overrides = {}) {
  return {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: 'msg-1',
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    recipient: { kind: 'DEVICE', recipientDeviceId: 'recipient-1' },
    senderKeyId: 'key-1',
    messageType: 'STATUS_SNAPSHOT',
    trustSetEpoch: 1,
    keyEpoch: 1,
    sequenceOrNonce: 'nonce-1',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    semanticVersion: '1.0.0',
    correlationId: null,
    payload: Buffer.from('super secret ciphertext bytes'),
    signature: 'sig-1',
    ...overrides,
  };
}

function envelopeAtWireSize(targetBytes) {
  const emptySize = Buffer.byteLength(JSON.stringify(envelopeToRawFamilyEnvelope(buildEnvelope({
    payload: Buffer.alloc(0), signature: '',
  }))));
  for (let payloadLength = 1; payloadLength < MAX_CIPHERTEXT_BYTES; payloadLength += 1) {
    const encodedPayloadLength = 4 * Math.ceil(payloadLength / 3);
    const signatureLength = targetBytes - emptySize - encodedPayloadLength;
    if (signatureLength < 1 || signatureLength > 512) continue;
    const envelope = buildEnvelope({ payload: Buffer.alloc(payloadLength), signature: 's'.repeat(signatureLength) });
    const wireLength = Buffer.byteLength(JSON.stringify(envelopeToRawFamilyEnvelope(envelope)));
    if (wireLength === targetBytes) return envelope;
  }
  throw new Error(`Could not construct a serialized envelope of exactly ${targetBytes} bytes.`);
}

test('round-trips a DEVICE-recipient envelope through the relay wire codec unchanged', () => {
  const envelope = buildEnvelope();
  const ciphertext = envelopeToRelayCiphertext(envelope);
  const parsed = envelopeFromRelayCiphertext(ciphertext);
  assert.deepEqual(parsed, envelope);
});

test('round-trips a GROUP-recipient envelope', () => {
  const envelope = buildEnvelope({ recipient: { kind: 'GROUP', recipientGroup: 'all-parents' } });
  const parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope));
  assert.deepEqual(parsed, envelope);
});

test('round-trips a correlationId', () => {
  const envelope = buildEnvelope({ messageType: 'PARENT_DECISION', correlationId: 'child-request-msg-id' });
  const parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope));
  assert.equal(parsed.correlationId, 'child-request-msg-id');
});

test('wire JSON uses parsed-number semantics for integral numeric spellings', () => {
  const wire = envelopeToRelayCiphertext(buildEnvelope()).toString('utf8')
    .replace('"trustSetEpoch":1', '"trustSetEpoch":1.0')
    .replace('"keyEpoch":1', '"keyEpoch":1e0');
  const parsed = envelopeFromRelayCiphertext(Buffer.from(wire, 'utf8'));
  assert.equal(parsed?.trustSetEpoch, 1);
  assert.equal(parsed?.keyEpoch, 1);
});

test('the wire codec never inspects or transforms payload bytes', () => {
  const payload = Buffer.from([0, 1, 2, 255, 254, 253, 10, 13]);
  const envelope = buildEnvelope({ payload });
  const parsed = envelopeFromRelayCiphertext(envelopeToRelayCiphertext(envelope));
  assert.ok(parsed.payload.equals(payload));
});

test('malformed JSON is rejected as null, not thrown', () => {
  assert.equal(envelopeFromRelayCiphertext(Buffer.from('not json at all')), null);
});

test('structurally invalid (but valid JSON) input is rejected as null', () => {
  assert.equal(envelopeFromRelayCiphertext(Buffer.from(JSON.stringify({ foo: 'bar' }))), null);
});

test('serialized relay envelope accepts exactly 64 KiB and rejects one byte over on encode and parse', () => {
  const atLimit = envelopeAtWireSize(MAX_CIPHERTEXT_BYTES);
  const exactWire = envelopeToRelayCiphertext(atLimit);
  assert.equal(exactWire.length, MAX_CIPHERTEXT_BYTES);
  assert.deepEqual(envelopeFromRelayCiphertext(exactWire), atLimit);

  const overLimit = { ...atLimit, signature: `${atLimit.signature}s` };
  assert.throws(() => envelopeToRelayCiphertext(overLimit), RangeError);
  assert.equal(envelopeFromRelayCiphertext(Buffer.concat([exactWire, Buffer.from(' ')])), null);
});
