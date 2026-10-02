// WAVE 6B — the attestation boundary (dist/familytrustset/AttestationVerifier.js).
//
// Production composition MUST wire FailClosedAttestationVerifier (pinned by
// the ftsProductionWiring tooling test); this file proves the runtime half:
// the fail-closed verifier answers UNAVAILABLE for every input, the module
// exports NO permissive verifier, and a complete, cryptographically perfect
// submission still ends REJECTED with zero store writes while the boundary
// is fail-closed. That is the §6 "no permissive production path" property at
// the unit layer; mutation PCA-SEC022 B-SEC022-006 kills an attestation
// bypass against the DB lane.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import * as attestationModule from '../../dist/familytrustset/AttestationVerifier.js';
import { FailClosedAttestationVerifier } from '../../dist/familytrustset/AttestationVerifier.js';
import { FirstDeviceBootstrapService } from '../../dist/familytrustset/FirstDeviceBootstrapService.js';
import {
  FakeFirstDeviceBootstrapStore,
  buildPerfectSubmission,
  makeAttempt,
  makeP256Device,
  submissionInput,
} from './firstDeviceBootstrapFixtures.mjs';

const representativeInput = Object.freeze({
  familyId: 'family-attestation-boundary',
  deviceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  ceremonyId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  challengeId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  nonce: 'N'.repeat(43),
  platform: 'ANDROID',
  attestationEvidence: null,
  now: new Date('2026-10-02T00:00:00.000Z'),
});

test('FailClosedAttestationVerifier answers UNAVAILABLE for every input — with and without evidence', async () => {
  const verifier = new FailClosedAttestationVerifier();
  assert.deepEqual(await verifier.verifyFirstDeviceAttestation({ ...representativeInput }), { status: 'UNAVAILABLE' });
  assert.deepEqual(
    await verifier.verifyFirstDeviceAttestation({ ...representativeInput, attestationEvidence: 'any-evidence' }),
    { status: 'UNAVAILABLE' },
  );
  // No argument at all must not throw: the contract is "always declines".
  assert.deepEqual(await verifier.verifyFirstDeviceAttestation(), { status: 'UNAVAILABLE' });
});

test('the attestation module exports NO permissive or injectable production verifier', () => {
  const exportedNames = Object.keys(attestationModule).filter((name) => name !== '__esModule' && name !== 'default');
  assert.deepEqual(exportedNames.sort(), ['FailClosedAttestationVerifier']);
  const exported = attestationModule.FailClosedAttestationVerifier.prototype.verifyFirstDeviceAttestation.toString();
  assert.ok(!exported.includes('VERIFIED'), 'the only production verifier must never return a VERIFIED verdict');
});

test('a cryptographically perfect submission is REJECTED with zero durable writes while the boundary is fail-closed', async () => {
  const device = makeP256Device('boundary');
  const { attemptId, rawRecoveryToken, attempt } = makeAttempt(device);
  const store = new FakeFirstDeviceBootstrapStore({ attempt });
  const ceremony = {
    ceremonyId: randomUUID(),
    familyId: attempt.familyId,
    deviceId: attempt.deviceId,
    dskKeyId: attempt.signingKeyId,
    dskPublicKey: attempt.signingPublicKey,
    dskAlgorithm: 'ECDSA_P256_SHA256',
    purpose: 'PCA_FIRST_DEVICE_BOOTSTRAP_V1',
    challengeId: randomUUID(),
    nonce: 'B'.repeat(43),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    status: 'APPROVED',
    approvedByAccountId: randomUUID(),
    approvedAt: new Date(),
    payloadDigest: null,
    outcome: null,
    consumedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  store.ceremony = ceremony;

  const service = new FirstDeviceBootstrapService({ store, attestationVerifier: new FailClosedAttestationVerifier() });
  const perfect = buildPerfectSubmission({ attempt, ceremony, device });
  const outcome = await service.submit(submissionInput(attempt, rawRecoveryToken, ceremony, perfect));

  assert.deepEqual(outcome, { status: 'REJECTED' });
  assert.equal(store.commitCalls.length, 0, 'nothing may be written while attestation is fail-closed');
  assert.equal(store.ceremony.status, 'APPROVED', 'the challenge is NOT consumed by a rejected submission');
});
