import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SafeZoneError,
  validateNewSafeZone,
  validateSafeZonePatch,
} from '../../dist/location/SafeZoneRepository.js';
import { safeZoneFromStorage } from '../../dist/location/MySqlSafeZoneRepository.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';

const valid = {
  familyId: 'family-a',
  recipientEndpointId: 'child-a',
  ciphertextB64: 'AQID',
  nonceB64: 'AAECAwQFBgcICQoL',
  keyEpoch: 3,
};

function storedRow(overrides = {}) {
  return {
    zone_id: 'zone-1',
    family_id: 'family-a',
    recipient_endpoint_id: 'child-a',
    ciphertext: Buffer.from([1, 2, 3]),
    nonce: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    key_epoch: 3,
    revision: 1,
    delivery_state: 'PENDING_OFFLINE',
    created_at: new Date('2026-10-14T00:00:00.000Z'),
    updated_at: new Date('2026-10-14T00:00:01.000Z'),
    ...overrides,
  };
}

test('MySQL Safe Zone projection rejects corrupt rows before producing a delivery DTO', () => {
  const cases = [
    ['missing ciphertext buffer', { ciphertext: undefined }],
    ['oversized ciphertext', { ciphertext: Buffer.alloc(65_536) }],
    ['short nonce', { nonce: Buffer.alloc(11) }],
    ['invalid revision', { revision: 0 }],
    ['revision beyond INT UNSIGNED', { revision: 0x1_0000_0000 }],
    ['unknown delivery state', { delivery_state: 'DELIVERED' }],
    ['non-Date timestamp', { created_at: '2026-10-14 00:00:00' }],
    ['invalid Date timestamp', { updated_at: new Date(Number.NaN) }],
    ['DATETIME before supported range', { created_at: new Date('0999-12-31T23:59:59.999Z') }],
    ['DATETIME after supported range', { updated_at: new Date('+010000-01-01T00:00:00.000Z') }],
  ];
  for (const [name, row] of cases) {
    assert.throws(() => safeZoneFromStorage(storedRow(row)), (error) =>
      error instanceof SafeZoneError && error.code === 'INVALID_INPUT', name);
  }
  const zone = safeZoneFromStorage(storedRow());
  assert.equal(zone.ciphertextB64, 'AQID');
  assert.equal(zone.revision, 1);
});

test('repository accepts only canonical opaque Safe Zone envelope input', () => {
  assert.doesNotThrow(() => validateNewSafeZone(valid));
  assert.throws(
    () => validateNewSafeZone({ ...valid, ciphertextB64: 'Home!' }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateNewSafeZone({ ...valid, nonceB64: 'AQID' }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
});

test('repository patch validation rejects plaintext fields and unsafe epochs', () => {
  assert.doesNotThrow(() => validateSafeZonePatch({ ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' }));
  assert.doesNotThrow(() => validateSafeZonePatch({ ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 4 }));
  assert.throws(
    () => validateSafeZonePatch({ ciphertextB64: 'BAUG' }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateSafeZonePatch({ nonceB64: 'AAECAwQFBgcICQoL' }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateSafeZonePatch({ keyEpoch: 4 }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateSafeZonePatch({ label: 'Home' }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateSafeZonePatch({ ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 0 }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.doesNotThrow(() => validateNewSafeZone({ ...valid, keyEpoch: MAX_FAMILY_EPOCH }));
  assert.doesNotThrow(() => validateSafeZonePatch({ ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: MAX_FAMILY_EPOCH }));
  assert.throws(
    () => validateSafeZonePatch({ ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: MAX_FAMILY_EPOCH + 1 }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateNewSafeZone({ ...valid, keyEpoch: Number.MAX_SAFE_INTEGER + 1 }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
});
