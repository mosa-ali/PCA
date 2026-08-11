import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFamilyEnvelope } from '../../dist/familyenvelope/parse.js';

function rawEnvelope(overrides = {}) {
  return {
    protocolMajor: 1,
    protocolMinor: 0,
    messageId: 'msg-1',
    familyId: 'family-1',
    senderDeviceId: 'device-1',
    recipientDeviceId: 'recipient-1',
    senderKeyId: 'key-1',
    messageType: 'POLICY_UPDATE',
    trustSetEpoch: 1,
    keyEpoch: 1,
    sequenceOrNonce: 'seq-1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    semanticVersion: '1.0.0',
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
  assert.deepEqual(parsed.recipient, { kind: 'DEVICE', recipientDeviceId: 'recipient-1' });
  assert.equal(parsed.correlationId, null);
});

test('parseFamilyEnvelope accepts the GROUP recipient form', () => {
  const raw = rawEnvelope({ recipientDeviceId: undefined, recipientGroup: 'group-1' });
  const parsed = parseFamilyEnvelope(raw);
  assert.ok(parsed);
  assert.deepEqual(parsed.recipient, { kind: 'GROUP', recipientGroup: 'group-1' });
});

test('parseFamilyEnvelope rejects when NEITHER recipient form is supplied', () => {
  const raw = rawEnvelope({ recipientDeviceId: undefined });
  assert.equal(parseFamilyEnvelope(raw), null);
});

test('parseFamilyEnvelope rejects when BOTH recipient forms are supplied', () => {
  const raw = rawEnvelope({ recipientDeviceId: 'recipient-1', recipientGroup: 'group-1' });
  assert.equal(parseFamilyEnvelope(raw), null);
});

test('parseFamilyEnvelope accepts a present, well-formed correlationId', () => {
  const parsed = parseFamilyEnvelope(rawEnvelope({ correlationId: 'corr-1' }));
  assert.ok(parsed);
  assert.equal(parsed.correlationId, 'corr-1');
});

test('parseFamilyEnvelope rejects an oversized correlationId', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ correlationId: 'x'.repeat(200) })), null);
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

test('parseFamilyEnvelope rejects legacy pre-reconciliation message-type names', () => {
  // The old, now-superseded synonymous vocabulary must not still be accepted.
  for (const legacy of ['POLICY_PUSH', 'REVOCATION_COMMAND', 'STATUS_RECEIPT', 'TAMPER_EVENT', 'ROLLBACK']) {
    assert.equal(parseFamilyEnvelope(rawEnvelope({ messageType: legacy })), null, `${legacy} must not be accepted`);
  }
});

test('parseFamilyEnvelope accepts every canonical message type', () => {
  const types = [
    'POLICY_UPDATE',
    'POLICY_RECEIPT',
    'STATUS_SNAPSHOT',
    'ACTIVITY_SUMMARY',
    'LOCATION_RESPONSE',
    'CHILD_REQUEST',
    'PARENT_DECISION',
    'TAMPER_ALERT',
    'RETENTION_DELETION_INSTRUCTION',
    'RETENTION_RECEIPT',
    'FTS_UPDATE',
    'KEY_ROTATION',
    'DEVICE_REVOKE',
    'RECOVERY_TRANSACTION',
    'SIGNED_ROLLBACK',
  ];
  for (const messageType of types) {
    assert.ok(parseFamilyEnvelope(rawEnvelope({ messageType })), `${messageType} must be accepted`);
  }
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

test('parseFamilyEnvelope rejects a payload over the 64 KiB ceiling (doc 22 Section 7: oversized envelope -> safe reject)', () => {
  const oversized = Buffer.alloc(64 * 1024 + 1, 'a').toString('base64');
  assert.equal(parseFamilyEnvelope(rawEnvelope({ payload: oversized })), null);
});

test('parseFamilyEnvelope accepts a payload exactly at the 64 KiB ceiling', () => {
  const atLimit = Buffer.alloc(64 * 1024, 'a').toString('base64');
  const parsed = parseFamilyEnvelope(rawEnvelope({ payload: atLimit }));
  assert.ok(parsed);
  assert.equal(parsed.payload.length, 64 * 1024);
});

test('parseFamilyEnvelope rejects negative or non-integer epochs', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ trustSetEpoch: -1 })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ keyEpoch: 1.5 })), null);
});

test('parseFamilyEnvelope rejects an oversized or empty opaque id', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ familyId: '' })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ familyId: 'x'.repeat(200) })), null);
});

test('parseFamilyEnvelope rejects protocolMajor/protocolMinor below the minimum or non-integer', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ protocolMajor: 0 })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ protocolMajor: 1.5 })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ protocolMinor: -1 })), null);
});

test('parseFamilyEnvelope accepts a higher, unknown protocolMinor -- extension fields are simply not read', () => {
  const parsed = parseFamilyEnvelope(rawEnvelope({ protocolMinor: 99, someFutureExtensionField: 'ignored' }));
  assert.ok(parsed);
  assert.equal(parsed.protocolMinor, 99);
});

test('parseFamilyEnvelope rejects a malformed semanticVersion', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ semanticVersion: 'not-a-version' })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ semanticVersion: '1.2' })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ semanticVersion: '01.2.3' })), null);
});

test('parseFamilyEnvelope rejects an oversized messageId', () => {
  assert.equal(parseFamilyEnvelope(rawEnvelope({ messageId: 'x'.repeat(200) })), null);
  assert.equal(parseFamilyEnvelope(rawEnvelope({ messageId: '' })), null);
});
