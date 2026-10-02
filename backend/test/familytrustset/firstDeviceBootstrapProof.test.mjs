// WAVE 6B — canonical PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof codec and
// signature verification (dist/familytrustset/FirstDeviceBootstrapProof.js).
//
// The proof is signature statement (A) of the F4 dual-signature model: a
// domain-led 13-field netstring tuple that is structurally disjoint from the
// Wave-5B epoch grammar. These cases pin the full decode contract — exact
// field count, per-field validation, canonical byte identity — and the
// strict P-256 verification surface (low-S IEEE-P1363 over the exact proof
// bytes, unpadded base64url, never throwing on malformed input).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  BOOTSTRAP_CHALLENGE_TTL_MS,
  BOOTSTRAP_PROOF_DOMAIN,
  BOOTSTRAP_PROTOCOL_VERSION,
  DSK_ALGORITHM,
  MAX_BOOTSTRAP_PROOF_BYTES,
  canonicalizeFirstDeviceBootstrapProof,
  decodeFirstDeviceBootstrapProof,
  sha256Hex,
  verifyFirstDeviceBootstrapProofSignature,
} from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';
import { makeP256Device, signCanonical, stamp } from './firstDeviceBootstrapFixtures.mjs';

function fieldsFixture(overrides = {}) {
  return {
    familyId: `family-${randomUUID()}`,
    deviceId: randomUUID(),
    ceremonyId: randomUUID(),
    challengeId: randomUUID(),
    nonce: 'A'.repeat(43),
    expiresAt: stamp(600_000),
    dskKeyId: randomUUID(),
    dskPublicKey: makeP256Device('codec').dskPublicKey,
    epoch1Sha256Hex: sha256Hex('epoch-1-bytes'),
    attestationEvidenceDigest: null,
    ...overrides,
  };
}

/** Netstring builder for hand-crafted (possibly malformed) tuples. */
function netstring(...values) {
  return values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');
}

function canonicalValues(overrides = {}) {
  const fields = fieldsFixture(overrides);
  return [
    BOOTSTRAP_PROOF_DOMAIN,
    String(BOOTSTRAP_PROTOCOL_VERSION),
    fields.familyId,
    fields.deviceId,
    fields.ceremonyId,
    fields.challengeId,
    fields.nonce,
    fields.expiresAt.toISOString(),
    DSK_ALGORITHM,
    fields.dskKeyId,
    fields.dskPublicKey,
    fields.epoch1Sha256Hex,
    fields.attestationEvidenceDigest === null ? 'null' : fields.attestationEvidenceDigest,
  ];
}

test('canonicalize emits the domain-led 13-field netstring and round-trips exactly', () => {
  const fields = fieldsFixture();
  const canonical = canonicalizeFirstDeviceBootstrapProof(fields);

  assert.ok(canonical.startsWith(`${BOOTSTRAP_PROOF_DOMAIN.length}:${BOOTSTRAP_PROOF_DOMAIN}`));
  assert.ok(canonical.includes(`1:${BOOTSTRAP_PROTOCOL_VERSION}`));
  assert.ok(canonical.endsWith('4:null'), 'a null attestation digest is encoded as the literal null');

  const decoded = decodeFirstDeviceBootstrapProof(canonical);
  assert.equal(decoded.familyId, fields.familyId);
  assert.equal(decoded.deviceId, fields.deviceId);
  assert.equal(decoded.ceremonyId, fields.ceremonyId);
  assert.equal(decoded.challengeId, fields.challengeId);
  assert.equal(decoded.nonce, fields.nonce);
  assert.equal(decoded.expiresAt.getTime(), fields.expiresAt.getTime());
  assert.equal(decoded.dskKeyId, fields.dskKeyId);
  assert.equal(decoded.dskPublicKey, fields.dskPublicKey);
  assert.equal(decoded.epoch1Sha256Hex, fields.epoch1Sha256Hex);
  assert.equal(decoded.attestationEvidenceDigest, null);
  assert.equal(canonicalizeFirstDeviceBootstrapProof(decoded), canonical);
});

test('a non-null attestation digest encodes and decodes as lowercase hex', () => {
  const digest = sha256Hex('evidence');
  const canonical = canonicalizeFirstDeviceBootstrapProof(fieldsFixture({ attestationEvidenceDigest: digest }));
  assert.equal(decodeFirstDeviceBootstrapProof(canonical).attestationEvidenceDigest, digest);
});

test('decode rejects wrong field counts, wrong domain, and wrong version', () => {
  const values = canonicalValues();
  assert.throws(() => decodeFirstDeviceBootstrapProof(netstring(...values.slice(0, 12))), /exactly 13 fields/);
  assert.throws(() => decodeFirstDeviceBootstrapProof(netstring(...values, 'extra')), /exactly 13 fields/);

  const wrongDomain = [...values];
  wrongDomain[0] = 'PCA_SOMETHING_ELSE';
  assert.throws(() => decodeFirstDeviceBootstrapProof(netstring(...wrongDomain)), /unexpected domain/);

  const wrongVersion = [...values];
  wrongVersion[1] = '2';
  assert.throws(() => decodeFirstDeviceBootstrapProof(netstring(...wrongVersion)), /unsupported protocol version/);
});

test('decode rejects non-canonical netstring framing', () => {
  assert.throws(() => decodeFirstDeviceBootstrapProof('x:abc'), /length prefix must be digits/);
  assert.throws(() => decodeFirstDeviceBootstrapProof('03:abc'), /non-canonical length prefix/);
  assert.throws(() => decodeFirstDeviceBootstrapProof('5:abc'), /truncated field/);
  assert.throws(() => decodeFirstDeviceBootstrapProof('abc'), /digits/);
  assert.throws(() => decodeFirstDeviceBootstrapProof(''), /non-empty string/);
  assert.throws(() => decodeFirstDeviceBootstrapProof('1:'), /missing length prefix|truncated field|unterminated/);
});

test('decode rejects every per-field violation at the tuple position it belongs to', () => {
  const cases = [
    [2, 'f'.repeat(129), /familyId must be 1\.\.128/],
    [2, '', /familyId must be 1\.\.128/],
    [3, 'too-short', /deviceId must be a 36-character/],
    [4, 'not-a-uuid', /ceremonyId must be a 36-character/],
    [5, 'x'.repeat(37), /challengeId must be a 36-character/],
    [6, 'A'.repeat(42), /nonce must be 43 base64url/],
    [6, `${'A'.repeat(42)}=`, /nonce must be 43 base64url/],
    [7, '2026-10-02 10:10:00', /exact ISO-8601/],
    [7, '2026-10-02T10:10:00Z', /exact ISO-8601/],
    [8, 'ED25519', /unsupported DSK algorithm/],
    [9, 'short', /dskKeyId must be a 36-character/],
    [10, 'bm90LWEta2V5', /canonical SEC1/],
    [11, 'ABCDEF', /lowercase hex sha256/],
    [12, 'NULL', /attestation evidence digest/],
  ];
  for (const [index, replacement, pattern] of cases) {
    const values = canonicalValues();
    values[index] = replacement;
    assert.throws(() => decodeFirstDeviceBootstrapProof(netstring(...values)), pattern, `field index ${index}`);
  }
});

test('length prefixes count BYTES: a multibyte familyId round-trips only under its byte length', () => {
  const values = canonicalValues();
  values[2] = 'é'.repeat(30); // 60 UTF-8 bytes, 30 characters — within the 1..128 bound
  const canonical = netstring(...values);
  assert.equal(decodeFirstDeviceBootstrapProof(canonical).familyId, values[2]);

  // The same value announced with its CHARACTER count desynchronizes the
  // tuple; the strict decoder refuses it rather than silently misparsing.
  const misPrefixed = `${netstring(...values.slice(0, 2))}30:${values[2]}${netstring(...values.slice(3))}`;
  assert.throws(() => decodeFirstDeviceBootstrapProof(misPrefixed), /length prefix must be digits|truncated field|unterminated/);
});

test('decode rejects oversized proofs before parsing', () => {
  const oversized = 'x'.repeat(MAX_BOOTSTRAP_PROOF_BYTES + 1);
  assert.throws(() => decodeFirstDeviceBootstrapProof(oversized), /exceeds 16384 bytes/);
});

test('proof signature verifies only over the exact canonical bytes with the exact DSK', () => {
  const device = makeP256Device('sig');
  const canonical = canonicalizeFirstDeviceBootstrapProof(fieldsFixture({ dskPublicKey: device.dskPublicKey }));
  const signature = signCanonical(device.dskPrivateKey, canonical);

  assert.equal(verifyFirstDeviceBootstrapProofSignature(device.dskPublicKey, canonical, signature), true);
  assert.equal(verifyFirstDeviceBootstrapProofSignature(device.dskPublicKey, `${canonical}x`, signature), false);

  const other = makeP256Device('other');
  assert.equal(verifyFirstDeviceBootstrapProofSignature(other.dskPublicKey, canonical, signature), false);
  assert.equal(verifyFirstDeviceBootstrapProofSignature(device.dskPublicKey, canonical, 'not-a-signature'), false);
  assert.equal(verifyFirstDeviceBootstrapProofSignature('AA', canonical, signature), false);
  assert.equal(verifyFirstDeviceBootstrapProofSignature(device.dskPublicKey, canonical, ''), false);
});

test('constants are pinned: domain, protocol version, algorithm, TTL and size ceiling', () => {
  assert.equal(BOOTSTRAP_PROOF_DOMAIN, 'PCA_FIRST_DEVICE_BOOTSTRAP_V1');
  assert.equal(BOOTSTRAP_PROTOCOL_VERSION, 1);
  assert.equal(DSK_ALGORITHM, 'ECDSA_P256_SHA256');
  assert.equal(BOOTSTRAP_CHALLENGE_TTL_MS, 10 * 60_000);
  assert.equal(MAX_BOOTSTRAP_PROOF_BYTES, 16_384);
});
