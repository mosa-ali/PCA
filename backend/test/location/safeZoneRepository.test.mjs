import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SafeZoneError,
  validateNewSafeZone,
  validateSafeZonePatch,
} from '../../dist/location/SafeZoneRepository.js';

const valid = {
  familyId: 'family-a',
  recipientEndpointId: 'child-a',
  ciphertextB64: 'AQID',
  nonceB64: 'AAECAwQFBgcICQoL',
  keyEpoch: 3,
};

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
  assert.doesNotThrow(() => validateSafeZonePatch({ ciphertextB64: 'BAUG' }));
  assert.doesNotThrow(() => validateSafeZonePatch({ nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 4 }));
  assert.throws(
    () => validateSafeZonePatch({ label: 'Home' }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateSafeZonePatch({ keyEpoch: 0 }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );
});
