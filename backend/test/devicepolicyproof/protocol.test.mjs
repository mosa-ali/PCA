import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  canonicalizeDevicePolicyApplicationProof,
  devicePolicyProofDigests,
  digestCanonicalEncryptedEnvelope,
} from '../../dist/devicepolicyproof/protocol.js';
import { P256DeviceSignatureVerifier } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';

const FIXTURE = JSON.parse(readFileSync(new URL('../../../shared/test-vectors/device-policy-application-proof-v1.json', import.meta.url), 'utf8'));

const ZERO32 = Buffer.alloc(32);
const b64 = (value) => Buffer.from(value).toString('base64url');
const BASE = Object.freeze({
  familyId: '00000000-0000-4000-8000-000000000001',
  deviceId: '00000000-0000-4000-8000-000000000002',
  policyEnvelopeMessageId: 'policy-1',
  policyEnvelopeSha256: b64(ZERO32),
  trustSetEpoch: 4,
  keyEpoch: 3,
  applicationResult: 'APPLIED',
  challengeId: '00000000-0000-4000-8000-000000000003',
  challengeNonce: b64(ZERO32),
  challengeExpiresAt: '2026-10-16T12:00:00.000Z',
});

test('Device Policy Application Proof transcript is deterministic and binds all V1 fields', () => {
  const transcript = canonicalizeDevicePolicyApplicationProof(BASE);
  assert.equal(transcript.toString('utf8'), canonicalizeDevicePolicyApplicationProof({ ...BASE }).toString('utf8'));
  for (const changed of [
    { familyId: '00000000-0000-4000-8000-000000000004' },
    { deviceId: '00000000-0000-4000-8000-000000000004' },
    { policyEnvelopeMessageId: 'policy-2' },
    { policyEnvelopeSha256: b64(Buffer.alloc(32, 1)) },
    { trustSetEpoch: 5 },
    { keyEpoch: 4 },
    { applicationResult: 'DEGRADED' },
    { challengeId: '00000000-0000-4000-8000-000000000004' },
    { challengeNonce: b64(Buffer.alloc(32, 1)) },
    { challengeExpiresAt: '2026-10-16T12:00:01.000Z' },
  ]) assert.notDeepEqual(canonicalizeDevicePolicyApplicationProof({ ...BASE, ...changed }), transcript);
});

test('proof transcript rejects noncanonical identifiers, digest encoding, epoch, result and expiry', () => {
  for (const invalid of [
    { familyId: 'Family' },
    { policyEnvelopeSha256: `${BASE.policyEnvelopeSha256}=` },
    { challengeNonce: 'AAAA' },
    { trustSetEpoch: 0 },
    { keyEpoch: 2_147_483_648 },
    { applicationResult: 'applied' },
    { challengeExpiresAt: '2026-10-16T12:00:00Z' },
  ]) assert.throws(() => canonicalizeDevicePolicyApplicationProof({ ...BASE, ...invalid }));
});

test('proof request fingerprint binds transcript bytes followed by the exact 64-byte P1363 signature', () => {
  const transcript = canonicalizeDevicePolicyApplicationProof(BASE);
  const signature = Buffer.alloc(64, 7);
  const digests = devicePolicyProofDigests(transcript, b64(signature));
  assert.deepEqual(digests.transcriptSha256, createHash('sha256').update(transcript).digest());
  assert.deepEqual(digests.exactRequestSha256, createHash('sha256').update(transcript).update(signature).digest());
  assert.throws(() => devicePolicyProofDigests(transcript, b64(Buffer.alloc(63))));
});

test('canonical encrypted-envelope digest binds exact bytes and enforces size bounds', () => {
  const canonical = Buffer.from('exact-canonical-envelope');
  assert.deepEqual(digestCanonicalEncryptedEnvelope(canonical), createHash('sha256').update(canonical).digest());
  assert.notDeepEqual(digestCanonicalEncryptedEnvelope(canonical), digestCanonicalEncryptedEnvelope(Buffer.from('exact-canonical-envelope ')));
  assert.throws(() => digestCanonicalEncryptedEnvelope(Buffer.alloc(0)));
  assert.throws(() => digestCanonicalEncryptedEnvelope(Buffer.alloc(98_305)));
});

test('shared cross-platform vector matches exact envelope digest, transcript bytes and synthetic P-256 signature', async () => {
  const envelopeBytes = Buffer.from(FIXTURE.canonicalEnvelope.bytesBase64Url, 'base64url');
  assert.equal(digestCanonicalEncryptedEnvelope(envelopeBytes).toString('base64url'), FIXTURE.canonicalEnvelope.sha256Base64Url);
  const fields = FIXTURE.validProof.fields;
  const transcriptFields = { ...fields };
  delete transcriptFields.domain;
  const transcript = canonicalizeDevicePolicyApplicationProof(transcriptFields);
  assert.equal(transcript.toString('base64url'), FIXTURE.validProof.transcriptBase64Url);
  const verifier = new P256DeviceSignatureVerifier();
  assert.equal(await verifier.verify(FIXTURE.validProof.syntheticDskPublicKeySec1Base64Url,
    transcript.toString('utf8'), FIXTURE.validProof.signatureBase64Url), true);
});
