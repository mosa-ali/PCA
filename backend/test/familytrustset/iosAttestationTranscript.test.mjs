// Wave 6D: the frozen App Attest binding transcript (10 netstring fields,
// Option A — NO expiresAt) and the enrollment-stable attestation
// clientData. Shared golden vectors are pinned byte-exactly here AND by the
// iOS/Swift consumer (FirstDeviceCanonicalTests) reading the same JSON.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeIosAppAttestEnrollmentClientData,
  canonicalizeIosAttestationTranscript,
  decodeIosAttestationTranscript,
  IosAttestationTranscriptError,
  IOS_ATTESTATION_DOMAIN,
  MAX_IOS_ATTESTATION_TRANSCRIPT_BYTES,
} from '../../dist/familytrustset/IosAttestationTranscript.js';
import { sha256Hex } from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(path.resolve(here, '../../../contracts/first-device-bootstrap/canonical-vectors.json'), 'utf8'),
);

function fieldsFromVectors() {
  const input = vectors.iosTranscriptInput;
  return {
    familyId: input.familyId,
    deviceId: input.deviceId,
    ceremonyId: input.ceremonyId,
    challengeId: input.challengeId,
    nonce: input.nonce,
    dskKeyId: input.dskKeyId,
    dskPublicKey: input.dskPublicKeyBase64,
  };
}

test('VERIFIED: shared golden vector — canonical transcript bytes and sha256 are byte-exact', () => {
  const canonical = canonicalizeIosAttestationTranscript(fieldsFromVectors());
  assert.equal(canonical, vectors.iosTranscriptCanonicalBytes);
  assert.equal(sha256Hex(canonical), vectors.iosTranscriptCanonicalSha256Hex);
  assert.equal(canonical.length, 383);
  assert.ok(canonical.startsWith(`${IOS_ATTESTATION_DOMAIN.length}:${IOS_ATTESTATION_DOMAIN}`));
  // The transcript carries NO expiry field (frozen Option A).
  assert.equal(canonical.includes('expiresAt'), false);
  const decoded = decodeIosAttestationTranscript(canonical);
  assert.deepEqual(decoded, fieldsFromVectors());
});

test('VERIFIED: enrollment-stable attestation clientData vectors are byte-exact', () => {
  const clientData = canonicalizeIosAppAttestEnrollmentClientData(
    vectors.iosTranscriptInput.dskKeyId,
    vectors.iosTranscriptInput.dskPublicKeyBase64,
  );
  assert.equal(clientData, vectors.iosAttestationClientData);
  assert.equal(sha256Hex(clientData), vectors.iosAttestationClientDataSha256Hex);
  assert.ok(clientData.startsWith('PCA_IOS_APPATTEST_ATTESTATION_V1|'));
});

test('REJECTED: an 11-field variant that re-adds expiresAt is malformed (frozen Option A regression)', () => {
  const withExpiry =
    `${IOS_ATTESTATION_DOMAIN.length}:${IOS_ATTESTATION_DOMAIN}` +
    `1:1` +
    `36:${vectors.iosTranscriptInput.familyId}` +
    `36:${vectors.iosTranscriptInput.deviceId}` +
    `36:${vectors.iosTranscriptInput.ceremonyId}` +
    `36:${vectors.iosTranscriptInput.challengeId}` +
    `${vectors.iosTranscriptInput.nonce.length}:${vectors.iosTranscriptInput.nonce}` +
    `24:2026-10-02T00:00:00.000Z` +
    `17:ECDSA_P256_SHA256` +
    `36:${vectors.iosTranscriptInput.dskKeyId}` +
    `${vectors.iosTranscriptInput.dskPublicKeyBase64.length}:${vectors.iosTranscriptInput.dskPublicKeyBase64}`;
  assert.throws(() => decodeIosAttestationTranscript(withExpiry), IosAttestationTranscriptError);
});

test('REJECTED matrix: domain, version, shape, canonicals and bounds', () => {
  const valid = vectors.iosTranscriptCanonicalBytes;
  const point = vectors.iosTranscriptInput.dskPublicKeyBase64;
  const nonce = vectors.iosTranscriptInput.nonce;
  const familyId = vectors.iosTranscriptInput.familyId;
  const domainSegment = `${IOS_ATTESTATION_DOMAIN.length}:${IOS_ATTESTATION_DOMAIN}`;
  const cases = [
    ['empty', ''],
    ['wrong domain', valid.replace(domainSegment, `${IOS_ATTESTATION_DOMAIN.length}:PCA_IOS_DSK_ATTESTATION_V2`)],
    ['wrong version', valid.replace(`${domainSegment}1:1`, `${domainSegment}1:2`)],
    ['leading-zero prefix', `${domainSegment}`.replace(/^\d+:/, '027:') + valid.slice(domainSegment.length)],
    ['truncated value', valid.slice(0, valid.length - 1)],
    ['oversized', `2:${'x'.repeat(MAX_IOS_ATTESTATION_TRANSCRIPT_BYTES + 1)}`],
    ['non-canonical pubkey (padding)', valid.replace(`87:${point}`, `88:${point}=`)],
    ['short nonce', valid.replace(`43:${nonce}`, `42:${nonce.slice(0, 42)}`)],
    ['bad family id', valid.replace(`36:${familyId}`, `35:${familyId.slice(0, 35)}`)],
    ['extra trailing field', valid + '1:x'],
    ['replaced algorithm', valid.replace('17:ECDSA_P256_SHA256', '17:ECDSA_P256_SHA384')],
  ];
  for (const [name, input] of cases) {
    assert.throws(() => decodeIosAttestationTranscript(input), IosAttestationTranscriptError, `case: ${name}`);
  }
});

test('REJECTED: canonicalization refuses nothing silently — decoder re-encode identity is enforced', () => {
  // A structurally valid netstring with an over-long zero-prefixed length can
  // never equal the canonical re-encode.
  const canonical = canonicalizeIosAttestationTranscript(fieldsFromVectors());
  const domainLength = IOS_ATTESTATION_DOMAIN.length;
  const padded = canonical.replace(new RegExp(`^${domainLength}:`), `0${domainLength}:`);
  assert.notEqual(padded, canonical);
  assert.throws(() => decodeIosAttestationTranscript(padded), IosAttestationTranscriptError);
});
