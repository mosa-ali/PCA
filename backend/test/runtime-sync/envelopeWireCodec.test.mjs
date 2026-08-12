import assert from 'node:assert/strict';
import test from 'node:test';
import { envelopeToRelayCiphertext, envelopeFromRelayCiphertext } from '../../dist/runtime-sync/envelopeWireCodec.js';

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
