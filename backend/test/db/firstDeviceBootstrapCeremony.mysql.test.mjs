// WAVE 6B -- the FIRST-DEVICE TRUST-ROOT BOOTSTRAP ceremony against the REAL
// durable stack: MySqlFirstDeviceBootstrapStore + MySqlTrustSetEpochStore
// (migration 0062 ceremony row, migration 0011 anchor, migration 0060 epochs
// and floors), the REAL FirstDeviceBootstrapService verification chain, and
// REAL P-256 device keys.
//
// WHAT THIS PROVES, AND WHY EACH CASE IS HERE (owner rulings D4/F4/F5,
// WAVE 6B sections 5/8/9/15, frozen-design amendments M1-M4/H2/H3/H8):
//   - VALID FIRST ROOT: a provisioned-owner-approved ceremony commits exactly
//     one anchor (bootstrap-proof signature, PCA_FIRST_DEVICE_BOOTSTRAP_V1
//     scheme) plus the byte-exact certified epoch 1 and floors (1,1), and a
//     byte-identical retry replays idempotently while a changed payload is
//     rejected.
//   - REJECTIONS WRITE NOTHING: wrong proof signature, wrong epoch-1
//     signature, and a ceremony-mismatched proof each leave the ceremony
//     APPROVED with no anchor/epoch/floors -- and a subsequent valid
//     submission still succeeds (no wedge from rejections).
//   - ONE ROOT PER FAMILY: after a root exists, a second device's fully
//     approved ceremony can never commit (ALREADY_BOOTSTRAPPED), and two
//     CONCURRENT approved ceremonies resolve to exactly one committed root.
//   - REVOCATION ORDERING: bootstrap holds the device lifecycle row lock
//     through anchor/epoch commit, and a revocation that wins first prevents
//     all bootstrap writes including a provisional floor row.
//   - DSK REVOCATION ORDERING: bootstrap also locks the exact attempt DSK;
//     revocation that wins before commit rejects even if a different DSK on
//     the same device remains active.
//   - ATOMIC ROLLBACK (H8 seam): a forced failure after the anchor INSERT
//     rolls back everything (no anchor, no epoch, no floors, challenge not
//     consumed) and the same ceremony then commits cleanly on retry.
//   - ELIGIBILITY FAILS CLOSED: non-provisioned family, disabled account,
//     VIEWER membership and SUSPENDED family each refuse approval.
//   - CROSS-FAMILY ISOLATION: independent families bootstrap independently;
//     a foreign owner cannot approve and a foreign ceremony cannot be used.
//   - DEVICE/CREDENTIAL GATES: REVOKED/ACTIVE device states, a wrong DSK
//     claim, and a wrong attempt credential can never issue a challenge.
//   - PRODUCTION ATTESTATION IS FAIL-CLOSED (rulings 11 + Wave 6C): with no
//     configured pinned roots the production platform router answers
//     UNAVAILABLE, so a cryptographically perfect submission is rejected
//     with zero writes; only an explicit test verifier (as injected here,
//     never in production) lets the ceremony commit. The real Android
//     verifier and its fail-closed composition are exercised by the
//     dedicated Wave-6C unit suites
//     (androidKeyAttestationVerifier/platformAttestationVerifier).
//   - EXPIRY: approve-after-expiry and submit-after-expiry fail closed.
//   - 0062 CHECK WIDENING: the step-up operation CHECK accepts
//     'family.device.bootstrap.root' and still refuses unknown operations.
//
// EXECUTED BY THE DISPOSABLE-DB LANES. Registration is applied by the
// coordinator: this file must be appended to `test:db:inner` in
// backend/package.json (after familyTrustSetEpochAcceptance). Requires
// PCA_DATABASE_URL like every file in this directory. Families are UUIDs
// because families.family_id is CHAR(36); every other id is unique per case,
// so runs can never collide with each other or with other suites.
//
// The P-256 key/signing/attestation plumbing is shared with the Wave 6B unit
// suites through firstDeviceBootstrapFixtures.mjs -- one implementation, no
// drifting copies.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { MySqlTrustSetEpochStore } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { MySqlFirstDeviceBootstrapStore } from '../../dist/familytrustset/MySqlFirstDeviceBootstrapStore.js';
import { FirstDeviceBootstrapService } from '../../dist/familytrustset/FirstDeviceBootstrapService.js';
import { FailClosedAttestationVerifier } from '../../dist/familytrustset/AttestationVerifier.js';
import {
  ANCHOR_SIGNATURE_SCHEME_FIRST_DEVICE,
  TRUST_ROOT_PROTOCOL_VERSION,
  canonicalizeFirstDeviceBootstrapProof,
  verifyFirstDeviceBootstrapProofSignature,
} from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';
import { computeFirstDeviceBootstrapCommitDigest } from '../../dist/familytrustset/FirstDeviceBootstrapCommit.js';
import {
  buildPerfectSubmission,
  makeP256Device,
  sha256Hex,
  signCanonical,
  submissionInput,
} from '../familytrustset/firstDeviceBootstrapFixtures.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const TEST_EVIDENCE = 'wave6b-db-acceptance-attestation-evidence';

/**
 * The explicit TEST verifier (ruling 11: injectable in tests only). VERIFIED
 * only when bounded evidence is present, bound exactly like production would
 * be: the verdict's digest is sha256(evidence), and the service requires it
 * to equal BOTH the caller's digest and the digest bound inside the proof.
 */
class AcceptingTestAttestationVerifier {
  async verifyFirstDeviceAttestation(input) {
    if (input.attestationEvidence === null) return { status: 'REJECTED', reason: 'missing-evidence' };
    if (Buffer.byteLength(input.attestationEvidence, 'utf8') > 16_384) return { status: 'REJECTED', reason: 'oversized-evidence' };
    return {
      status: 'VERIFIED',
      evidenceDigest: sha256Hex(input.attestationEvidence),
      attestedDskKeyId: input.expectedDskKeyId,
      attestedDskPublicKey: input.expectedDskPublicKey,
      attestedDskAlgorithm: input.expectedDskAlgorithm,
    };
  }
}

function makeService({ attestationVerifier = new AcceptingTestAttestationVerifier(), commitHooks } = {}) {
  const epochStore = new MySqlTrustSetEpochStore();
  const store = new MySqlFirstDeviceBootstrapStore(
    commitHooks === undefined ? { epochStore } : { epochStore, commitHooks },
  );
  return new FirstDeviceBootstrapService({ store, attestationVerifier });
}

/** Fresh instances over the same durable state -- proves readback needs no process memory. */
function freshService() {
  return makeService();
}

/**
 * Seeds the complete provable chain for one bootstrappable family:
 * service_account -> parent_account (VERIFIED, same service identity) ->
 * family (ACTIVE, provisioned owner) -> ACTIVE ADMINISTRATOR membership ->
 * PAIRING_PENDING device -> REDEEMED invitation -> COMPLETED attempt whose
 * registered DSK is `device`'s real P-256 key (amendment M1: the ceremony may
 * only ever carry the attempt's DSK).
 */
async function seedBootstrappableFamily({
  provisioned = true,
  accountStatus = 'VERIFIED',
  accountDisabled = false,
  membershipRole = 'ADMINISTRATOR',
  membershipStatus = 'ACTIVE',
  familyStatus = 'ACTIVE',
  deviceStatus = 'PAIRING_PENDING',
  label = 'root',
} = {}) {
  const serviceAccountId = randomUUID();
  const accountId = randomUUID();
  const familyId = randomUUID();
  const device = makeP256Device(label);
  const attemptId = randomBytes(24).toString('base64url');
  const rawRecoveryToken = randomBytes(32).toString('base64url');
  const invitationId = randomUUID();

  await getPool().query(
    `INSERT INTO service_accounts (account_id, account_reference_hash, created_at, disabled_at) VALUES (?, ?, NOW(3), NULL)`,
    [serviceAccountId, randomBytes(32)],
  );
  await getPool().query(
    `INSERT INTO parent_accounts
       (account_id, email_hash, password_hash, status, family_id, service_account_id, free_access_mode, created_at, verified_at, disabled_at)
     VALUES (?, ?, 'wave6b-db-fixture-placeholder', ?, ?, ?, 'PERPETUAL', NOW(3), NOW(3), ?)`,
    [accountId, randomBytes(32), accountStatus, familyId, serviceAccountId, accountDisabled ? new Date() : null],
  );
  if (familyStatus === 'SUSPENDED') {
    // The suspension-pair CHECK requires all three suspension columns together, and the
    // acting admin must exist (FK). Seed a minimal platform admin for this fixture family.
    const adminId = randomUUID();
    await getPool().query(
      `INSERT INTO platform_admin_accounts (admin_id, email_hash, display_name, password_credential, status, created_at)
       VALUES (?, ?, 'Wave 6B fixture admin', 'wave6b-db-fixture-credential', 'ACTIVE', NOW(3))`,
      [adminId, randomBytes(32)],
    );
    await getPool().query(
      `INSERT INTO families
         (family_id, family_reference_hash, created_at, status, provisioned_for_account_id, suspended_at, suspended_by_admin_id, suspension_reason)
       VALUES (?, ?, NOW(3), 'SUSPENDED', ?, NOW(3), ?, 'wave6b-db-fixture-suspension')`,
      [familyId, randomBytes(32), provisioned ? accountId : null, adminId],
    );
  } else {
    await getPool().query(
      `INSERT INTO families (family_id, family_reference_hash, created_at, status, provisioned_for_account_id)
       VALUES (?, ?, NOW(3), ?, ?)`,
      [familyId, randomBytes(32), familyStatus, provisioned ? accountId : null],
    );
  }
  await getPool().query(
    `INSERT INTO family_parent_memberships (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [randomUUID(), familyId, accountId, serviceAccountId, membershipRole, membershipStatus],
  );
  const enrollment = await seedDeviceChain({ familyId, device, attemptId, rawRecoveryToken, deviceStatus, invitationId });

  return { serviceAccountId, accountId, familyId, device, attemptId, rawRecoveryToken, ...enrollment };
}

/** The durable enrollment chain itself: device -> REDEEMED invitation -> COMPLETED attempt. */
async function seedDeviceChain({ familyId, device, attemptId, rawRecoveryToken, deviceStatus, invitationId = randomUUID() }) {
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', ?, NOW(3))`,
    [device.deviceId, familyId, deviceStatus],
  );
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', NOW(3), NULL)`,
    [device.deviceId, device.dskKeyId, device.dskPublicKey],
  );
  await getPool().query(
    `INSERT INTO enrollment_invitations
       (invitation_id, family_id, child_profile_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, 'ANDROID', 'ANDROID_PROTECTED', 'REDEEMED', NOW(3), DATE_ADD(NOW(3), INTERVAL 7 DAY))`,
    [invitationId, familyId, `child-w6b-${randomBytes(6).toString('hex')}`, randomBytes(32).toString('hex')],
  );
  await getPool().query(
    `INSERT INTO enrollment_bootstrap_attempts
       (attempt_id, token_hash, recovery_token_hash, platform, signing_public_key, encryption_public_key,
        device_id, signing_key_id, encryption_key_id, invitation_id, family_id, status, created_at)
     VALUES (?, ?, ?, 'ANDROID', ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', NOW(3))`,
    [
      attemptId,
      randomBytes(32).toString('hex'),
      sha256Hex(rawRecoveryToken),
      device.dskPublicKey,
      device.dekPublicKey,
      device.deviceId,
      device.dskKeyId,
      randomUUID(),
      invitationId,
      familyId,
    ],
  );
  return { invitationId };
}

/** A second (or Nth) candidate device for an ALREADY-seeded family. */
async function seedAdditionalDeviceForFamily(familyId, label) {
  const device = makeP256Device(label);
  const attemptId = randomBytes(24).toString('base64url');
  const rawRecoveryToken = randomBytes(32).toString('base64url');
  await seedDeviceChain({ familyId, device, attemptId, rawRecoveryToken, deviceStatus: 'PAIRING_PENDING' });
  return { device, attemptId, rawRecoveryToken };
}

async function countRows(table, familyId) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM ${table} WHERE family_id = ?`, [familyId]);
  return rows[0].n;
}

async function anchorRowFor(familyId) {
  const [rows] = await getPool().query(
    `SELECT genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, signature, signature_scheme
       FROM family_authority_genesis_anchors WHERE family_id = ?`,
    [familyId],
  );
  return rows[0] ?? null;
}

async function epochRowsFor(familyId) {
  const [rows] = await getPool().query(
    `SELECT trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id
       FROM family_trust_set_epochs WHERE family_id = ? ORDER BY trust_set_epoch`,
    [familyId],
  );
  return rows;
}

async function floorsRowFor(familyId) {
  const [rows] = await getPool().query(
    `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch FROM family_epoch_floors WHERE family_id = ?`,
    [familyId],
  );
  return rows[0] ?? null;
}

async function ceremonyRowFor(ceremonyId) {
  const [rows] = await getPool().query(
    `SELECT status, outcome, consumed_at, payload_digest, approved_by_account_id,
            bootstrap_proof_sha256, attestation_evidence_sha256
       FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ?`,
    [ceremonyId],
  );
  return rows[0] ?? null;
}

function expectedPayloadDigest(submission, evidence) {
  return computeFirstDeviceBootstrapCommitDigest({
    proofBytes: submission.proofBytes,
    proofSignature: submission.proofSignature,
    epoch1Bytes: submission.epoch1Bytes,
    epoch1Signature: submission.epoch1Signature,
    attestationEvidence: evidence ?? null,
  });
}

/** issueChallenge -> approve -> build the perfect dual-signed submission. */
async function runCeremonyToApproved(service, seed, evidence = TEST_EVIDENCE) {
  const issued = await service.issueChallenge({
    attemptId: seed.attemptId,
    attemptRecoveryToken: seed.rawRecoveryToken,
    dskKeyId: seed.device.dskKeyId,
    dskPublicKey: seed.device.dskPublicKey,
  });
  assert.equal(issued.status, 'PENDING');
  const approved = await service.approve({
    ceremonyId: issued.ceremonyId,
    familyId: seed.familyId,
    accountId: seed.accountId,
  });
  assert.equal(approved.status, 'APPROVED');
  const ceremony = approved.ceremony;
  const submission = buildPerfectSubmission({
    attempt: { attemptId: seed.attemptId, familyId: seed.familyId },
    ceremony,
    device: seed.device,
    attestationEvidence: evidence,
  });
  return { issued, ceremony, submission, input: submissionInput({ attemptId: seed.attemptId }, seed.rawRecoveryToken, ceremony, submission) };
}

test('OWNER DISCOVERY: approval list is family-scoped and excludes expired ceremonies', async () => {
  const family = await seedBootstrappableFamily({ label: 'list-family' });
  const secondDevice = await seedAdditionalDeviceForFamily(family.familyId, 'list-approved');
  const foreignFamily = await seedBootstrappableFamily({ label: 'list-foreign' });
  const service = makeService();

  const pending = await service.issueChallenge({
    attemptId: family.attemptId,
    attemptRecoveryToken: family.rawRecoveryToken,
    dskKeyId: family.device.dskKeyId,
    dskPublicKey: family.device.dskPublicKey,
  });
  const approved = await service.issueChallenge({
    attemptId: secondDevice.attemptId,
    attemptRecoveryToken: secondDevice.rawRecoveryToken,
    dskKeyId: secondDevice.device.dskKeyId,
    dskPublicKey: secondDevice.device.dskPublicKey,
  });
  const foreign = await service.issueChallenge({
    attemptId: foreignFamily.attemptId,
    attemptRecoveryToken: foreignFamily.rawRecoveryToken,
    dskKeyId: foreignFamily.device.dskKeyId,
    dskPublicKey: foreignFamily.device.dskPublicKey,
  });
  assert.equal(pending.status, 'PENDING');
  assert.equal(approved.status, 'PENDING');
  assert.equal(foreign.status, 'PENDING');
  assert.equal((await service.approve({ ceremonyId: approved.ceremonyId, familyId: family.familyId, accountId: family.accountId })).status, 'APPROVED');
  await getPool().execute(
    `UPDATE family_first_device_bootstrap_ceremonies
        SET created_at = DATE_SUB(NOW(3), INTERVAL 2 MINUTE),
            expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE)
      WHERE ceremony_id = ?`,
    [pending.ceremonyId],
  );

  const store = new MySqlFirstDeviceBootstrapStore({ epochStore: new MySqlTrustSetEpochStore() });
  const listed = await store.listApprovalCeremonies(family.familyId, new Date(), 25);
  assert.deepEqual(listed.map((row) => row.ceremonyId), [approved.ceremonyId]);
  assert.equal(listed[0].status, 'APPROVED');
  assert.equal(listed.some((row) => row.ceremonyId === foreign.ceremonyId), false);
});

test('VALID FIRST ROOT: a provisioned-owner approval commits exactly one anchor + byte-exact epoch 1 + floors (1,1); retries replay idempotently', async () => {
  const seed = await seedBootstrappableFamily({ label: 'valid' });
  const service = makeService();
  const { issued, ceremony, submission, input } = await runCeremonyToApproved(service, seed);

  assert.equal(issued.familyId, seed.familyId);
  assert.equal(issued.deviceId, seed.device.deviceId);
  assert.equal(issued.nonce.length, 43);

  assert.deepEqual(await service.submit(input), { status: 'ACCEPTED' });

  // Anchor: exact triple, bootstrap-proof signature, explicit scheme discriminator.
  const anchor = await anchorRowFor(seed.familyId);
  assert.equal(anchor.genesis_device_id, seed.device.deviceId);
  assert.equal(anchor.genesis_dsk_key_id, seed.device.dskKeyId);
  assert.equal(anchor.genesis_dsk_public_key, seed.device.dskPublicKey);
  assert.equal(Number(anchor.protocol_version), TRUST_ROOT_PROTOCOL_VERSION);
  assert.equal(anchor.signature, submission.proofSignature);
  assert.equal(anchor.signature_scheme, ANCHOR_SIGNATURE_SCHEME_FIRST_DEVICE);

  // Epoch 1: byte-exact certified Wave-5B bytes, signer = the candidate device.
  const epochs = await epochRowsFor(seed.familyId);
  assert.equal(epochs.length, 1);
  assert.equal(Number(epochs[0].trust_set_epoch), 1);
  assert.equal(Number(epochs[0].key_epoch), 1);
  assert.equal(epochs[0].supersedes_epoch, null);
  assert.ok(Buffer.from(epochs[0].signed_epoch_bytes).equals(Buffer.from(submission.epoch1Bytes, 'utf8')));
  assert.equal(epochs[0].signature, submission.epoch1Signature);
  assert.equal(epochs[0].signer_device_id, seed.device.deviceId);
  assert.equal(epochs[0].signer_key_id, seed.device.dskKeyId);

  // Floors reach (1,1); the ceremony is durably COMMITTED with the recorded digest.
  const floors = await floorsRowFor(seed.familyId);
  assert.equal(Number(floors.minimum_accepted_trust_set_epoch), 1);
  assert.equal(Number(floors.minimum_accepted_key_epoch), 1);
  const committed = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(committed.outcome, 'ACCEPTED');
  assert.equal(committed.payload_digest, expectedPayloadDigest(submission, TEST_EVIDENCE));
  assert.equal(committed.bootstrap_proof_sha256, sha256Hex(submission.proofBytes), 'R1-03: proof sha persisted');
  assert.equal(committed.attestation_evidence_sha256, sha256Hex(TEST_EVIDENCE), 'R1-03: evidence sha persisted');
  assert.equal(committed.approved_by_account_id, seed.accountId);
  assert.notEqual(committed.consumed_at, null);

  // Exact retry: idempotent ACCEPTED, no additional writes.
  assert.deepEqual(await service.submit(input), { status: 'ACCEPTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);

  // Conflicting retry: a different payload can never re-enter a committed ceremony.
  const conflicting = buildPerfectSubmission({
    attempt: { attemptId: seed.attemptId, familyId: seed.familyId },
    ceremony,
    device: seed.device,
    attestationEvidence: TEST_EVIDENCE,
    epochOverrides: { issuedAt: new Date(Date.now() + 1000) },
  });
  assert.deepEqual(
    await service.submit(submissionInput({ attemptId: seed.attemptId }, seed.rawRecoveryToken, ceremony, conflicting)),
    { status: 'REJECTED' },
  );
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);

  // Readback through brand-new instances: durable state alone answers.
  const fresh = freshService();
  assert.deepEqual(
    await fresh.readStatus({ attemptId: seed.attemptId, attemptRecoveryToken: seed.rawRecoveryToken, ceremonyId: ceremony.ceremonyId }),
    { status: 'COMMITTED', outcome: 'ACCEPTED' },
  );
});

test('REJECTIONS WRITE NOTHING: wrong proof signature, wrong epoch-1 signature and a mismatched proof each leave the DB untouched, and a valid retry still commits', async () => {
  const seed = await seedBootstrappableFamily({ label: 'reject' });
  const service = makeService();
  const { ceremony, submission, input } = await runCeremonyToApproved(service, seed);
  const otherDevice = makeP256Device('attacker');

  // (a) Bootstrap proof signed by the wrong key.
  const badProof = { ...input, proofSignature: signCanonical(otherDevice.dskPrivateKey, submission.proofBytes) };
  assert.deepEqual(await service.submit(badProof), { status: 'REJECTED' });

  // (b) Epoch-1 signature over the right bytes by the wrong key.
  const badEpochSig = { ...input, epoch1Signature: signCanonical(otherDevice.dskPrivateKey, submission.epoch1Bytes) };
  assert.deepEqual(await service.submit(badEpochSig), { status: 'REJECTED' });

  // (c) Proof bound to a different nonce than the durable ceremony.
  const mismatched = buildPerfectSubmission({
    attempt: { attemptId: seed.attemptId, familyId: seed.familyId },
    ceremony,
    device: seed.device,
    attestationEvidence: TEST_EVIDENCE,
    proofOverrides: { nonce: 'X'.repeat(43) },
  });
  assert.deepEqual(
    await service.submit(submissionInput({ attemptId: seed.attemptId }, seed.rawRecoveryToken, ceremony, mismatched)),
    { status: 'REJECTED' },
  );

  // Every rejection left zero durable residue: still APPROVED, nothing written.
  const row = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.consumed_at, null);
  assert.equal(row.payload_digest, null);
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 0);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 0);
  assert.equal(await countRows('family_epoch_floors', seed.familyId), 0);

  // No wedge: the original valid submission still commits.
  assert.deepEqual(await service.submit(input), { status: 'ACCEPTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
});

test('ONE ROOT PER FAMILY: a second device\'s approved ceremony can never commit once a root exists', async () => {
  const seed = await seedBootstrappableFamily({ label: 'first' });
  const service = makeService();
  const first = await runCeremonyToApproved(service, seed);
  assert.deepEqual(await service.submit(first.input), { status: 'ACCEPTED' });

  const secondSeed = await seedAdditionalDeviceForFamily(seed.familyId, 'second');
  const second = await runCeremonyToApproved(service, { ...seed, ...secondSeed });
  assert.deepEqual(await service.submit(second.input), { status: 'REJECTED' });

  // The original root survives untouched; the loser is not consumed.
  const anchor = await anchorRowFor(seed.familyId);
  assert.equal(anchor.genesis_device_id, seed.device.deviceId);
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);
  const loser = await ceremonyRowFor(second.ceremony.ceremonyId);
  assert.equal(loser.status, 'APPROVED');
  assert.equal(loser.consumed_at, null);
});

test('CONCURRENT CEREMONIES: two approved candidates race -- exactly one root commits', async () => {
  const seed = await seedBootstrappableFamily({ label: 'race-a' });
  const secondSeed = await seedAdditionalDeviceForFamily(seed.familyId, 'race-b');
  const seedB = { ...seed, ...secondSeed };
  const service = makeService();
  const first = await runCeremonyToApproved(service, seed);
  const second = await runCeremonyToApproved(service, seedB);

  const results = await Promise.all([service.submit(first.input), service.submit(second.input)]);
  const accepted = results.filter((result) => result.status === 'ACCEPTED');
  assert.equal(accepted.length, 1, `exactly one candidate may commit, got ${JSON.stringify(results)}`);

  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);
  const anchor = await anchorRowFor(seed.familyId);
  const winnerDevice = accepted[0] === results[0] ? seed.device : seedB.device;
  assert.equal(anchor.genesis_device_id, winnerDevice.deviceId);
  const committedRows = await getPool().query(
    `SELECT COUNT(*) AS n FROM family_first_device_bootstrap_ceremonies WHERE family_id = ? AND status = 'COMMITTED'`,
    [seed.familyId],
  );
  assert.equal(committedRows[0][0].n, 1);
  const floors = await floorsRowFor(seed.familyId);
  assert.equal(Number(floors.minimum_accepted_trust_set_epoch), 1);
  assert.equal(Number(floors.minimum_accepted_key_epoch), 1);
});

test('ATOMIC ROLLBACK: a failure after the anchor INSERT leaves zero partial state, and the same ceremony then commits on retry', async () => {
  const seed = await seedBootstrappableFamily({ label: 'rollback' });
  const service = makeService();
  const { ceremony, input } = await runCeremonyToApproved(service, seed);

  const hookedStore = new MySqlFirstDeviceBootstrapStore({
    epochStore: new MySqlTrustSetEpochStore(),
    commitHooks: {
      afterAnchorInsert: () => {
        throw new Error('wave6b-rollback-seam');
      },
    },
  });
  const hookedService = new FirstDeviceBootstrapService({
    store: hookedStore,
    attestationVerifier: new AcceptingTestAttestationVerifier(),
  });
  await assert.rejects(() => hookedService.submit(input), /wave6b-rollback-seam/);

  // Nothing partial survived the rollback -- not the anchor, not the epoch,
  // not the floors row, and the challenge was NOT consumed.
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 0);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 0);
  assert.equal(await countRows('family_epoch_floors', seed.familyId), 0);
  const row = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.consumed_at, null);

  // The ceremony is still fully usable: retry with the normal store commits.
  assert.deepEqual(await freshService().submit(input), { status: 'ACCEPTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);
});

test('DEVICE REVOCATION RACE: bootstrap holds the lifecycle lock through commit before revocation transitions the device', async () => {
  const seed = await seedBootstrappableFamily({ label: 'bootstrap-revoke-race' });
  const { ceremony, input } = await runCeremonyToApproved(freshService(), seed);

  let notifyCommitPaused;
  let releaseCommit;
  const commitPaused = new Promise((resolve) => { releaseCommit = resolve; });
  const commitReachedAnchor = new Promise((resolve) => { notifyCommitPaused = resolve; });
  const service = makeService({
    commitHooks: {
      afterAnchorInsert: async () => {
        notifyCommitPaused();
        await commitPaused;
      },
    },
  });

  const bootstrap = service.submit(input);
  await commitReachedAnchor;

  let revokeSettled = false;
  const revoke = new MySqlDeviceRepository()
    .revokeDeviceAndKeysAtomically(seed.familyId, seed.device.deviceId, new Date())
    .finally(() => { revokeSettled = true; });

  // A consistent read must still see the pre-revoke state while the bootstrap
  // transaction is paused with the device row lock held. Without that lock the
  // revoke commits during this window, leaving a root accepted after revocation.
  const lockWindowDeadline = Date.now() + 500;
  let statusDuringBootstrap;
  while (Date.now() < lockWindowDeadline && !revokeSettled) {
    const [rows] = await getPool().query('SELECT status FROM devices WHERE device_id = ?', [seed.device.deviceId]);
    statusDuringBootstrap = rows[0]?.status;
    if (statusDuringBootstrap === 'REVOKED') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const revokeWaitedForBootstrap = !revokeSettled && statusDuringBootstrap !== 'REVOKED';

  releaseCommit();
  const [bootstrapResult, revokeResult] = await Promise.all([bootstrap, revoke]);

  assert.equal(revokeWaitedForBootstrap, true, 'device revocation must wait for the in-flight bootstrap transaction');
  assert.deepEqual(bootstrapResult, { status: 'ACCEPTED' });
  assert.equal(revokeResult.outcome, 'REVOKED');
  assert.equal(revokeResult.transitioned, true);
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);
  const committed = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(committed.status, 'COMMITTED');
  const [deviceRows] = await getPool().query('SELECT status FROM devices WHERE device_id = ?', [seed.device.deviceId]);
  assert.equal(deviceRows[0].status, 'REVOKED');
});

test('DEVICE REVOCATION FIRST: a revoked signer cannot commit bootstrap or leave a floor row', async () => {
  const seed = await seedBootstrappableFamily({ label: 'bootstrap-revoked-before-commit' });
  const { ceremony, input } = await runCeremonyToApproved(freshService(), seed);
  const revoked = await new MySqlDeviceRepository().revokeDeviceAndKeysAtomically(
    seed.familyId,
    seed.device.deviceId,
    new Date(),
  );
  assert.equal(revoked.outcome, 'REVOKED');
  assert.equal(revoked.transitioned, true);

  assert.deepEqual(await freshService().submit(input), { status: 'REJECTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 0);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 0);
  assert.equal(await countRows('family_epoch_floors', seed.familyId), 0);
  const unchangedCeremony = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(unchangedCeremony.status, 'APPROVED');
  assert.equal(unchangedCeremony.consumed_at, null);
});

test('DSK REVOCATION FIRST: a revoked exact ceremony DSK cannot commit genesis while another DSK remains active', async () => {
  const seed = await seedBootstrappableFamily({ label: 'bootstrap-revoked-dsk-before-commit' });
  const { ceremony, input } = await runCeremonyToApproved(freshService(), seed);
  const other = makeP256Device('bootstrap-other-active-dsk');
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', NOW(3), NULL)`,
    [seed.device.deviceId, other.dskKeyId, other.dskPublicKey],
  );

  const revocation = await getPool().getConnection();
  let inTransaction = false;
  try {
    await revocation.beginTransaction();
    inTransaction = true;
    const [update] = await revocation.query(
      `UPDATE device_public_keys
          SET status = 'REVOKED', revoked_at = NOW(3)
        WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK' AND status = 'ACTIVE'`,
      [seed.device.deviceId, seed.device.dskKeyId],
    );
    assert.equal(update.affectedRows, 1, 'the revocation transaction must hold the exact ceremony DSK row');

    let submissionSettled = false;
    const submission = freshService().submit(input).then(
      (result) => {
        submissionSettled = true;
        return { result };
      },
      (error) => {
        submissionSettled = true;
        return { error };
      },
    );

    // Submission validates the signed proof before the store opens its commit
    // transaction. Once it reaches the exact DSK locking read, it must wait
    // until this revocation commits.
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(submissionSettled, false, 'bootstrap commit must serialize behind exact DSK revocation');

    await revocation.commit();
    inTransaction = false;
    const outcome = await submission;
    assert.equal(outcome.error, undefined, 'revoked DSK should be a handled lifecycle rejection');
    assert.deepEqual(outcome.result, { status: 'REJECTED' });
    assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 0);
    assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 0);
    assert.equal(await countRows('family_epoch_floors', seed.familyId), 0, 'provisional floors must roll back');
    const unchangedCeremony = await ceremonyRowFor(ceremony.ceremonyId);
    assert.equal(unchangedCeremony.status, 'APPROVED');
    assert.equal(unchangedCeremony.consumed_at, null);
  } finally {
    if (inTransaction) await revocation.rollback();
    revocation.release();
  }
});

test('ELIGIBILITY FAILS CLOSED: non-provisioned family, disabled account, VIEWER membership and SUSPENDED family all refuse approval', async () => {
  const cases = [
    ['non-provisioned', { provisioned: false }],
    ['disabled-account', { accountDisabled: true }],
    ['viewer-membership', { membershipRole: 'VIEWER' }],
    ['suspended-family', { familyStatus: 'SUSPENDED' }],
  ];
  const service = makeService();
  for (const [label, overrides] of cases) {
    const seed = await seedBootstrappableFamily({ label, ...overrides });
    const issued = await service.issueChallenge({
      attemptId: seed.attemptId,
      attemptRecoveryToken: seed.rawRecoveryToken,
      dskKeyId: seed.device.dskKeyId,
      dskPublicKey: seed.device.dskPublicKey,
    });
    assert.equal(issued.status, 'PENDING', `${label}: challenge issuance itself is credential-only`);
    const approved = await service.approve({ ceremonyId: issued.ceremonyId, familyId: seed.familyId, accountId: seed.accountId });
    assert.equal(approved.status, 'NOT_ELIGIBLE', `${label} must fail closed`);
    const row = await ceremonyRowFor(issued.ceremonyId);
    assert.equal(row.status, 'PENDING', `${label}: a refused approval must not transition the ceremony`);
    assert.equal(row.approved_by_account_id, null);
  }
});

test('CROSS-FAMILY ISOLATION: independent roots, foreign approval refused, foreign ceremony unusable', async () => {
  const seedA = await seedBootstrappableFamily({ label: 'fam-a' });
  const seedB = await seedBootstrappableFamily({ label: 'fam-b' });
  const service = makeService();
  const a = await runCeremonyToApproved(service, seedA);
  const b = await runCeremonyToApproved(service, seedB);
  assert.deepEqual(await service.submit(a.input), { status: 'ACCEPTED' });
  assert.deepEqual(await service.submit(b.input), { status: 'ACCEPTED' });

  // Each family holds exactly its own root.
  assert.equal((await anchorRowFor(seedA.familyId)).genesis_device_id, seedA.device.deviceId);
  assert.equal((await anchorRowFor(seedB.familyId)).genesis_device_id, seedB.device.deviceId);

  // A foreign owner can never approve: family-scoped lookup reads as not found.
  const foreign = await service.approve({ ceremonyId: b.ceremony.ceremonyId, familyId: seedA.familyId, accountId: seedA.accountId });
  assert.equal(foreign.status, 'NOT_FOUND');

  // Cross-attempt/cross-ceremony combinations are unavailable and write nothing.
  const thirdSeed = await seedAdditionalDeviceForFamily(seedB.familyId, 'cross');
  const issuedThird = await service.issueChallenge({
    attemptId: thirdSeed.attemptId,
    attemptRecoveryToken: thirdSeed.rawRecoveryToken,
    dskKeyId: thirdSeed.device.dskKeyId,
    dskPublicKey: thirdSeed.device.dskPublicKey,
  });
  assert.equal(issuedThird.status, 'PENDING');
  const crossStatus = await service.readStatus({
    attemptId: thirdSeed.attemptId,
    attemptRecoveryToken: thirdSeed.rawRecoveryToken,
    ceremonyId: a.ceremony.ceremonyId,
  });
  assert.deepEqual(crossStatus, { status: 'UNAVAILABLE' });
});

test('DEVICE + CREDENTIAL GATES: REVOKED/ACTIVE devices, a wrong DSK claim and a wrong token can never issue a challenge', async () => {
  const service = makeService();
  for (const [label, deviceStatus] of [
    ['revoked-device', 'REVOKED'],
    ['active-device', 'ACTIVE'],
  ]) {
    const seed = await seedBootstrappableFamily({ label, deviceStatus });
    const issued = await service.issueChallenge({
      attemptId: seed.attemptId,
      attemptRecoveryToken: seed.rawRecoveryToken,
      dskKeyId: seed.device.dskKeyId,
      dskPublicKey: seed.device.dskPublicKey,
    });
    assert.deepEqual(issued, { status: 'UNAVAILABLE' }, `${label} must not be certifiable`);
  }

  const seed = await seedBootstrappableFamily({ label: 'claims' });
  const attacker = makeP256Device('claim-attacker');
  const wrongDsk = await service.issueChallenge({
    attemptId: seed.attemptId,
    attemptRecoveryToken: seed.rawRecoveryToken,
    dskKeyId: attacker.dskKeyId,
    dskPublicKey: attacker.dskPublicKey,
  });
  assert.deepEqual(wrongDsk, { status: 'UNAVAILABLE' }, 'the ceremony may only ever carry the attempt\u2019s registered DSK');
  const wrongToken = await service.issueChallenge({
    attemptId: seed.attemptId,
    attemptRecoveryToken: randomBytes(32).toString('base64url'),
    dskKeyId: seed.device.dskKeyId,
    dskPublicKey: seed.device.dskPublicKey,
  });
  assert.deepEqual(wrongToken, { status: 'UNAVAILABLE' });
  assert.equal(await countRows('family_first_device_bootstrap_ceremonies', seed.familyId), 0);
});

test('PRODUCTION ATTESTATION IS FAIL-CLOSED: an unconfigured platform lane blocks a perfect submission with zero writes; the explicit test verifier commits', async () => {
  const seed = await seedBootstrappableFamily({ label: 'attestation' });
  const failClosedService = makeService({ attestationVerifier: new FailClosedAttestationVerifier() });
  const { ceremony, input } = await runCeremonyToApproved(failClosedService, seed);

  assert.deepEqual(await failClosedService.submit(input), { status: 'REJECTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 0);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 0);
  assert.equal((await ceremonyRowFor(ceremony.ceremonyId)).status, 'APPROVED');

  // Missing evidence with the test verifier is also rejected (digest binding).
  const testService = freshService();
  assert.deepEqual(await testService.submit({ ...input, attestationEvidence: null }), { status: 'REJECTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 0);

  // Only the explicit test verifier (never wired in production) commits.
  assert.deepEqual(await freshService().submit(input), { status: 'ACCEPTED' });
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
});

test('EXPIRY: approve-after-expiry and submit-after-expiry both fail closed with nothing written', async () => {
  const service = makeService();

  // Approve path: expire the PENDING ceremony first.
  const seedA = await seedBootstrappableFamily({ label: 'expire-approve' });
  const issuedA = await service.issueChallenge({
    attemptId: seedA.attemptId,
    attemptRecoveryToken: seedA.rawRecoveryToken,
    dskKeyId: seedA.device.dskKeyId,
    dskPublicKey: seedA.device.dskPublicKey,
  });
  assert.equal(issuedA.status, 'PENDING');
  await getPool().query(
    `UPDATE family_first_device_bootstrap_ceremonies
        SET created_at = DATE_SUB(created_at, INTERVAL 11 MINUTE), expires_at = DATE_SUB(expires_at, INTERVAL 11 MINUTE)
      WHERE ceremony_id = ?`,
    [issuedA.ceremonyId],
  );
  const lateApprove = await service.approve({ ceremonyId: issuedA.ceremonyId, familyId: seedA.familyId, accountId: seedA.accountId });
  assert.equal(lateApprove.status, 'NOT_APPROVABLE');
  assert.equal((await ceremonyRowFor(issuedA.ceremonyId)).status, 'PENDING');

  // Submit path: approve in time, then expire before the submission arrives.
  const seedB = await seedBootstrappableFamily({ label: 'expire-submit' });
  const approvedB = await runCeremonyToApproved(service, seedB);
  await getPool().query(
    `UPDATE family_first_device_bootstrap_ceremonies
        SET created_at = DATE_SUB(created_at, INTERVAL 11 MINUTE), expires_at = DATE_SUB(expires_at, INTERVAL 11 MINUTE)
      WHERE ceremony_id = ?`,
    [approvedB.ceremony.ceremonyId],
  );
  assert.deepEqual(await service.submit(approvedB.input), { status: 'UNAVAILABLE' });
  assert.equal(await countRows('family_authority_genesis_anchors', seedB.familyId), 0);
  assert.equal(await countRows('family_trust_set_epochs', seedB.familyId), 0);
  const rowB = await ceremonyRowFor(approvedB.ceremony.ceremonyId);
  assert.equal(rowB.status, 'APPROVED');
  assert.equal(rowB.consumed_at, null);
});

test('0062: the step-up operation CHECK accepts family.device.bootstrap.root and still refuses an unknown operation', async () => {
  const seed = await seedBootstrappableFamily({ label: 'stepup' });
  await getPool().query(
    `INSERT INTO parent_mfa_step_up_grants (grant_id, account_id, family_id, operation, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, 'family.device.bootstrap.root', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
    [randomUUID(), seed.accountId, seed.familyId, randomBytes(32).toString('hex')],
  );
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM parent_mfa_step_up_grants WHERE family_id = ? AND operation = 'family.device.bootstrap.root'`,
    [seed.familyId],
  );
  assert.equal(rows[0].n, 1);
  await assert.rejects(
    getPool().query(
      `INSERT INTO parent_mfa_step_up_grants (grant_id, account_id, family_id, operation, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, 'family.not.an.operation', ?, NOW(3), DATE_ADD(NOW(3), INTERVAL 5 MINUTE))`,
      [randomUUID(), seed.accountId, seed.familyId, randomBytes(32).toString('hex')],
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
  );
});

/** Accepts ONLY null evidence (the literal-null binding case), echoing the expected DSK identity. */
class NullEvidenceAcceptingTestAttestationVerifier {
  async verifyFirstDeviceAttestation(input) {
    if (input.attestationEvidence !== null) return { status: 'REJECTED', reason: 'unexpected-evidence' };
    return {
      status: 'VERIFIED',
      evidenceDigest: null,
      attestedDskKeyId: input.expectedDskKeyId,
      attestedDskPublicKey: input.expectedDskPublicKey,
      attestedDskAlgorithm: input.expectedDskAlgorithm,
    };
  }
}

test('COMMITTED IDENTITY (R1-01): exact retry replays; a changed proofSignature or evidence is a different identity and can never re-enter', async () => {
  const seed = await seedBootstrappableFamily({ label: 'identity' });
  const service = makeService();
  const { ceremony, submission, input } = await runCeremonyToApproved(service, seed);
  assert.deepEqual(await service.submit(input), { status: 'ACCEPTED' });
  const committed = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(committed.payload_digest, expectedPayloadDigest(submission, TEST_EVIDENCE));

  // Restart/readback exact retry: the durable digest alone answers ACCEPTED.
  assert.deepEqual(await freshService().submit(input), { status: 'ACCEPTED' });

  // A changed proofSignature is byte-different => a different committed identity.
  const changedProofSignature = {
    ...input,
    proofSignature: `${submission.proofSignature.slice(0, -1)}${submission.proofSignature.endsWith('A') ? 'B' : 'A'}`,
  };
  assert.deepEqual(await freshService().submit(changedProofSignature), { status: 'REJECTED' });
  // Changed attestation evidence is also a different committed identity.
  assert.deepEqual(await freshService().submit({ ...input, attestationEvidence: `${TEST_EVIDENCE}!` }), { status: 'REJECTED' });

  // The rejections may not change any durable state.
  const after = await ceremonyRowFor(ceremony.ceremonyId);
  assert.equal(after.payload_digest, committed.payload_digest);
  assert.equal(await countRows('family_authority_genesis_anchors', seed.familyId), 1);
  assert.equal(await countRows('family_trust_set_epochs', seed.familyId), 1);
});

test('R1-03 AUDIT RECONSTRUCTION: the exact canonical proof is reconstructible and re-verifiable from durable non-secret state alone', async () => {
  const seed = await seedBootstrappableFamily({ label: 'audit' });
  const service = makeService();
  const { ceremony, submission, input } = await runCeremonyToApproved(service, seed);
  assert.deepEqual(await service.submit(input), { status: 'ACCEPTED' });

  const [rows] = await getPool().query(
    `SELECT ceremony_id, family_id, device_id, dsk_key_id, dsk_public_key, challenge_id, nonce, expires_at,
            bootstrap_proof_sha256, attestation_evidence_sha256
       FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ?`,
    [ceremony.ceremonyId],
  );
  const row = rows[0];
  const anchor = await anchorRowFor(seed.familyId);
  const epochs = await epochRowsFor(seed.familyId);
  const epochBytes = Buffer.from(epochs[0].signed_epoch_bytes);

  // Every input of the 13-field canonical statement comes from durable state alone.
  const rebuiltFields = {
    familyId: row.family_id,
    deviceId: row.device_id,
    ceremonyId: row.ceremony_id,
    challengeId: row.challenge_id,
    nonce: row.nonce,
    expiresAt: new Date(row.expires_at),
    dskKeyId: row.dsk_key_id,
    dskPublicKey: row.dsk_public_key,
    epoch1Sha256Hex: sha256Hex(epochBytes),
    attestationEvidenceDigest: row.attestation_evidence_sha256,
  };
  const rebuilt = canonicalizeFirstDeviceBootstrapProof(rebuiltFields);

  assert.equal(rebuilt, submission.proofBytes, 'the durable reconstruction is byte-identical to the signed statement');
  assert.equal(sha256Hex(rebuilt), row.bootstrap_proof_sha256, 'the stored proof sha binds the exact canonical bytes');
  assert.equal(row.bootstrap_proof_sha256, sha256Hex(submission.proofBytes));
  assert.equal(row.attestation_evidence_sha256, sha256Hex(TEST_EVIDENCE), 'the evidence digest field is durably recoverable');
  assert.equal(
    verifyFirstDeviceBootstrapProofSignature(anchor.genesis_dsk_public_key, rebuilt, anchor.signature),
    true,
    'the anchor proof signature re-verifies over the reconstructed canonical statement',
  );
  assert.equal(anchor.signature_scheme, ANCHOR_SIGNATURE_SCHEME_FIRST_DEVICE);

  // Tamper detection: any changed signed field fails re-verification against durable state.
  const tampered = canonicalizeFirstDeviceBootstrapProof({ ...rebuiltFields, nonce: 'Z'.repeat(43) });
  assert.notEqual(sha256Hex(tampered), row.bootstrap_proof_sha256);
  assert.equal(verifyFirstDeviceBootstrapProofSignature(anchor.genesis_dsk_public_key, tampered, anchor.signature), false);
});

test('R1-03 EVIDENCE VARIANTS: null evidence keeps the digest column NULL (literal null marker); empty evidence binds sha256(\'\')', async () => {
  // null evidence: the proof binds the literal 'null'; the digest column stays NULL.
  const nullService = makeService({ attestationVerifier: new NullEvidenceAcceptingTestAttestationVerifier() });
  const seedNull = await seedBootstrappableFamily({ label: 'audit-null' });
  const nullRun = await runCeremonyToApproved(nullService, seedNull, null);
  assert.deepEqual(await nullService.submit(nullRun.input), { status: 'ACCEPTED' });
  const nullRow = await ceremonyRowFor(nullRun.ceremony.ceremonyId);
  assert.equal(nullRow.attestation_evidence_sha256, null, 'null evidence commits keep the evidence digest column NULL');
  assert.equal(nullRow.bootstrap_proof_sha256, sha256Hex(nullRun.submission.proofBytes));

  // empty-string evidence: a REAL digest (sha256 of empty) -- never conflated with NULL.
  const emptyService = makeService();
  const seedEmpty = await seedBootstrappableFamily({ label: 'audit-empty' });
  const emptyRun = await runCeremonyToApproved(emptyService, seedEmpty, '');
  assert.deepEqual(await emptyService.submit(emptyRun.input), { status: 'ACCEPTED' });
  const emptyRow = await ceremonyRowFor(emptyRun.ceremony.ceremonyId);
  assert.equal(emptyRow.attestation_evidence_sha256, sha256Hex(''));
  assert.notEqual(emptyRow.attestation_evidence_sha256, null);
});

test.after(async () => {
  await closePool();
});
