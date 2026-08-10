import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFamilyEnvelope } from '../../dist/familyenvelope/parse.js';

function rawEnvelope(overrides = {}) {
  return {
    protocolVersion: 1,
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    senderKeyId: 'key-1',
    messageType: 'POLICY_PUSH',
    sequenceOrNonce: 'seq-1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    dataVersion: 1,
    trustSetEpoch: 1,
    keyEpoch: 1,
    payload: Buffer.from('hello').toString('base64'),
    signature: 'sig-1',
    ...overrides,
  };
}

test('parseFamilyEnvelope accepts a well-formed envelope and converts wire types', () => {
  const parsed = parseFamilyEnvelope(rawEnvelope());
  assert.ok(parsed);
  assert.ok(parsed.issuedAt instanceof Date);
  assert.ok(parsed.expiresAt instanceof Date);
  assert.ok(Buffer.isBuffer(parsed.payload));
  assert.equal(parsed.payload.toString('utf8'), 'hello');
});

test('parseFamilyEnvelope rejects non-object input', () => {
  assert.equal(parseFamilyEnvelope(null), null);
  assert.equal(parseFamilyEnvelope(undefined), null);
  assert.equal(parseFamilyEnvelope('not-an-object'), null);
  assert.equal(parseFamilyEnvelope([1, 2, 3]), null);
});

test('parseFamilyEnvelope rejects an unknown message type', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ messageType: 'NOT_A_REAL_TYPE' })), null);
});

test('parseFamilyEnvelope rejects a non-canonical ISO timestamp rather than guessing', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ issuedAt: '2026-01-01' })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ issuedAt: 'not-a-date' })), null);
});

test('parseFamilyEnvelope rejects expiresAt at or before issuedAt', () => {
  assert.equal(
    parseFamilyEnvelope(rawEnvelope({ issuedAt: '2026-01-01T01:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z' })),
    null,
  );
  assert.equal(
    parseFamilyEnvelope(rawEnvelope({ issuedAt: '2026-01-01T01:00:00.000Z', expiresAt: '2026-01-01T00:00:00.000Z' })),
    null,
  );
});

test('parseFamilyEnvelope rejects malformed base64 payload', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ payload: '***not-base64***' })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ payload: '' })), null);
});

test('parseFamilyEnvelope rejects negative or non-integer epochs/versions', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ trustSetEpoch: -1 })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ keyEpoch: 1.5 })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ dataVersion: -5 })), null);
});

test('parseFamilyEnvelope rejects an oversized or empty opaque id', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ familyId: '' })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ familyId: 'x'.repeat(200) })), null);
});

test('parseFamilyEnvelope rejects protocolVersion below the minimum', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ protocolVersion: 0 })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ protocolVersion: 1.5 })), null);
});
