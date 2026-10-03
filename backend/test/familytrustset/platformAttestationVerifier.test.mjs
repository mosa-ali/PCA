// Wave 6C: PlatformAttestationVerifier routing + configuration fail-closed
// behavior, plus the end-to-end integration of the REAL Android verifier
// with the certified FirstDeviceBootstrapService (a real P-256 fixture
// chain + real dual-signed submission, no scripted doubles): the service
// must commit exactly once through the real evidence path, and every
// mismatch class must reject with zero writes.
import assert from 'node:assert/strict';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  ANDROID_ATTESTATION_ROOTS_ENV,
  PlatformAttestationVerifier,
  createPlatformAttestationVerifier,
  parsePemCertificateBundle,
} from '../../dist/familytrustset/PlatformAttestationVerifier.js';
import { ANDROID_ATTESTATION_CHALLENGE_PREFIX } from '../../dist/familytrustset/AndroidKeyAttestationVerifier.js';
import { FirstDeviceBootstrapService } from '../../dist/familytrustset/FirstDeviceBootstrapService.js';
import {
  FakeFirstDeviceBootstrapStore,
  buildCeremonyRecord,
  buildPerfectSubmission,
  makeAttempt,
  makeP256Device,
  publicPointFromJwk,
  submissionInput,
} from './firstDeviceBootstrapFixtures.mjs';
import { buildAttestationChain, buildEvidence, randomAttemptId } from './helpers/x509FixtureFactory.mjs';

function keyPairForDevice() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    leafKeyPair: {
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      canonicalPublicKey: publicPointFromJwk(pair.publicKey.export({ format: 'jwk' })),
    },
    privateKey: pair.privateKey,
  };
}

/** Builds evidence whose leaf IS the given device key, challenge derived from attemptId. */
function evidenceForDevice(attemptId, deviceKeyPair, chainOptions = {}) {
  const chain = buildAttestationChain({
    leafKeyPair: deviceKeyPair,
    challenge: Buffer.from(`${ANDROID_ATTESTATION_CHALLENGE_PREFIX}${attemptId}`, 'utf8'),
    ...chainOptions,
  });
  return { chain, evidence: buildEvidence({ attemptId, chainDer: chain.chainDer }) };
}

test('factory: absent / empty / malformed configuration is always UNAVAILABLE, never VERIFIED', async () => {
  for (const env of [{}, { [ANDROID_ATTESTATION_ROOTS_ENV]: '' }, { [ANDROID_ATTESTATION_ROOTS_ENV]: '   ' }, { [ANDROID_ATTESTATION_ROOTS_ENV]: 'not a pem' }, { [ANDROID_ATTESTATION_ROOTS_ENV]: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' }]) {
    const verifier = createPlatformAttestationVerifier(env);
    const attemptId = randomAttemptId();
    const { evidence } = evidenceForDevice(attemptId, keyPairForDevice().leafKeyPair);
    const verdict = await verifier.verifyFirstDeviceAttestation({
      familyId: 'f',
      deviceId: 'd',
      ceremonyId: 'c',
      challengeId: 'ch',
      nonce: 'n',
      platform: 'ANDROID',
      attestationEvidence: evidence,
      expectedDskKeyId: 'k',
      expectedDskPublicKey: 'p',
      expectedDskAlgorithm: 'ECDSA_P256_SHA256',
      now: new Date(),
    });
    assert.equal(verdict.status, 'UNAVAILABLE');
  }
});

test('router: IOS and unknown platforms are UNAVAILABLE; ANDROID routes to the configured verifier', async () => {
  const pair = keyPairForDevice();
  const attemptId = randomAttemptId();
  const { chain, evidence } = evidenceForDevice(attemptId, pair.leafKeyPair);
  const verifier = createPlatformAttestationVerifier({ [ANDROID_ATTESTATION_ROOTS_ENV]: chain.rootPem });
  const baseInput = {
    familyId: 'f',
    deviceId: 'd',
    ceremonyId: 'c',
    challengeId: 'ch',
    nonce: 'n',
    attestationEvidence: evidence,
    expectedDskKeyId: 'k',
    expectedDskPublicKey: pair.leafKeyPair.canonicalPublicKey,
    expectedDskAlgorithm: 'ECDSA_P256_SHA256',
    now: new Date(),
  };
  assert.equal((await verifier.verifyFirstDeviceAttestation({ ...baseInput, platform: 'IOS' })).status, 'UNAVAILABLE');
  assert.equal((await verifier.verifyFirstDeviceAttestation({ ...baseInput, platform: 'WINDOWS' })).status, 'UNAVAILABLE');
  assert.equal((await verifier.verifyFirstDeviceAttestation({ ...baseInput, platform: 'ANDROID' })).status, 'VERIFIED');
});

test('PEM bundle parser: strict, multi-cert bundles, null on garbage', () => {
  assert.equal(parsePemCertificateBundle('nope'), null);
  const chain = buildAttestationChain();
  const parsed = parsePemCertificateBundle(chain.rootPem);
  assert.equal(parsed.certificates.length, 1);
  const double = parsePemCertificateBundle(chain.rootPem + chain.rootPem);
  assert.equal(double.certificates.length, 2);
});

test('INTEGRATION: real verifier + certified service — ACCEPTED exactly once, idempotent replay, zero writes on every mismatch', async () => {
  const device = makeP256Device('dsk');
  const pair = keyPairForDevice();
  device.dskPublicKey = pair.leafKeyPair.canonicalPublicKey; // leaf IS the ceremony DSK
  device.dskPrivateKey = pair.leafKeyPair.privateKey;
  const { attempt, rawRecoveryToken } = makeAttempt(device);
  const ceremony = buildCeremonyRecord(attempt);
  const { chain, evidence } = evidenceForDevice(attempt.attemptId, pair.leafKeyPair);
  const submission = buildPerfectSubmission({ attempt, ceremony, device, attestationEvidence: evidence });

  const store = new FakeFirstDeviceBootstrapStore({ attempt, ceremony });
  const service = new FirstDeviceBootstrapService({
    store,
    attestationVerifier: createPlatformAttestationVerifier({ [ANDROID_ATTESTATION_ROOTS_ENV]: chain.rootPem }),
  });

  const first = await service.submit(submissionInput(attempt, rawRecoveryToken, ceremony, submission));
  assert.deepEqual(first, { status: 'ACCEPTED' });
  assert.equal(store.commitCalls.length, 1);
  assert.equal(store.ceremony.status, 'COMMITTED');
  assert.equal(store.ceremony.attestationEvidenceSha256, submission.proofFields.attestationEvidenceDigest);

  const replay = await service.submit(submissionInput(attempt, rawRecoveryToken, ceremony, submission));
  assert.deepEqual(replay, { status: 'ACCEPTED' });
  assert.equal(store.commitCalls.length, 1, 'byte-identical replay must not re-commit');

  const status = await service.readStatus({ attemptId: attempt.attemptId, attemptRecoveryToken: rawRecoveryToken, ceremonyId: ceremony.ceremonyId });
  assert.deepEqual(status, { status: 'COMMITTED', outcome: 'ACCEPTED' });
});

test('INTEGRATION: unconfigured router and mismatched/weak evidence reject with zero writes', async () => {
  async function attemptSubmit({ rootPem, chainOptions = {}, mutateSubmission = (s) => s }) {
    const device = makeP256Device('dsk');
    const pair = keyPairForDevice();
    device.dskPublicKey = pair.leafKeyPair.canonicalPublicKey;
    device.dskPrivateKey = pair.leafKeyPair.privateKey;
    const { attempt, rawRecoveryToken } = makeAttempt(device);
    const ceremony = buildCeremonyRecord(attempt);
    const { evidence, chain } = evidenceForDevice(attempt.attemptId, pair.leafKeyPair, chainOptions);
    const submission = mutateSubmission(buildPerfectSubmission({ attempt, ceremony, device, attestationEvidence: evidence }));
    const store = new FakeFirstDeviceBootstrapStore({ attempt, ceremony });
    const verifier = rootPem === null ? createPlatformAttestationVerifier({}) : createPlatformAttestationVerifier({ [ANDROID_ATTESTATION_ROOTS_ENV]: rootPem });
    const service = new FirstDeviceBootstrapService({ store, attestationVerifier: verifier });
    const result = await service.submit(submissionInput(attempt, rawRecoveryToken, ceremony, submission));
    return { result, store, chain };
  }

  // Unconfigured (fail-closed): no pinned roots.
  const unconfigured = await attemptSubmit({ rootPem: null });
  assert.deepEqual(unconfigured.result, { status: 'REJECTED' });
  assert.equal(unconfigured.store.commitCalls.length, 0);

  // Software security level (emulator-like evidence) — pinned real root.
  const softPair = keyPairForDevice();
  const softDevice = makeP256Device('dsk');
  softDevice.dskPublicKey = softPair.leafKeyPair.canonicalPublicKey;
  softDevice.dskPrivateKey = softPair.leafKeyPair.privateKey;
  {
    const { attempt, rawRecoveryToken } = makeAttempt(softDevice);
    const ceremony = buildCeremonyRecord(attempt);
    const { evidence, chain } = evidenceForDevice(attempt.attemptId, softPair.leafKeyPair, { securityLevel: 0 });
    const submission = buildPerfectSubmission({ attempt, ceremony, device: softDevice, attestationEvidence: evidence });
    const store = new FakeFirstDeviceBootstrapStore({ attempt, ceremony });
    const service = new FirstDeviceBootstrapService({
      store,
      attestationVerifier: createPlatformAttestationVerifier({ [ANDROID_ATTESTATION_ROOTS_ENV]: chain.rootPem }),
    });
    const result = await service.submit(submissionInput(attempt, rawRecoveryToken, ceremony, submission));
    assert.deepEqual(result, { status: 'REJECTED' });
    assert.equal(store.commitCalls.length, 0);
  }

  // Leaf key is a DIFFERENT DSK than the ceremony expects (evidence for another key).
  {
    const otherPair = keyPairForDevice();
    const device = makeP256Device('dsk');
    const pair = keyPairForDevice();
    device.dskPublicKey = pair.leafKeyPair.canonicalPublicKey;
    device.dskPrivateKey = pair.leafKeyPair.privateKey;
    const { attempt, rawRecoveryToken } = makeAttempt(device);
    const ceremony = buildCeremonyRecord(attempt);
    const { evidence, chain } = evidenceForDevice(attempt.attemptId, otherPair.leafKeyPair);
    const submission = buildPerfectSubmission({ attempt, ceremony, device, attestationEvidence: evidence });
    const store = new FakeFirstDeviceBootstrapStore({ attempt, ceremony });
    const service = new FirstDeviceBootstrapService({
      store,
      attestationVerifier: createPlatformAttestationVerifier({ [ANDROID_ATTESTATION_ROOTS_ENV]: chain.rootPem }),
    });
    const result = await service.submit(submissionInput(attempt, rawRecoveryToken, ceremony, submission));
    assert.deepEqual(result, { status: 'REJECTED' });
    assert.equal(store.commitCalls.length, 0);
  }
});

test('PEM bundle hardening: a truncated trailing BEGIN block makes the whole bundle unusable (no verifier at all)', () => {
  const chain = buildAttestationChain({ challenge: Buffer.from(ANDROID_ATTESTATION_CHALLENGE_PREFIX + randomAttemptId(), 'utf8') });
  const truncated = chain.rootPem + '\n-----BEGIN CERTIFICATE-----\nMIIBnotarealcertificate\n';
  assert.equal(parsePemCertificateBundle(truncated), null);
  const router = createPlatformAttestationVerifier({ [ANDROID_ATTESTATION_ROOTS_ENV]: truncated });
  // Fail closed end to end: the Android lane answers UNAVAILABLE rather
  // than constructing a verifier from a partially-legible bundle.
  return router
    .verifyFirstDeviceAttestation({ platform: 'ANDROID' })
    .then((verdict) => assert.equal(verdict.status, 'UNAVAILABLE'));
});
