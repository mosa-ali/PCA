import assert from 'node:assert/strict';
import test from 'node:test';
import { receiveEnvelope, attemptDecrypt } from '../dist/envelopeReceipt.js';
import { NotReadyDecryptor } from '../dist/cryptoGate.js';

function envelope(overrides = {}) {
  return {
    envelopeId: 'env-1',
    familyId: 'family-1',
    targetEndpointId: 'endpoint-a',
    ftsEpoch: 5,
    payloadCiphertextBase64: 'b3BhcXVlLWNpcGhlcnRleHQ=',
    createdAtUtc: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

function fts(overrides = {}) {
  return {
    familyId: 'family-1',
    epoch: 5,
    issuedAtUtc: '2026-08-01T00:00:00.000Z',
    expiresAtUtc: '2026-08-15T00:00:00.000Z',
    revokedEndpointIds: [],
    authorizedEndpointIds: ['endpoint-a'],
    ...overrides,
  };
}

test('receiveEnvelope starts in RECEIVED state with no decrypted payload', () => {
  const receipt = receiveEnvelope(envelope());
  assert.equal(receipt.state, 'RECEIVED');
  assert.equal(receipt.decryptedPayload, null);
});

test('an untrusted/non-enrolled endpoint cannot decrypt -- blocked before the FTS or crypto gate is even consulted', async () => {
  const receipt = receiveEnvelope(envelope());
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'BROWSER_NOT_TRUSTED',
    fts: fts(),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.equal(result.state, 'DECRYPT_BLOCKED_UNTRUSTED_ENDPOINT');
  assert.equal(result.decryptedPayload, null);
});

test('a revoked endpoint is rejected even if it was previously TRUSTED', async () => {
  const receipt = receiveEnvelope(envelope());
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'REVOKED',
    fts: fts(),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.equal(result.state, 'DECRYPT_BLOCKED_UNTRUSTED_ENDPOINT');
});

test('a stale FTS (epoch below acceptedMinEpoch) is rejected even for a TRUSTED endpoint', async () => {
  const receipt = receiveEnvelope(envelope());
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'TRUSTED',
    fts: fts({ epoch: 2 }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.equal(result.state, 'DECRYPT_BLOCKED_STALE_FTS');
});

test('missing FTS is rejected as stale rather than attempting decrypt', async () => {
  const receipt = receiveEnvelope(envelope());
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'TRUSTED',
    fts: null,
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.equal(result.state, 'DECRYPT_BLOCKED_STALE_FTS');
});

test('an envelope from a different family than the locally-cached FTS is blocked, even though the FTS itself is otherwise valid and current', async () => {
  const receipt = receiveEnvelope(envelope({ familyId: 'family-OTHER' }));
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'TRUSTED',
    fts: fts({ familyId: 'family-1' }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.equal(result.state, 'DECRYPT_BLOCKED_FAMILY_MISMATCH');
  assert.equal(result.decryptedPayload, null);
});

test('a same-family envelope+FTS pairing is not blocked by the family check and proceeds to the crypto gate as before', async () => {
  const receipt = receiveEnvelope(envelope({ familyId: 'family-1' }));
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'TRUSTED',
    fts: fts({ familyId: 'family-1' }),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.notEqual(result.state, 'DECRYPT_BLOCKED_FAMILY_MISMATCH');
  assert.equal(result.state, 'DECRYPT_BLOCKED_CRYPTO_REVIEW');
});

test('a TRUSTED endpoint with a current FTS still cannot decrypt today -- surfaces DECRYPT_BLOCKED_CRYPTO_REVIEW, never fake data', async () => {
  const receipt = receiveEnvelope(envelope());
  const result = await attemptDecrypt({
    receipt,
    endpointState: 'TRUSTED',
    fts: fts(),
    acceptedMinEpoch: 4,
    localEndpointId: 'endpoint-a',
    decryptor: new NotReadyDecryptor(),
  });
  assert.equal(result.state, 'DECRYPT_BLOCKED_CRYPTO_REVIEW');
  assert.equal(result.decryptedPayload, null);
});

test('the NotReadyDecryptor is never actually invoked with a bad short-circuit -- if it somehow were reached it would throw, not fabricate data', async () => {
  // Directly exercises the decryptor to prove the seam itself is honest even
  // in isolation from attemptDecrypt's earlier gating.
  const decryptor = new NotReadyDecryptor();
  await assert.rejects(() => decryptor.decrypt(envelope().payloadCiphertextBase64));
});
