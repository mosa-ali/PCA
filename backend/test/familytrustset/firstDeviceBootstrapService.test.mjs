// WAVE 6B — FirstDeviceBootstrapService unit semantics against a scripted
// store: enumeration-safe vocabulary, attempt-credential binding, M1 DSK
// claim equality, M3 replay-first classification, expiry, and the exact
// payload digest / anchor / epoch-1 record the atomic commit receives.
// Everything crypto-real (P-256 keys, low-S signatures, canonical epoch
// bytes) comes from firstDeviceBootstrapFixtures.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { FirstDeviceBootstrapService } from '../../dist/familytrustset/FirstDeviceBootstrapService.js';
import { computeFirstDeviceBootstrapCommitDigest } from '../../dist/familytrustset/FirstDeviceBootstrapCommit.js';
import { canonicalizeFirstDeviceBootstrapProof, sha256Hex } from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';
import {
  FakeFirstDeviceBootstrapStore,
  MismatchedAttestationVerifier,
  ScriptedAttestationVerifier,
  buildPerfectSubmission,
  makeAttempt,
  makeP256Device,
  signCanonical,
  stamp,
  submissionInput,
  verifiedVerdict,
} from './firstDeviceBootstrapFixtures.mjs';

function makeRig({ ceremonyOverrides = {}, attemptOverrides = {}, verifier = new ScriptedAttestationVerifier() } = {}) {
  const device = makeP256Device('service');
  const { attemptId, rawRecoveryToken, attempt } = makeAttempt(device, attemptOverrides);
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
    nonce: 'N'.repeat(43),
    expiresAt: stamp(10 * 60_000),
    status: 'APPROVED',
    approvedByAccountId: randomUUID(),
    approvedAt: stamp(),
    payloadDigest: null,
    outcome: null,
    consumedAt: null,
    createdAt: stamp(),
    updatedAt: stamp(),
    ...ceremonyOverrides,
  };
  store.ceremony = ceremony;
  const service = new FirstDeviceBootstrapService({ store, attestationVerifier: verifier });
  const perfect = buildPerfectSubmission({ attempt, ceremony, device });
  return { device, attemptId, rawRecoveryToken, attempt, store, ceremony, service, verifier, perfect };
}

test('listForApproval checks the provisioned-owner predicate before a family-scoped live-ceremony query', async () => {
  const rig = makeRig({ ceremonyOverrides: { status: 'PENDING' } });
  const newerApproved = { ...rig.ceremony, ceremonyId: randomUUID(), status: 'APPROVED', createdAt: stamp(2_000) };
  const expired = { ...rig.ceremony, ceremonyId: randomUUID(), createdAt: stamp(2), expiresAt: stamp(-1) };
  const committed = { ...rig.ceremony, ceremonyId: randomUUID(), status: 'COMMITTED', createdAt: stamp(3) };
  const foreignFamily = { ...rig.ceremony, ceremonyId: randomUUID(), familyId: 'another-family', createdAt: stamp(4) };
  rig.store.ceremonies = [rig.ceremony, newerApproved, expired, committed, foreignFamily];

  rig.store.eligibility = false;
  assert.equal(await rig.service.listForApproval(rig.attempt.familyId, 'owner-account'), null);
  assert.equal(rig.store.listCalls.length, 0, 'ineligible accounts must not query ceremony metadata');

  rig.store.eligibility = true;
  const listed = await rig.service.listForApproval(rig.attempt.familyId, 'owner-account');
  assert.deepEqual(listed.map((item) => item.ceremonyId), [newerApproved.ceremonyId, rig.ceremony.ceremonyId]);
  assert.deepEqual(rig.store.listCalls[0], {
    familyId: rig.attempt.familyId,
    now: rig.store.listCalls[0].now,
    limit: 25,
  });
  assert.equal(rig.store.listCalls[0].now instanceof Date, true);
});

test('issueChallenge mints a 10-minute PENDING ceremony bound to the attempt DSK and returns server context', async () => {
  const rig = makeRig({ ceremonyOverrides: { status: 'PENDING' } });
  rig.store.createOutcome = null;
  rig.store.ceremony = null;
  const outcome = await rig.service.issueChallenge({
    attemptId: rig.attemptId,
    attemptRecoveryToken: rig.rawRecoveryToken,
    dskKeyId: rig.attempt.signingKeyId,
    dskPublicKey: rig.attempt.signingPublicKey,
  });
  assert.equal(outcome.status, 'PENDING');
  assert.equal(outcome.familyId, rig.attempt.familyId);
  assert.equal(outcome.deviceId, rig.attempt.deviceId);
  const created = rig.store.createCalls[0];
  assert.equal(created.dskKeyId, rig.attempt.signingKeyId);
  assert.equal(created.dskPublicKey, rig.attempt.signingPublicKey);
  assert.equal(created.nonce.length, 43);
  assert.equal(created.expiresAt.getTime() - created.now.getTime(), 10 * 60_000);
  assert.equal(created.purpose, 'PCA_FIRST_DEVICE_BOOTSTRAP_V1');
});

test('issueChallenge collapses unknown attempt, wrong token and DSK-claim mismatch into UNAVAILABLE', async () => {
  const rig = makeRig();
  const base = {
    attemptId: rig.attemptId,
    attemptRecoveryToken: rig.rawRecoveryToken,
    dskKeyId: rig.attempt.signingKeyId,
    dskPublicKey: rig.attempt.signingPublicKey,
  };
  assert.deepEqual(await rig.service.issueChallenge({ ...base, attemptId: 'x'.repeat(32) }), { status: 'UNAVAILABLE' });
  assert.deepEqual(await rig.service.issueChallenge({ ...base, attemptRecoveryToken: 'wrong-token' }), { status: 'UNAVAILABLE' });
  assert.deepEqual(await rig.service.issueChallenge({ ...base, attemptRecoveryToken: '' }), { status: 'UNAVAILABLE' });
  assert.deepEqual(await rig.service.issueChallenge({ ...base, dskKeyId: randomUUID() }), { status: 'UNAVAILABLE' });
  assert.deepEqual(await rig.service.issueChallenge({ ...base, dskPublicKey: 'other-key' }), { status: 'UNAVAILABLE' });
  assert.equal(rig.store.createCalls.length, 0, 'no ceremony may be created for a failed credential or claim');
});

test('issueChallenge maps CONFLICT and DEVICE_NOT_ELIGIBLE store outcomes to UNAVAILABLE and REUSED through', async () => {
  const rig = makeRig();
  const call = () =>
    rig.service.issueChallenge({
      attemptId: rig.attemptId,
      attemptRecoveryToken: rig.rawRecoveryToken,
      dskKeyId: rig.attempt.signingKeyId,
      dskPublicKey: rig.attempt.signingPublicKey,
    });

  rig.store.createOutcome = { outcome: 'CONFLICT' };
  assert.deepEqual(await call(), { status: 'UNAVAILABLE' });
  rig.store.createOutcome = { outcome: 'DEVICE_NOT_ELIGIBLE' };
  assert.deepEqual(await call(), { status: 'UNAVAILABLE' });

  const existing = { ...rig.ceremony, status: 'PENDING' };
  rig.store.createOutcome = { outcome: 'REUSED', ceremony: existing };
  const replayed = await call();
  assert.equal(replayed.status, 'PENDING');
  assert.equal(replayed.ceremonyId, existing.ceremonyId);
  assert.equal(replayed.challengeId, existing.challengeId);
  assert.equal(replayed.nonce, existing.nonce);
});

test('readStatus answers only for the attempt-bound ceremony and reports EXPIRED/COMMITTED durably', async () => {
  const rig = makeRig();
  const read = (overrides = {}) =>
    rig.service.readStatus({ attemptId: rig.attemptId, attemptRecoveryToken: rig.rawRecoveryToken, ceremonyId: rig.ceremony.ceremonyId, ...overrides });

  assert.deepEqual(await read(), { status: 'APPROVED', outcome: null });

  rig.store.ceremony = { ...rig.ceremony, familyId: `other-${randomUUID()}` };
  assert.deepEqual(await read(), { status: 'UNAVAILABLE' });

  rig.store.ceremony = { ...rig.ceremony, deviceId: randomUUID() };
  assert.deepEqual(await read(), { status: 'UNAVAILABLE' });

  rig.store.ceremony = { ...rig.ceremony, expiresAt: stamp(-1) };
  assert.deepEqual(await read(), { status: 'EXPIRED', outcome: null });

  rig.store.ceremony = { ...rig.ceremony, status: 'COMMITTED', outcome: 'ACCEPTED' };
  assert.deepEqual(await read(), { status: 'COMMITTED', outcome: 'ACCEPTED' });

  rig.store.ceremony = { ...rig.ceremony, status: 'COMMITTED', outcome: null };
  assert.deepEqual(await read(), { status: 'COMMITTED', outcome: null });

  assert.deepEqual(await read({ attemptRecoveryToken: 'wrong' }), { status: 'UNAVAILABLE' });
});

test('submit accepts a perfect dual-signed payload and hands the store one commit with the exact digest, anchor and epoch record', async () => {
  const rig = makeRig();
  const input = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect);
  assert.deepEqual(await rig.service.submit(input), { status: 'ACCEPTED' });

  assert.equal(rig.store.commitCalls.length, 1);
  const commit = rig.store.commitCalls[0];
  assert.equal(commit.payloadDigest, computeFirstDeviceBootstrapCommitDigest(input));
  assert.equal(commit.bootstrapProofSha256, sha256Hex(input.proofBytes), 'R1-03: the exact proof bytes are audit-bound');
  assert.equal(commit.attestationEvidenceSha256, null, 'null evidence commits bind the literal null marker');
  assert.equal(commit.anchor.deviceId, rig.ceremony.deviceId);
  assert.equal(commit.anchor.dskKeyId, rig.ceremony.dskKeyId);
  assert.equal(commit.anchor.dskPublicKey, rig.ceremony.dskPublicKey);
  assert.equal(commit.anchor.signature, rig.perfect.proofSignature);
  assert.equal(commit.epochRecord.trustSetEpoch, 1);
  assert.equal(commit.epochRecord.keyEpoch, 1);
  assert.equal(commit.epochRecord.supersedesEpoch, null);
  assert.equal(commit.epochRecord.signerKeyId, rig.ceremony.dskKeyId);
  assert.equal(commit.epochRecord.signerDeviceId, rig.ceremony.deviceId);
  assert.equal(commit.epochRecord.signedEpochBytes.toString('utf8'), rig.perfect.epoch1Bytes);
  assert.equal(rig.verifier.calls.length, 1);
});

test('submit replays a committed ceremony by payload digest WITHOUT re-running attestation (M3)', async () => {
  let calls = 0;
  const verifier = {
    async verifyFirstDeviceAttestation(input) {
      calls += 1;
      if (calls > 1) throw new Error('attestation must not run on an idempotent replay');
      return verifiedVerdict(input);
    },
  };
  const rig = makeRig({ verifier });
  const input = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect);

  assert.deepEqual(await rig.service.submit(input), { status: 'ACCEPTED' });
  assert.equal(rig.store.ceremony.status, 'COMMITTED');
  assert.deepEqual(await rig.service.submit(input), { status: 'ACCEPTED' });
  assert.equal(calls, 1, 'the replay answered from the durable digest alone');
  assert.equal(rig.store.commitCalls.length, 1, 'the replay never reached the store');

  const different = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect, {
    // Deterministically different last character (never the same string
    // twice): the previous `${...slice(0, -1)}A` form was a ~1-in-16 flake
    // -- a random signature already ending in 'A' produced an IDENTICAL
    // payload, which the digest replay then rightly ACCEPTED.
    epoch1Signature: `${rig.perfect.epoch1Signature.slice(0, -1)}${
      rig.perfect.epoch1Signature.endsWith('A') ? 'B' : 'A'
    }`,
  });
  assert.deepEqual(await rig.service.submit(different), { status: 'REJECTED' }, 'a different payload can never replay');

  // R1-01: a changed proofSignature is a different committed identity (previously ACCEPTED).
  const changedProofSignature = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect, {
    proofSignature: `${rig.perfect.proofSignature.slice(0, -1)}${
      rig.perfect.proofSignature.endsWith('A') ? 'B' : 'A'
    }`,
  });
  assert.deepEqual(
    await rig.service.submit(changedProofSignature),
    { status: 'REJECTED' },
    'a changed proofSignature can never replay (R1-01)',
  );

  // R1-01: null and '' evidence are structurally distinct committed identities.
  assert.deepEqual(
    await rig.service.submit(submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect, { attestationEvidence: '' })),
    { status: 'REJECTED' },
    "null vs '' evidence must never collide (R1-01)",
  );
  assert.equal(rig.store.commitCalls.length, 1, 'no rejection ever reaches the store');
});

test('submit rejects proof-field and binding violations before ever reaching the store', async () => {
  const rig = makeRig();
  const input = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect);

  // A validly re-signed proof for a DIFFERENT nonce: decode passes, equality fails.
  const tamperedFields = { ...rig.perfect.proofFields, nonce: 'Z'.repeat(43) };
  const tamperedBytes = canonicalizeFirstDeviceBootstrapProof(tamperedFields);
  const tamperedSignature = signCanonical(rig.device.dskPrivateKey, tamperedBytes);

  const rejections = [
    { ...input, proofBytes: tamperedBytes, proofSignature: tamperedSignature },
    { ...input, proofSignature: signCanonical(makeP256Device('attacker').dskPrivateKey, input.proofBytes) },
    { ...input, proofBytes: `${input.proofBytes}trailing` },
    { ...input, ceremonyId: randomUUID() },
    { ...input, attemptRecoveryToken: 'wrong-token' },
    { ...input, attestationEvidence: 42 },
  ];
  for (const [index, candidate] of rejections.entries()) {
    const outcome = await rig.service.submit(candidate);
    assert.ok(['REJECTED', 'UNAVAILABLE'].includes(outcome.status), `case ${index} produced ${outcome.status}`);
    assert.equal(rig.store.commitCalls.length, 0, `case ${index} must not reach the store`);
  }
});

test('submit refuses state: not approved, expired, or bound to another ceremony', async () => {
  const rig = makeRig();
  const input = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect);

  rig.store.ceremony = { ...rig.ceremony, status: 'PENDING' };
  assert.deepEqual(await rig.service.submit(input), { status: 'UNAVAILABLE' });

  rig.store.ceremony = { ...rig.ceremony, status: 'APPROVED', expiresAt: stamp(-1) };
  assert.deepEqual(await rig.service.submit(input), { status: 'UNAVAILABLE' });

  rig.store.ceremony = { ...rig.ceremony, familyId: `other-${randomUUID()}` };
  assert.deepEqual(await rig.service.submit(input), { status: 'UNAVAILABLE' });

  rig.store.ceremony = { ...rig.ceremony, deviceId: randomUUID() };
  assert.deepEqual(await rig.service.submit(input), { status: 'UNAVAILABLE' });
  assert.equal(rig.store.commitCalls.length, 0);
});

test('submit rejects every epoch-1 genesis-invariant violation', async () => {
  const build = async (epochOverrides, proofOverrides = {}, signWith = null) => {
    const rig = makeRig();
    const perfect = buildPerfectSubmission({
      attempt: rig.attempt,
      ceremony: rig.ceremony,
      device: rig.device,
      epochOverrides,
      proofOverrides,
    });
    const input = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, perfect);
    const outcome = await rig.service.submit(signWith === null ? input : { ...input, epoch1Signature: signWith(perfect.epoch1Bytes) });
    return { rig, outcome };
  };

  // ts=2 / supersedes=1
  assert.deepEqual(
    (await build({ trustSetEpoch: 2, supersedesEpoch: 1 })).outcome,
    { status: 'REJECTED' },
  );
  // keyEpoch=2
  assert.deepEqual((await build({ keyEpoch: 2 })).outcome, { status: 'REJECTED' });
  // supersedes non-null at ts=1
  assert.deepEqual((await build({ supersedesEpoch: 1 })).outcome, { status: 'REJECTED' });
  // owner triple mismatch (a different DSK key id than the proof's)
  const mismatch = await build({
    entries: [
      {
        deviceId: 'i'.repeat(36).replace(/i/g, 'a'),
        role: 'OWNER',
        dskKeyId: randomUUID(),
        dskPublicKey: makeP256Device('other-owner').dskPublicKey,
        dekKeyId: 'dek-mismatch',
        dekPublicKey: 'mismatch-dek-public',
        status: 'ACTIVE',
      },
    ],
  });
  assert.deepEqual(mismatch.outcome, { status: 'REJECTED' });
  // proof/epoch hash mismatch (validly re-signed proof with a wrong hash)
  assert.deepEqual((await build({}, { epoch1Sha256Hex: 'ab'.repeat(32) })).outcome, { status: 'REJECTED' });
  // epoch signature by a DIFFERENT key
  const other = makeP256Device('epoch-signer');
  assert.deepEqual(
    (await build({}, {}, (bytes) => signCanonical(other.dskPrivateKey, bytes))).outcome,
    { status: 'REJECTED' },
  );
  // malformed epoch bytes
  const rig = makeRig();
  const base = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect);
  assert.deepEqual(await rig.service.submit({ ...base, epoch1Bytes: 'not-a-canonical-epoch' }), { status: 'REJECTED' });
  assert.deepEqual(await rig.service.submit({ ...base, epoch1Bytes: `${base.epoch1Bytes} ` }), { status: 'REJECTED' });
  assert.equal(rig.store.commitCalls.length, 0);
});

test('submit fails closed at the attestation boundary and digest-binds evidence in both directions', async () => {
  // Verifier unavailable
  const unavailable = makeRig({ verifier: new ScriptedAttestationVerifier({ status: 'UNAVAILABLE' }) });
  assert.deepEqual(
    await unavailable.service.submit(submissionInput(unavailable.attempt, unavailable.rawRecoveryToken, unavailable.ceremony, unavailable.perfect)),
    { status: 'REJECTED' },
  );
  assert.equal(unavailable.store.commitCalls.length, 0);

  // Verifier verified but its digest does not match the caller's evidence
  const wrongDigest = makeRig({
    verifier: new ScriptedAttestationVerifier({ status: 'VERIFIED', evidenceDigest: 'ff'.repeat(32) }),
  });
  assert.deepEqual(
    await wrongDigest.service.submit(submissionInput(wrongDigest.attempt, wrongDigest.rawRecoveryToken, wrongDigest.ceremony, wrongDigest.perfect)),
    { status: 'REJECTED' },
  );

  // Evidence provided, verifier digest matches, but the PROOF does not bind it
  const rig = makeRig();
  const evidence = 'attestation-evidence-blob';
  const perfectWithoutBoundDigest = buildPerfectSubmission({
    attempt: rig.attempt,
    ceremony: rig.ceremony,
    device: rig.device,
  });
  const input = submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, perfectWithoutBoundDigest, { attestationEvidence: evidence });
  rig.verifier.verdict = { status: 'VERIFIED', evidenceDigest: sha256Hex(evidence) };
  assert.deepEqual(await rig.service.submit(input), { status: 'REJECTED' });

  // Fully evidence-bound happy path: proof digest + verifier digest + evidence all equal.
  // The default ScriptedAttestationVerifier echoes the expected DSK triple and the
  // null-safe evidence digest (the correct-verifier shape a real 6C/6D verifier must emit).
  const bound = makeRig();
  const boundPerfect = buildPerfectSubmission({
    attempt: bound.attempt,
    ceremony: bound.ceremony,
    device: bound.device,
    attestationEvidence: evidence,
  });
  assert.deepEqual(
    await bound.service.submit(submissionInput(bound.attempt, bound.rawRecoveryToken, bound.ceremony, boundPerfect, { attestationEvidence: evidence })),
    { status: 'ACCEPTED' },
  );
  assert.equal(
    bound.store.commitCalls[0].payloadDigest,
    computeFirstDeviceBootstrapCommitDigest({
      proofBytes: boundPerfect.proofBytes,
      proofSignature: boundPerfect.proofSignature,
      epoch1Bytes: boundPerfect.epoch1Bytes,
      epoch1Signature: boundPerfect.epoch1Signature,
      attestationEvidence: evidence,
    }),
    'evidence is part of the durable committed identity',
  );
  assert.equal(bound.store.commitCalls[0].attestationEvidenceSha256, sha256Hex(evidence));
});

test('submit refuses device claims that do not match the enrollment attempt DSK (M1)', async () => {
  const rig = makeRig();
  // Ceremony carries an attacker key claim: proof/ceremony agree with each other
  // but disagree with the attempt's registered DSK -> REJECTED without commit.
  const attacker = makeP256Device('attacker-key');
  const swapped = {
    ...rig.ceremony,
    dskKeyId: attacker.dskKeyId,
    dskPublicKey: attacker.dskPublicKey,
  };
  rig.store.ceremony = swapped;
  const perfect = buildPerfectSubmission({ attempt: rig.attempt, ceremony: swapped, device: attacker });
  assert.deepEqual(
    await rig.service.submit(submissionInput(rig.attempt, rig.rawRecoveryToken, swapped, perfect)),
    { status: 'REJECTED' },
  );
  assert.equal(rig.store.commitCalls.length, 0);
});

test('approve maps the store outcome vocabulary one-to-one and never widens eligibility', async () => {
  const rig = makeRig();
  rig.store.eligibility = false;
  const approve = () => rig.service.approve({ ceremonyId: rig.ceremony.ceremonyId, familyId: rig.ceremony.familyId, accountId: randomUUID() });

  rig.store.approveOutcome = { outcome: 'NOT_ELIGIBLE' };
  assert.deepEqual(await approve(), { status: 'NOT_ELIGIBLE' });
  rig.store.approveOutcome = { outcome: 'NOT_FOUND' };
  assert.deepEqual(await approve(), { status: 'NOT_FOUND' });
  rig.store.approveOutcome = { outcome: 'NOT_PENDING' };
  assert.deepEqual(await approve(), { status: 'NOT_APPROVABLE' });
  rig.store.approveOutcome = { outcome: 'EXPIRED' };
  assert.deepEqual(await approve(), { status: 'NOT_APPROVABLE' });

  rig.store.approveOutcome = null;
  rig.store.eligibility = true;
  rig.store.ceremony = { ...rig.ceremony, status: 'PENDING' };
  const approved = await approve();
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.ceremony.status, 'APPROVED');

  // Cross-family ceremony ids read as not found, never as NOT_ELIGIBLE.
  const crossFamily = await rig.service.approve({ ceremonyId: rig.ceremony.ceremonyId, familyId: `other-${randomUUID()}`, accountId: randomUUID() });
  assert.deepEqual(crossFamily, { status: 'NOT_FOUND' });
});

test('describeForApproval is family-scoped and checkApprovalEligibility refuses non-strings', async () => {
  const rig = makeRig();
  const record = await rig.service.describeForApproval(rig.ceremony.familyId, rig.ceremony.ceremonyId);
  assert.equal(record?.ceremonyId, rig.ceremony.ceremonyId);
  assert.equal(await rig.service.describeForApproval(`other-${randomUUID()}`, rig.ceremony.ceremonyId), null);
  assert.equal(await rig.service.describeForApproval(rig.ceremony.familyId, randomUUID()), null);

  rig.store.eligibility = true;
  assert.equal(await rig.service.checkApprovalEligibility(rig.ceremony.familyId, randomUUID()), true);
  assert.equal(await rig.service.checkApprovalEligibility(undefined, randomUUID()), false);
});

test('submit hands the verifier the exact expected DSK triple, ceremony context and raw evidence (R1-02)', async () => {
  const rig = makeRig();
  const evidence = 'dsk-binding-evidence';
  const perfect = buildPerfectSubmission({ attempt: rig.attempt, ceremony: rig.ceremony, device: rig.device, attestationEvidence: evidence });
  assert.deepEqual(
    await rig.service.submit(submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, perfect, { attestationEvidence: evidence })),
    { status: 'ACCEPTED' },
  );
  assert.equal(rig.verifier.calls.length, 1);
  const captured = rig.verifier.calls[0];
  assert.equal(captured.expectedDskKeyId, rig.ceremony.dskKeyId);
  assert.equal(captured.expectedDskPublicKey, rig.ceremony.dskPublicKey);
  assert.equal(captured.expectedDskAlgorithm, rig.ceremony.dskAlgorithm);
  assert.equal(captured.ceremonyId, rig.ceremony.ceremonyId);
  assert.equal(captured.challengeId, rig.ceremony.challengeId);
  assert.equal(captured.nonce, rig.ceremony.nonce);
  assert.equal(captured.familyId, rig.attempt.familyId);
  assert.equal(captured.deviceId, rig.attempt.deviceId);
  assert.equal(captured.attestationEvidence, evidence, 'the raw evidence string is passed byte-identically');
});

test('attested DSK identity mismatches (keyId / publicKey / algorithm / non-canonical key) are REJECTED with zero writes (R1-02)', async () => {
  const cases = [
    { attestedDskKeyId: randomUUID() },
    { attestedDskPublicKey: makeP256Device('different-attested-key').dskPublicKey },
    { attestedDskAlgorithm: 'ECDSA_P256_SHA384' },
    { attestedDskPublicKey: 'A'.repeat(86) },
  ];
  for (const [index, overrides] of cases.entries()) {
    const rig = makeRig({ verifier: new MismatchedAttestationVerifier(overrides) });
    const outcome = await rig.service.submit(submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect));
    assert.deepEqual(outcome, { status: 'REJECTED' }, `mismatch case ${index} must reject`);
    assert.equal(rig.store.commitCalls.length, 0, `mismatch case ${index} must not reach the store`);
    assert.equal(rig.store.ceremony.status, 'APPROVED', `mismatch case ${index} leaves the challenge unconsumed`);
  }
});

test('a degenerate VERIFIED verdict without the attested key identity is REJECTED (R1-02 fail-closed)', async () => {
  const rig = makeRig({ verifier: new ScriptedAttestationVerifier({ status: 'VERIFIED', evidenceDigest: null }) });
  assert.deepEqual(
    await rig.service.submit(submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, rig.perfect)),
    { status: 'REJECTED' },
  );
  assert.equal(rig.store.commitCalls.length, 0);
});

test('the commit carries the R1-03 audit digests: proof sha and null-safe evidence sha', async () => {
  const rig = makeRig();
  const evidence = 'audit-evidence';
  const perfect = buildPerfectSubmission({ attempt: rig.attempt, ceremony: rig.ceremony, device: rig.device, attestationEvidence: evidence });
  assert.deepEqual(
    await rig.service.submit(submissionInput(rig.attempt, rig.rawRecoveryToken, rig.ceremony, perfect, { attestationEvidence: evidence })),
    { status: 'ACCEPTED' },
  );
  const commit = rig.store.commitCalls[0];
  assert.equal(commit.bootstrapProofSha256, sha256Hex(perfect.proofBytes));
  assert.equal(commit.attestationEvidenceSha256, sha256Hex(evidence));
  assert.equal(rig.store.ceremony.bootstrapProofSha256, sha256Hex(perfect.proofBytes));
});
