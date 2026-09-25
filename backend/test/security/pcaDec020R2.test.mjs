import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import {
  canonicalizeP256Signature,
  isCanonicalBase64Url,
  isCanonicalP256Signature,
  P256DeviceSignatureVerifier,
  P256_ORDER,
} from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { DeviceRepositoryFamilyAuthorityKeyResolver } from '../../dist/familycommercial/authority/FamilyAuthorityKeyResolver.js';
import {
  ATTESTATION_CLOCK_SKEW_MS,
  MAX_ATTESTATION_AGE_MS,
  MAX_ATTESTATION_TTL_MS,
  MIN_ATTESTATION_TTL_MS,
  hasSaneAttestationTemporalPolicy,
} from '../../dist/familycommercial/authority/policy.js';

// PCA-DEC-030 removed Parent Genesis (the session-bound mailbox step-up and
// DSK ceremony this file used to cover alongside the shared primitives). The
// shared P-256 verifier, strict base64url, temporal policy and family
// authority key-resolution proofs below still guard the remaining
// device-signature surfaces and are kept.

function keyMaterial() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { pair, publicKey };
}

function sign(privateKey, message) {
  return canonicalizeP256Signature(cryptoSign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
}

function scalarBytes(value) {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

test('R2 low-S P1363 verifier accepts canonical signatures and rejects malleated/high-S variants', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = 'PCA-DEC-020-R2';
  const lowSignature = sign(pair.privateKey, message);
  const highSignature = Buffer.from(lowSignature);
  const lowS = BigInt(`0x${lowSignature.subarray(32).toString('hex')}`);
  scalarBytes(P256_ORDER - lowS).copy(highSignature, 32);
  const verifier = new P256DeviceSignatureVerifier();

  assert.equal(await verifier.verify(publicKey, message, lowSignature.toString('base64url')), true);
  assert.equal(await verifier.verify(publicKey, message, highSignature.toString('base64url')), false);
  assert.equal(isCanonicalP256Signature(lowSignature.toString('base64url')), true);
  assert.equal(isCanonicalP256Signature(highSignature.toString('base64url')), false);

  const zeroR = Buffer.from(lowSignature);
  zeroR.fill(0, 0, 32);
  assert.equal(isCanonicalP256Signature(zeroR.toString('base64url')), false);
  const orderR = Buffer.from(lowSignature);
  scalarBytes(P256_ORDER).copy(orderR, 0);
  assert.equal(isCanonicalP256Signature(orderR.toString('base64url')), false);
});

test('R2 strict base64url validation rejects noncanonical trailing bits while accepting exact 32-byte wire values', () => {
  const canonical = Buffer.from('01234567890123456789012345678901', 'utf8').toString('base64url');
  const noncanonical = `${canonical.slice(0, -1)}F`;
  assert.equal(canonical.length, 43);
  assert.equal(isCanonicalBase64Url(canonical, 32), true);
  assert.equal(isCanonicalBase64Url(noncanonical, 32), false);
  assert.equal(isCanonicalBase64Url(`${canonical}=`, 32), false);
  assert.equal(isCanonicalBase64Url(canonical.slice(0, -1), 32), false);
});

test('R2 shared temporal policy enforces server-time freshness, skew, and bounded TTL', () => {
  const now = new Date('2026-08-15T00:00:00.000Z');
  const at = (milliseconds) => new Date(now.getTime() + milliseconds);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MIN_ATTESTATION_TTL_MS), now), true);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MAX_ATTESTATION_TTL_MS), now), true);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MAX_ATTESTATION_TTL_MS + 1), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MIN_ATTESTATION_TTL_MS - 1), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(at(ATTESTATION_CLOCK_SKEW_MS), at(ATTESTATION_CLOCK_SKEW_MS + MIN_ATTESTATION_TTL_MS), now), true);
  assert.equal(hasSaneAttestationTemporalPolicy(at(ATTESTATION_CLOCK_SKEW_MS + 1), at(ATTESTATION_CLOCK_SKEW_MS + 1 + MIN_ATTESTATION_TTL_MS), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(at(-MAX_ATTESTATION_AGE_MS - 1), at(1), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(at(-1), at(1), now), false);
});

test('R2 family authority key resolution requires ACTIVE device and ACTIVE DSK', async () => {
  const states = ['PAIRING_PENDING', 'PAIRED', 'ACTIVE', 'REVOKED'];
  let currentStatus = 'PAIRING_PENDING';
  const resolver = new DeviceRepositoryFamilyAuthorityKeyResolver({
    async findDeviceForFamily(_familyId, _deviceId) {
      return { deviceId: 'device-1', familyId: 'family-1', platform: 'BROWSER', status: currentStatus, createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null, registeredByAccountId: null };
    },
    async findKeysByDeviceForFamily() {
      return [{ deviceId: 'device-1', keyId: 'key-1', keyPurpose: 'DSK', publicKey: 'public-key', status: 'ACTIVE', createdAt: new Date(), revokedAt: null }];
    },
  });
  for (const status of states) {
    currentStatus = status;
    const result = await resolver.isActiveDsk({ familyId: 'family-1', deviceId: 'device-1', keyId: 'key-1', publicKey: 'public-key' });
    assert.equal(result, status === 'ACTIVE', status);
  }
});
