import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FamilyAuditEventStorageError,
  familyAuditEnvelopeFromStorage,
} from '../../dist/familyrbac/MySqlFamilyAuditEventLedger.js';
import { SERVER_CIPHERTEXT_TTL_MS } from '../../dist/retention/serverCiphertextTtl.js';

const generatedAt = new Date('2026-10-14T00:00:00.000Z');

function storedRow(overrides = {}) {
  return {
    envelope_id: 'envelope-1',
    family_id: 'family-1',
    parent_device_id: 'parent-device-1',
    key_epoch: 1,
    generated_at_utc: new Date(generatedAt),
    encrypted_payload_b64: 'AQID',
    nonce_b64: 'BAUG',
    expires_at: new Date(generatedAt.getTime() + SERVER_CIPHERTEXT_TTL_MS),
    ...overrides,
  };
}

test('MySQL FamilyAudit projection accepts only schema-bounded opaque envelopes with the exact server TTL', () => {
  const projected = familyAuditEnvelopeFromStorage(storedRow());
  assert.deepEqual(projected, {
    envelopeId: 'envelope-1',
    familyId: 'family-1',
    parentDeviceId: 'parent-device-1',
    keyEpoch: 1,
    generatedAtUtc: generatedAt,
    encryptedPayloadB64: 'AQID',
    nonceB64: 'BAUG',
  });
  assert.notEqual(projected.generatedAtUtc, generatedAt, 'projection returns an owned Date snapshot');

  const acceptedStorageBounds = familyAuditEnvelopeFromStorage(storedRow({
    key_epoch: 0,
    encrypted_payload_b64: 'x'.repeat(4_194_304),
    nonce_b64: 'n'.repeat(64),
  }));
  assert.equal(acceptedStorageBounds.keyEpoch, 0, 'migration 0028 allows the zero epoch');
  assert.equal(acceptedStorageBounds.encryptedPayloadB64.length, 4_194_304);
  assert.equal(acceptedStorageBounds.nonceB64.length, 64);

  const cases = [
    ['non-object row', null],
    ['empty envelope id', { envelope_id: '' }],
    ['envelope id beyond VARCHAR(200)', { envelope_id: 'e'.repeat(201) }],
    ['family id beyond VARCHAR(128)', { family_id: 'f'.repeat(129) }],
    ['parent device id beyond VARCHAR(200)', { parent_device_id: 'p'.repeat(201) }],
    ['unpaired surrogate in id', { envelope_id: '\uD800' }],
    ['negative key epoch', { key_epoch: -1 }],
    ['key epoch above supported range', { key_epoch: 0x8000_0000 }],
    ['fractional key epoch', { key_epoch: 1.5 }],
    ['missing payload', { encrypted_payload_b64: null }],
    ['empty payload', { encrypted_payload_b64: '' }],
    ['payload above migration limit', { encrypted_payload_b64: 'x'.repeat(4_194_305) }],
    ['non-ASCII payload', { encrypted_payload_b64: 'opaque-é' }],
    ['missing nonce', { nonce_b64: undefined }],
    ['empty nonce', { nonce_b64: '' }],
    ['nonce above VARCHAR(64)', { nonce_b64: 'n'.repeat(65) }],
    ['non-ASCII nonce', { nonce_b64: 'nonce-é' }],
    ['mysql2 date returned as string', { generated_at_utc: '2026-10-14 00:00:00.000' }],
    ['invalid generated Date', { generated_at_utc: new Date(Number.NaN) }],
    ['generated Date before DATETIME range', { generated_at_utc: new Date('0999-12-31T23:59:59.999Z') }],
    ['generated Date cannot retain full TTL in DATETIME range', { generated_at_utc: new Date('9999-12-31T23:59:59.999Z') }],
    ['missing expiry', { expires_at: undefined }],
    ['expiry returned as string', { expires_at: '2026-10-21 00:00:00.000' }],
    ['invalid expiry Date', { expires_at: new Date(Number.NaN) }],
    ['expiry one millisecond too early', { expires_at: new Date(generatedAt.getTime() + SERVER_CIPHERTEXT_TTL_MS - 1) }],
    ['expiry one millisecond too late', { expires_at: new Date(generatedAt.getTime() + SERVER_CIPHERTEXT_TTL_MS + 1) }],
    ['migration sentinel expiry', { expires_at: new Date('1970-01-01T00:00:00.000Z') }],
  ];

  for (const [name, overrides] of cases) {
    const row = overrides === null ? overrides : storedRow(overrides);
    assert.throws(() => familyAuditEnvelopeFromStorage(row), FamilyAuditEventStorageError, name);
  }
});
