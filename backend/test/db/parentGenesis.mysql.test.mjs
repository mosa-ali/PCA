import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign as nodeSign } from 'node:crypto';
import test from 'node:test';
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';
import { P256DeviceSignatureVerifier, canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeGenesisProof } from '../../dist/parentaccount/genesisProtocol.js';
import { canonicalizeGenesisAnchor, canonicalizeOwnerAttestation } from '../../dist/familycommercial/authority/canonicalize.js';
import { createTestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { createDisposableGenesisParentAccountService } from '../../scripts/lib/completeFamilyGenesis.mjs';

// REAL-MYSQL GENESIS PROOF (PCA-DEC-020-R1 ceremony with the P-256 verifier).
// Drives the SAME ParentAccountService -> ParentGenesisService ->
// MySqlGenesisTransactionRepository path the HTTP routes drive, against the
// disposable InnoDB database, with genuine P-256 signatures. Claims about
// atomicity, single-winner completion, replay and rollback are therefore made
// against real row locks and real unique constraints, not mocks.

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const PASSWORD = 'a genuinely long password for genesis';

function clock(start = new Date()) {
  const state = { now: start };
  return { now: () => state.now, set: (d) => { state.now = d; } };
}

function newDeviceKey() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { privateKey: pair.privateKey, publicKey };
}

function signCanonical(privateKey, message) {
  return canonicalizeP256Signature(nodeSign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
}

/** Builds the signed completion exactly as the browser ceremony does. */
function signedCompletion(challenge, privateKey, now) {
  const proof = {
    protocolVersion: challenge.protocolVersion, operation: challenge.operation, accountId: challenge.accountId,
    serviceAccountId: challenge.serviceAccountId, familyId: challenge.familyId, deviceId: challenge.candidateDeviceId,
    keyId: challenge.candidateKeyId, publicKey: challenge.candidatePublicKey, challengeId: challenge.challengeId,
    nonce: challenge.nonce, createdAt: challenge.createdAt, expiresAt: challenge.expiresAt,
  };
  const anchor = {
    familyId: challenge.familyId, genesisDeviceId: challenge.candidateDeviceId, genesisDskKeyId: challenge.candidateKeyId,
    genesisDskPublicKey: challenge.candidatePublicKey, protocolVersion: 1, createdAt: challenge.createdAt,
  };
  const issuedAt = now;
  const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000);
  const attestation = {
    familyId: challenge.familyId, purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1', attestationRevision: 1,
    ownerDeviceId: challenge.candidateDeviceId, ownerDskKeyId: challenge.candidateKeyId, ownerDskPublicKey: challenge.candidatePublicKey,
    trustSetEpoch: 1, keyEpoch: 1, issuedAt, expiresAt, previousAttestationId: null,
    signerDeviceId: challenge.candidateDeviceId, signerDskKeyId: challenge.candidateKeyId, signerDskPublicKey: challenge.candidatePublicKey,
  };
  return {
    challengeId: challenge.challengeId,
    proofSignature: signCanonical(privateKey, canonicalizeGenesisProof(proof)),
    anchorSignature: signCanonical(privateKey, canonicalizeGenesisAnchor(anchor)),
    attestationSignature: signCanonical(privateKey, canonicalizeOwnerAttestation(attestation)),
    trustSetEpoch: 1, keyEpoch: 1, issuedAt, expiresAt,
  };
}

/** register -> verify email -> authenticated pre-family session, all through the real service. */
async function verifiedParent(t = clock()) {
  const emailSender = createTestSandboxEmailSender();
  const service = createDisposableGenesisParentAccountService({ emailSender, verifier: new P256DeviceSignatureVerifier(), now: t.now });
  const email = `genesis-${randomUUID()}@example.com`;
  await service.register(email, PASSWORD, PASSWORD);
  const verified = await service.verifyEmail(email, emailSender.lastCodeFor(email, 'VERIFICATION'));
  return { service, emailSender, email, accountId: verified.accountId, session: verified.rawSessionToken, clock: t };
}

async function stepUp(parent) {
  await parent.service.requestGenesisStepUp(parent.session, parent.email, PASSWORD);
  await parent.service.completeGenesisStepUp(parent.session, parent.emailSender.lastCodeFor(parent.email, 'GENESIS_STEP_UP'));
}

async function rowCount(sql, params) {
  const { rows } = await runInTransaction((conn) => execute(conn, sql, params));
  return Number(rows[0].n);
}

async function familyStateFor(accountId) {
  const { rows } = await runInTransaction((conn) => execute(conn, `SELECT family_id FROM parent_accounts WHERE account_id = ?`, [accountId]));
  return rows[0]?.family_id ?? null;
}

test.after(async () => {
  await closePool();
});

test('MySQL GENESIS: a verified parent completes the real ceremony -> family, trusted device, ADMINISTRATOR, anchor, head; session becomes FAMILY_READY', async () => {
  const parent = await verifiedParent();
  const before = await parent.service.readSession(parent.session);
  assert.equal(before.familyId, null);
  assert.equal(before.role, null);

  await stepUp(parent);
  const key = newDeviceKey();
  const challenge = await parent.service.beginGenesisChallenge(parent.session, { publicKey: key.publicKey, platform: 'BROWSER' });
  const result = await parent.service.completeGenesis(parent.session, signedCompletion(challenge, key.privateKey, parent.clock.now()));
  assert.equal(result.familyId, challenge.familyId);

  const after = await parent.service.readSession(parent.session);
  assert.equal(after.familyId, challenge.familyId, 'session must report the real family');
  assert.equal(after.role, 'ADMINISTRATOR', 'the genesis parent holds the ADMINISTRATOR membership role');

  const fid = challenge.familyId;
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM families WHERE family_id = ?`, [fid]), 1);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ? AND device_id = ? AND status = 'ACTIVE' AND registered_by_account_id = ?`, [fid, challenge.candidateDeviceId, challenge.serviceAccountId]), 1);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM device_public_keys WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK' AND status = 'ACTIVE' AND public_key = ?`, [challenge.candidateDeviceId, challenge.candidateKeyId, key.publicKey]), 1);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_parent_memberships WHERE family_id = ? AND account_id = ? AND role = 'ADMINISTRATOR' AND status = 'ACTIVE'`, [fid, parent.accountId]), 1);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_authority_genesis_anchors WHERE family_id = ? AND genesis_device_id = ?`, [fid, challenge.candidateDeviceId]), 1);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_authority_chain_heads WHERE family_id = ? AND head_revision = 1 AND status = 'ACTIVE'`, [fid]), 1);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM parent_genesis_challenges WHERE challenge_id = ? AND consumed_at IS NOT NULL`, [challenge.challengeId]), 1);
});

test('MySQL GENESIS REPLAY: re-submitting a completed ceremony is refused and creates nothing', async () => {
  const parent = await verifiedParent();
  await stepUp(parent);
  const key = newDeviceKey();
  const challenge = await parent.service.beginGenesisChallenge(parent.session, { publicKey: key.publicKey, platform: 'BROWSER' });
  const completion = signedCompletion(challenge, key.privateKey, parent.clock.now());
  await parent.service.completeGenesis(parent.session, completion);
  await assert.rejects(() => parent.service.completeGenesis(parent.session, completion));
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_parent_memberships WHERE account_id = ?`, [parent.accountId]), 1);
  // And no second ceremony can even start for an account that owns a family.
  await assert.rejects(() => parent.service.requestGenesisStepUp(parent.session, parent.email, PASSWORD));
});

test('MySQL GENESIS CONCURRENCY: two genuinely signed completions for the same account race -> exactly one family; the loser rolls back completely', async () => {
  const parent = await verifiedParent();
  await stepUp(parent);
  const keyA = newDeviceKey();
  const keyB = newDeviceKey();
  const challengeA = await parent.service.beginGenesisChallenge(parent.session, { publicKey: keyA.publicKey, platform: 'BROWSER' });
  const challengeB = await parent.service.beginGenesisChallenge(parent.session, { publicKey: keyB.publicKey, platform: 'BROWSER' });
  const now = parent.clock.now();
  const results = await Promise.allSettled([
    parent.service.completeGenesis(parent.session, signedCompletion(challengeA, keyA.privateKey, now)),
    parent.service.completeGenesis(parent.session, signedCompletion(challengeB, keyB.privateKey, now)),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, `exactly one completion may win (got ${results.map((r) => r.status).join(',')})`);
  const winner = fulfilled[0].value.familyId;
  const loser = winner === challengeA.familyId ? challengeB : challengeA;
  assert.equal(await familyStateFor(parent.accountId), winner);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_parent_memberships WHERE account_id = ?`, [parent.accountId]), 1);
  // Nothing of the loser's ceremony survived: no family, device, key, anchor, head; its challenge is unconsumed.
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM families WHERE family_id = ?`, [loser.familyId]), 0);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM devices WHERE device_id = ?`, [loser.candidateDeviceId]), 0);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM device_public_keys WHERE device_id = ?`, [loser.candidateDeviceId]), 0);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_authority_genesis_anchors WHERE family_id = ?`, [loser.familyId]), 0);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM family_authority_chain_heads WHERE family_id = ?`, [loser.familyId]), 0);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM parent_genesis_challenges WHERE challenge_id = ? AND consumed_at IS NULL`, [loser.challengeId]), 1);
});

test('MySQL GENESIS: wrong signer, wrong key and malformed proof are refused with no rows written', async () => {
  const parent = await verifiedParent();
  await stepUp(parent);
  const key = newDeviceKey();
  const attacker = newDeviceKey();
  const challenge = await parent.service.beginGenesisChallenge(parent.session, { publicKey: key.publicKey, platform: 'BROWSER' });
  const now = parent.clock.now();
  // Signed by a key the challenge was not issued for.
  await assert.rejects(() => parent.service.completeGenesis(parent.session, signedCompletion(challenge, attacker.privateKey, now)));
  // Genuine proof, forged anchor.
  const genuine = signedCompletion(challenge, key.privateKey, now);
  await assert.rejects(() => parent.service.completeGenesis(parent.session, { ...genuine, anchorSignature: signedCompletion(challenge, attacker.privateKey, now).anchorSignature }));
  // Malformed signature bytes.
  await assert.rejects(() => parent.service.completeGenesis(parent.session, { ...genuine, proofSignature: 'AAAA' }));
  assert.equal(await familyStateFor(parent.accountId), null);
  assert.equal(await rowCount(`SELECT COUNT(*) AS n FROM families WHERE family_id = ?`, [challenge.familyId]), 0);
  // The genuine completion still succeeds afterwards: refusals consumed nothing.
  await parent.service.completeGenesis(parent.session, genuine);
  assert.equal(await familyStateFor(parent.accountId), challenge.familyId);
});

test('MySQL GENESIS: another parent’s session cannot complete this parent’s challenge, even with the genuine signatures', async () => {
  const parentA = await verifiedParent();
  const parentB = await verifiedParent();
  await stepUp(parentA);
  await stepUp(parentB);
  const key = newDeviceKey();
  const challenge = await parentA.service.beginGenesisChallenge(parentA.session, { publicKey: key.publicKey, platform: 'BROWSER' });
  const completion = signedCompletion(challenge, key.privateKey, parentA.clock.now());
  await assert.rejects(() => parentB.service.completeGenesis(parentB.session, completion));
  assert.equal(await familyStateFor(parentB.accountId), null);
  assert.equal(await familyStateFor(parentA.accountId), null);
  // A still completes its own.
  await parentA.service.completeGenesis(parentA.session, completion);
  assert.equal(await familyStateFor(parentA.accountId), challenge.familyId);
  assert.equal(await familyStateFor(parentB.accountId), null);
});

test('MySQL GENESIS EXPIRY: a challenge is accepted before its expiry and refused after it', async () => {
  const t = clock(new Date());
  const parent = await verifiedParent(t);
  await stepUp(parent);
  const key = newDeviceKey();
  const challenge = await parent.service.beginGenesisChallenge(parent.session, { publicKey: key.publicKey, platform: 'BROWSER' });
  // Exactly at expiry the challenge is already dead (expires_at > now is required).
  t.set(new Date(challenge.expiresAt.getTime()));
  await assert.rejects(() => parent.service.completeGenesis(parent.session, signedCompletion(challenge, key.privateKey, t.now())));
  t.set(new Date(challenge.expiresAt.getTime() + 1));
  await assert.rejects(() => parent.service.completeGenesis(parent.session, signedCompletion(challenge, key.privateKey, t.now())));
  assert.equal(await familyStateFor(parent.accountId), null);
});
