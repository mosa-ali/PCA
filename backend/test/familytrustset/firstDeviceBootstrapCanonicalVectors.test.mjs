// Wave 6C: validates the SHARED cross-language golden vectors
// (contracts/first-device-bootstrap/canonical-vectors.json) with the
// certified backend canonicalizers. The Android side pins the SAME file
 // (FirstDeviceCanonicalTest.kt); together they prove byte-exact
// parity between the Kotlin encoders and the certified backend encoders,
// which is what acceptance requires (any drift = rejection).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { decodeFirstDeviceBootstrapProof } from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';
import { canonicalizeFirstDeviceBootstrapProof, sha256Hex } from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));
const vectorsPath = path.join(backendRoot, '..', 'contracts', 'first-device-bootstrap', 'canonical-vectors.json');
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));

test('challenge derivation vector matches the byte-exact UTF-8 prefix + attemptId', () => {
  const derived = Buffer.from(vectors.challengePrefix + vectors.challengeExample.attemptId, 'utf8').toString('base64url');
  assert.equal(derived, vectors.challengeExample.challengeBytesBase64Url);
});

test('proof canonical vector: backend re-encode and sha256 match the pinned bytes', () => {
  const input = vectors.proofInput;
  const canonical = canonicalizeFirstDeviceBootstrapProof({
    familyId: input.familyId,
    deviceId: input.deviceId,
    ceremonyId: input.ceremonyId,
    challengeId: input.challengeId,
    nonce: input.nonce,
    expiresAt: new Date(input.expiresAtIso),
    dskKeyId: input.dskKeyId,
    dskPublicKey: input.dskPublicKeyBase64,
    epoch1Sha256Hex: input.epoch1Sha256Hex,
    attestationEvidenceDigest: input.attestationEvidenceDigest,
  });
  assert.equal(canonical, vectors.proofCanonicalBytes);
  assert.equal(sha256Hex(canonical), vectors.proofCanonicalSha256Hex);
  // Strict decoder round-trips the pinned bytes.
  const decoded = decodeFirstDeviceBootstrapProof(vectors.proofCanonicalBytes);
  assert.equal(decoded.nonce, input.nonce);
  assert.equal(decoded.expiresAt.toISOString(), input.expiresAtIso);
  assert.equal(decoded.attestationEvidenceDigest, input.attestationEvidenceDigest);
});

test('epoch-1 canonical vector: backend re-encode and sha256 match the pinned bytes', () => {
  const input = vectors.epoch1Input;
  const canonical = canonicalizeTrustSetEpoch({
    familyId: input.familyId,
    trustSetEpoch: 1,
    keyEpoch: 1,
    supersedesEpoch: null,
    issuedAt: new Date(input.issuedAtIso),
    entries: [
      {
        deviceId: input.deviceId,
        role: 'OWNER',
        dskKeyId: input.dskKeyId,
        dskPublicKey: input.dskPublicKeyBase64,
        dekKeyId: input.dekKeyId,
        dekPublicKey: input.dekPublicKeyBase64,
        status: 'ACTIVE',
      },
    ],
  });
  assert.equal(canonical, vectors.epoch1CanonicalBytes);
  assert.equal(sha256Hex(canonical), vectors.epoch1CanonicalSha256Hex);
});
