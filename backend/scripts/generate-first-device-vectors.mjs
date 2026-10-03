// One-shot generator for contracts/first-device-bootstrap/canonical-vectors.json
// (Wave 6C). Uses the certified backend canonicalizers; run from backend/.
import fs from 'node:fs';
import { canonicalizeFirstDeviceBootstrapProof, sha256Hex } from '../dist/familytrustset/FirstDeviceBootstrapProof.js';
import { canonicalizeTrustSetEpoch } from '../dist/familytrustset/canonicalize.js';

const point = Buffer.concat([Buffer.from([4]), Buffer.from(Array.from({ length: 64 }, (_, i) => i + 1))]).toString('base64url');
const dekPoint = Buffer.concat([Buffer.from([4]), Buffer.from(Array.from({ length: 64 }, (_, i) => 255 - i))]).toString('base64url');

const proofInput = {
  familyId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  ceremonyId: '33333333-3333-4333-8333-333333333333',
  challengeId: '44444444-4444-4444-8444-444444444444',
  nonce: 'A'.repeat(43),
  expiresAtIso: '2026-10-02T00:00:00.000Z',
  dskKeyId: '55555555-5555-4555-8555-555555555555',
  dskPublicKeyBase64: point,
  epoch1Sha256Hex: 'ab'.repeat(32),
  attestationEvidenceDigest: 'cd'.repeat(32),
};
const proofCanonicalBytes = canonicalizeFirstDeviceBootstrapProof({
  familyId: proofInput.familyId,
  deviceId: proofInput.deviceId,
  ceremonyId: proofInput.ceremonyId,
  challengeId: proofInput.challengeId,
  nonce: proofInput.nonce,
  expiresAt: new Date(proofInput.expiresAtIso),
  dskKeyId: proofInput.dskKeyId,
  dskPublicKey: point,
  epoch1Sha256Hex: proofInput.epoch1Sha256Hex,
  attestationEvidenceDigest: proofInput.attestationEvidenceDigest,
});

const epoch1Input = {
  familyId: proofInput.familyId,
  deviceId: proofInput.deviceId,
  dskKeyId: proofInput.dskKeyId,
  dskPublicKeyBase64: point,
  dekKeyId: '66666666-6666-4666-8666-666666666666',
  dekPublicKeyBase64: dekPoint,
  issuedAtIso: '2026-10-02T00:00:00.000Z',
};
const epoch1CanonicalBytes = canonicalizeTrustSetEpoch({
  familyId: epoch1Input.familyId,
  trustSetEpoch: 1,
  keyEpoch: 1,
  supersedesEpoch: null,
  issuedAt: new Date(epoch1Input.issuedAtIso),
  entries: [
    {
      deviceId: epoch1Input.deviceId,
      role: 'OWNER',
      dskKeyId: epoch1Input.dskKeyId,
      dskPublicKey: epoch1Input.dskPublicKeyBase64,
      dekKeyId: epoch1Input.dekKeyId,
      dekPublicKey: epoch1Input.dekPublicKeyBase64,
      status: 'ACTIVE',
    },
  ],
});

const attemptId = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const json = {
  note: 'Wave 6C shared golden vectors — byte-exact canonical encodings pinned by BOTH backend (test/familytrustset/firstDeviceBootstrapCanonicalVectors.test.mjs) and Android (FirstDeviceCanonicalTest.kt). Generated with the certified backend canonicalizers.',
  challengePrefix: 'PCA_ANDROID_DSK_ATTESTATION_V1|',
  challengeExample: {
    attemptId,
    challengeBytesBase64Url: Buffer.from('PCA_ANDROID_DSK_ATTESTATION_V1|' + attemptId, 'utf8').toString('base64url'),
  },
  proofInput,
  proofCanonicalBytes,
  proofCanonicalSha256Hex: sha256Hex(proofCanonicalBytes),
  epoch1Input,
  epoch1CanonicalBytes,
  epoch1CanonicalSha256Hex: sha256Hex(epoch1CanonicalBytes),
};
fs.mkdirSync('../contracts/first-device-bootstrap', { recursive: true });
fs.writeFileSync('../contracts/first-device-bootstrap/canonical-vectors.json', JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log('WROTE proofLen', proofCanonicalBytes.length, 'epochLen', epoch1CanonicalBytes.length);
