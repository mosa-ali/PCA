// Wave 6C: AndroidKeyAttestationVerifier behavior — the decisive checks of
// the real Android platform-attestation lane behind the certified
// Wave-6B-R1 AttestationVerifier boundary. Fixtures are fully real DER
// chains (real ECDSA signatures, real KeyDescription extensions) built by
// helpers/x509FixtureFactory.mjs; no external tooling, deterministic per
// run. These tests are the behavioral kill surface for mutants
// C-SEC-001/002/003/004/005/006/009 (see the Wave-6C kill-run).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { X509Certificate } from 'node:crypto';
import { AndroidKeyAttestationVerifier, ANDROID_ATTESTATION_CHALLENGE_PREFIX } from '../../dist/familytrustset/AndroidKeyAttestationVerifier.js';
import { parseKeyDescription } from '../../dist/familytrustset/KeyAttestationDer.js';
import {
  buildAttestationChain,
  buildEvidence,
  buildInput,
  generateP256KeyPair,
  randomAttemptId,
} from './helpers/x509FixtureFactory.mjs';

function makeVerifier(chain) {
  const roots = [new X509Certificate(chain.rootPem)];
  return new AndroidKeyAttestationVerifier({
    rootCertificates: roots,
    rootDer: roots.map((certificate) => Buffer.from(certificate.raw)),
  });
}

function happyFixture(overrides = {}) {
  const attemptId = overrides.attemptId ?? randomAttemptId();
  const challenge = Buffer.from(`${ANDROID_ATTESTATION_CHALLENGE_PREFIX}${attemptId}`, 'utf8');
  const chain = buildAttestationChain({ challenge, ...overrides.chain });
  const evidence = buildEvidence({ attemptId, chainDer: chain.chainDer });
  const input = buildInput({
    attestationEvidence: evidence,
    expectedDskKeyId: 'a1b2c3d4-0000-0000-0000-000000000000',
    expectedDskPublicKey: chain.leafKeyPair.canonicalPublicKey,
    expectedDskAlgorithm: 'ECDSA_P256_SHA256',
    now: new Date(),
    ...overrides.input,
  });
  return { attemptId, chain, evidence, input };
}

// Independent, literal ASN.1 vector transcribed from the AOSP schema:
// two SEQUENCE authorization lists, EXPLICIT purpose[1], algorithm[2],
// digest[5], ecCurve[10], origin[702]. No fixture writer creates these bytes.
const AOSP_KEYMINT_VECTOR = Buffer.from(
  '30340201640a01010201640a010104017804003000301fa1053103020102a203020103a5053103020104aa03020101bf853e03020100', 'hex',
);

test('AOSP KeyMint DER vector decodes the actual platform tags and explicit wrappers', () => {
  const parsed = parseKeyDescription(AOSP_KEYMINT_VECTOR);
  assert.equal(parsed.attestationVersion, 100);
  assert.equal(parsed.attestationChallenge.toString(), 'x');
  assert.deepEqual(parsed.teeEnforced, { purpose: [2], algorithm: 3, digest: [4], curve: 1, origin: 0 });
});

test('invented legacy authorization-list tags and malformed EXPLICIT wrappers are rejected', () => {
  for (const [offset, replacement] of [[0, 0x10], [19, 0xa1], [21, 0xa2], [25, 0x30], [30, 0x82], [32, 0x04]]) {
    const malformed = Buffer.from(AOSP_KEYMINT_VECTOR);
    malformed[offset] = replacement;
    assert.throws(() => parseKeyDescription(malformed), /Malformed key attestation DER/);
  }
  const duplicatePurpose = Buffer.concat([
    AOSP_KEYMINT_VECTOR.subarray(0, 23), AOSP_KEYMINT_VECTOR.subarray(23, 30), AOSP_KEYMINT_VECTOR.subarray(23),
  ]);
  duplicatePurpose[1] += 7;
  duplicatePurpose[22] += 7;
  assert.throws(() => parseKeyDescription(duplicatePurpose), /duplicate/);
});

for (const version of [1, 2, 3, 4, 100, 200, 300, 400, 500]) {
  test(`VERIFIED: platform attestation version ${version} with real-schema authorization tags`, async () => {
    const keymasterVersion = version >= 100 ? version : ({ 1: 2, 2: 3, 3: 4, 4: 41 })[version];
    const { chain, input } = happyFixture({ chain: { attestationVersion: version, keymasterVersion, includeUnknownTeeEntry: true } });
    assert.equal((await makeVerifier(chain).verifyFirstDeviceAttestation(input)).status, 'VERIFIED');
  });
}

for (const version of [0, 5, 99, 101, 401, 501]) {
  test(`REJECTED: unsupported attestation version ${version}`, async () => {
    const { chain, input } = happyFixture({ chain: { attestationVersion: version } });
    assert.equal((await makeVerifier(chain).verifyFirstDeviceAttestation(input)).reason, 'attestation_version_unsupported');
  });
}

for (const keymasterSecurityLevel of [0, 3]) {
  test(`REJECTED: modern hardware attestation cannot authorize key security level ${keymasterSecurityLevel}`, async () => {
    const { chain, input } = happyFixture({ chain: { attestationVersion: 500, keymasterSecurityLevel } });
    assert.equal((await makeVerifier(chain).verifyFirstDeviceAttestation(input)).reason, 'key_security_level_not_hardware');
  });
}

test('VERIFIED: full chain (root included), TEE level, valid DSK, exact challenge — attested identity derived from evidence', async () => {
  const { chain, evidence, input } = happyFixture();
  const verifier = makeVerifier(chain);
  const verdict = await verifier.verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'VERIFIED');
  assert.equal(verdict.attestedDskPublicKey, chain.leafKeyPair.canonicalPublicKey);
  assert.equal(verdict.attestedDskAlgorithm, 'ECDSA_P256_SHA256');
  assert.equal(verdict.attestedDskKeyId, input.expectedDskKeyId);
  // Digest is over the EXACT raw evidence string (UTF-8 bytes).
  assert.equal(verdict.evidenceDigest, createHash('sha256').update(evidence, 'utf8').digest('hex'));
});

test('VERIFIED: root omitted from chain (leaf+intermediate only, signed by pinned root); unknown tee entry is strictly skipped', async () => {
  const attemptId = randomAttemptId();
  const challenge = Buffer.from(`${ANDROID_ATTESTATION_CHALLENGE_PREFIX}${attemptId}`, 'utf8');
  const chain = buildAttestationChain({
    challenge,
    omitRootInChain: true,
    chain: undefined,
    includeUnknownTeeEntry: true,
  });
  const verifier = makeVerifier(chain);
  const evidence = buildEvidence({ attemptId, chainDer: chain.chainDer });
  const verdict = await verifier.verifyFirstDeviceAttestation(
    buildInput({ attestationEvidence: evidence, expectedDskPublicKey: chain.leafKeyPair.canonicalPublicKey }),
  );
  assert.equal(verdict.status, 'VERIFIED');
});

test('VERIFIED: StrongBox security level (2)', async () => {
  const { chain, evidence, input } = happyFixture({ chain: { securityLevel: 2 } });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'VERIFIED');
});

for (const level of [0, 3]) {
  test(`REJECTED: software/unknown security level ${level} (C-SEC-002 kill: no check skipped)`, async () => {
    const { chain, evidence, input } = happyFixture({ chain: { securityLevel: level } });
    const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
    assert.equal(verdict.status, 'REJECTED');
    assert.equal(verdict.reason, 'security_level_not_hardware');
  });
}

test('REJECTED: leaf key does not match expected DSK (C-SEC-001/C-SEC-004)', async () => {
  const { chain, evidence, input } = happyFixture();
  const otherKey = generateP256KeyPair();
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(
    buildInput({ ...input, expectedDskPublicKey: otherKey.canonicalPublicKey }),
  );
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'leaf_key_mismatch');
});

test('REJECTED: expected algorithm not the certified P-256 suite (C-SEC-006, verifier side)', async () => {
  const { chain, evidence, input } = happyFixture();
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation({ ...input, expectedDskAlgorithm: 'RSA_PSS' });
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'expected_algorithm_unsupported');
});

test('REJECTED: teeEnforced purpose without SIGN (C-SEC-006)', async () => {
  const { chain, evidence, input } = happyFixture({
    chain: { tee: { purpose: [3], algorithm: 3, origin: 0, digest: [4], curve: 1 } },
  });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'purpose_missing_sign');
});

test('REJECTED: origin IMPORTED (not GENERATED)', async () => {
  const { chain, evidence, input } = happyFixture({
    chain: { tee: { purpose: [2], algorithm: 3, origin: 2, digest: [4], curve: 1 } },
  });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'origin_not_generated');
});

test('REJECTED: curve not P-256', async () => {
  const { chain, evidence, input } = happyFixture({
    chain: { tee: { purpose: [2], algorithm: 3, origin: 0, digest: [4], curve: 2 } },
  });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'curve_not_p256');
});

test('REJECTED: algorithm not EC', async () => {
  const { chain, evidence, input } = happyFixture({
    chain: { tee: { purpose: [2], algorithm: 1, origin: 0, digest: [4], curve: 1 } },
  });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'algorithm_not_ec');
});

test('REJECTED: digest without SHA-256', async () => {
  const { chain, evidence, input } = happyFixture({
    chain: { tee: { purpose: [2], algorithm: 3, origin: 0, digest: [5], curve: 1 } },
  });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'digest_missing_sha256');
});

test('REJECTED: challenge does not equal the byte-exact derivation from evidence attemptId (C-SEC-003)', async () => {
  const attemptId = randomAttemptId();
  const otherChallenge = Buffer.from(`${ANDROID_ATTESTATION_CHALLENGE_PREFIX}${randomAttemptId()}`, 'utf8');
  const chain = buildAttestationChain({ challenge: otherChallenge });
  const evidence = buildEvidence({ attemptId, chainDer: chain.chainDer });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(
    buildInput({ attestationEvidence: evidence, expectedDskPublicKey: chain.leafKeyPair.canonicalPublicKey }),
  );
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'challenge_mismatch');
});

test('REJECTED: KeyDescription extension missing entirely', async () => {
  const { chain, evidence, input } = happyFixture({ chain: { omitKeyDescription: true } });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'key_description_malformed');
});

test('REJECTED: KeyDescription OID duplicated in the certificate', async () => {
  const { chain, evidence, input } = happyFixture({ chain: { duplicateKeyDescription: true } });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'key_description_malformed');
});

test('REJECTED: leaf signature corrupted (chain integrity)', async () => {
  const { chain, evidence, input } = happyFixture({ chain: { corruptLeafSignature: true } });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'chain_signature_invalid');
});

test('REJECTED: expired leaf / not-yet-valid leaf (validity window of EVERY cert)', async () => {
  const expired = happyFixture({ chain: { expiredLeaf: true } });
  assert.equal((await makeVerifier(expired.chain).verifyFirstDeviceAttestation(expired.input)).reason, 'certificate_outside_validity');
  const notYet = happyFixture({ chain: { notYetValidLeaf: true } });
  assert.equal((await makeVerifier(notYet.chain).verifyFirstDeviceAttestation(notYet.input)).reason, 'certificate_outside_validity');
  const expiredIntermediate = happyFixture({ chain: { expiredIntermediate: true } });
  assert.equal((await makeVerifier(expiredIntermediate.chain).verifyFirstDeviceAttestation(expiredIntermediate.input)).reason, 'certificate_outside_validity');
});

test('REJECTED: chain anchored to a ROGUE root (alternate root)', async () => {
  const { chain, evidence, input } = happyFixture({ chain: { alternateRoot: true } });
  const pinned = buildAttestationChain();
  const verdict = await makeVerifier(pinned).verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'REJECTED');
  assert.ok(
    verdict.reason === 'chain_not_anchored_to_pinned_root' || verdict.reason === 'chain_signature_invalid',
    `unexpected reason ${verdict.reason}`,
  );
});

test('REJECTED: leaf is a CA / non-CA in chain position', async () => {
  const leafCa = happyFixture({ chain: { leafIsCa: true } });
  assert.equal((await makeVerifier(leafCa.chain).verifyFirstDeviceAttestation(leafCa.input)).reason, 'leaf_is_ca');
});

test('REJECTED: platform IOS never accepted by the Android verifier', async () => {
  const { chain, evidence, input } = happyFixture();
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation({ ...input, platform: 'IOS' });
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'platform_not_android');
});

test('REJECTED: missing evidence / oversized evidence', async () => {
  const { chain, input } = happyFixture();
  const verifier = makeVerifier(chain);
  assert.deepEqual(await verifier.verifyFirstDeviceAttestation({ ...input, attestationEvidence: null }), {
    status: 'REJECTED',
    reason: 'evidence_missing',
  });
  const huge = `{"v":1,"platform":"ANDROID","attemptId":"${randomAttemptId()}","chain":["${'A'.repeat(17_000)}"]}`;
  assert.deepEqual(await verifier.verifyFirstDeviceAttestation({ ...input, attestationEvidence: huge }), {
    status: 'REJECTED',
    reason: 'evidence_oversized',
  });
});

test('REJECTED: evidence envelope deviations (malformed JSON, extra member, wrong version/platform, padded base64url, short chain)', async () => {
  const { chain, evidence, input } = happyFixture();
  const verifier = makeVerifier(chain);
  const attemptId = randomAttemptId();
  const goodChainValue = chain.chainDer.map((der) => der.toString('base64url'));
  const cases = [
    'not json at all',
    JSON.stringify({ v: 1, platform: 'ANDROID', attemptId, chain: goodChainValue, extra: true }),
    JSON.stringify({ v: 2, platform: 'ANDROID', attemptId, chain: goodChainValue }),
    JSON.stringify({ v: 1, platform: 'IOS', attemptId, chain: goodChainValue }),
    JSON.stringify({ v: 1, platform: 'ANDROID', attemptId, chain: [`${goodChainValue[0]}=`] }),
    JSON.stringify({ v: 1, platform: 'ANDROID', attemptId, chain: [goodChainValue[0]] }),
    JSON.stringify({ v: 1, platform: 'ANDROID', attemptId, chain: [...goodChainValue, ...goodChainValue, ...goodChainValue] }),
    JSON.stringify({ v: 1, platform: 'ANDROID', attemptId: 'short', chain: goodChainValue }),
    JSON.stringify({ v: 1, platform: 'ANDROID', attemptId: `${'x'.repeat(65)}`, chain: goodChainValue }),
  ];
  for (const candidate of cases) {
    const verdict = await verifier.verifyFirstDeviceAttestation({ ...input, attestationEvidence: candidate });
    assert.equal(verdict.status, 'REJECTED', candidate.slice(0, 80));
    assert.ok(typeof verdict.reason === 'string' && verdict.reason.length > 0);
  }
});

test('NEVER THROWS: adversarial garbage inputs collapse into REJECTED', async () => {
  const { chain, input } = happyFixture();
  const verifier = makeVerifier(chain);
  const garbage = [
    '',
    '{}',
    '[]',
    'null',
    '{"v":1}',
    '{"v":1,"platform":"ANDROID","attemptId":"AAAAAAAAAAAAAAAA","chain":["!!"]}',
    '{"v":1,"platform":"ANDROID","attemptId":"AAAAAAAAAAAAAAAA","chain":[null]}',
  ];
  for (const candidate of garbage) {
    const verdict = await verifier.verifyFirstDeviceAttestation({ ...input, attestationEvidence: candidate });
    assert.equal(verdict.status, 'REJECTED');
  }
});

test('digest binding: whitespace-different evidence strings hash to their own exact bytes', async () => {
  const { chain, evidence, input } = happyFixture();
  const verifier = makeVerifier(chain);
  const first = await verifier.verifyFirstDeviceAttestation(input);
  assert.equal(first.status, 'VERIFIED');
  // Byte-different but semantically identical JSON (leading space): still
  // parses to the same envelope, yet its digest must bind ITS exact bytes.
  const spaced = ` ${evidence}`;
  const second = await verifier.verifyFirstDeviceAttestation({ ...input, attestationEvidence: spaced });
  assert.equal(second.status, 'VERIFIED');
  assert.notEqual(first.evidenceDigest, second.evidenceDigest);
  assert.equal(second.evidenceDigest, createHash('sha256').update(spaced, 'utf8').digest('hex'));
  assert.notEqual(first.evidenceDigest, createHash('sha256').update(spaced, 'utf8').digest('hex'));
});

test('REJECTED: trailing bytes after the leaf certificate (signed-region provenance; Stage-B blocker regression)', async () => {
  const { chain, attemptId, input } = happyFixture();
  // Bytes appended AFTER the outer SEQUENCE must never be readable as
  // attested material: node's X509 parser would still accept the
  // certificate, so the verifier itself must reject any DER that is not
  // byte-identical to its parsed signed form.
  const tamperedLeaf = Buffer.concat([chain.chainDer[0], Buffer.alloc(32)]);
  const tamperedEvidence = buildEvidence({ attemptId, chainDer: [tamperedLeaf, ...chain.chainDer.slice(1)] });
  const verdict = await makeVerifier(chain).verifyFirstDeviceAttestation({
    ...input,
    attestationEvidence: tamperedEvidence,
  });
  assert.equal(verdict.status, 'REJECTED');
  assert.equal(verdict.reason, 'evidence_malformed');
});

test('VERIFIED: pinned-root order does not matter when an earlier pin name-links but fails verification (Stage-B minor regression)', async () => {
  const { chain, evidence, input } = happyFixture();
  const rogue = buildAttestationChain({ challenge: Buffer.from('PCA_ANDROID_DSK_ATTESTATION_V1|' + randomAttemptId(), 'utf8') });
  const rogueRoot = new X509Certificate(rogue.rootPem);
  const realRoot = new X509Certificate(chain.rootPem);
  const verifier = new AndroidKeyAttestationVerifier({
    rootCertificates: [rogueRoot, realRoot],
    rootDer: [Buffer.from(rogueRoot.raw), Buffer.from(realRoot.raw)],
  });
  const verdict = await verifier.verifyFirstDeviceAttestation(input);
  assert.equal(verdict.status, 'VERIFIED');
});
