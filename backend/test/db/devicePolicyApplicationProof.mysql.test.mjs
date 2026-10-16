import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, sign as cryptoSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { canonicalizeDevicePolicyApplicationProof } from '../../dist/devicepolicyproof/protocol.js';
import { MySqlDevicePolicyApplicationProofStore } from '../../dist/devicepolicyproof/MySqlDevicePolicyApplicationProofStore.js';
import { MySqlDevicePolicyProofRetention } from '../../dist/devicepolicyproof/MySqlDevicePolicyProofRetention.js';

if (!process.env.PCA_DATABASE_URL || process.env.PCA_DISPOSABLE_TEST_DATABASE_OWNER !== 'with-disposable-db') {
  throw new Error('PCA_DATABASE_URL and the owned disposable DB wrapper are required.');
}

function publicPoint(key) {
  const jwk = key.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
}

function stamp() { return new Date(Date.now() - 1000); }

async function seedTarget(result = 'APPLIED') {
  const pool = getPool();
  const familyId = randomUUID(); const deviceId = randomUUID(); const keyId = randomUUID();
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const dskPublicKey = publicPoint(keyPair.publicKey);
  const now = stamp();
  const challengeId = randomUUID();
  const nonce = randomBytes(32).toString('base64url');
  const envelopeBytes = Buffer.from(`synthetic-ciphertext-${randomUUID()}`);
  const envelopeDigest = createHash('sha256').update(envelopeBytes).digest();
  const challengeExpiresAt = new Date(Date.now() + 60_000);
  const epoch = canonicalizeTrustSetEpoch({
    familyId, trustSetEpoch: 1, keyEpoch: 1,
    entries: [{ deviceId, role: 'OWNER', dskKeyId: keyId, dskPublicKey,
      dekKeyId: randomUUID(), dekPublicKey: randomBytes(32).toString('base64url'), status: 'ACTIVE' }],
    issuedAt: now, supersedesEpoch: null,
  });
  await pool.query(`INSERT INTO families (family_id, family_reference_hash, status, created_at)
    VALUES (?, ?, 'ACTIVE', ?)`, [familyId, randomBytes(32), now]);
  await pool.query(`INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at)
    VALUES (?, ?, 'ANDROID', 'PAIRED', ?, NULL)`, [deviceId, familyId, now]);
  await pool.query(`INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
    VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`, [deviceId, keyId, dskPublicKey, now]);
  await pool.query(`INSERT INTO family_epoch_floors (family_id, minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch, updated_at)
    VALUES (?, 1, 1, ?)`, [familyId, now]);
  await pool.query(`INSERT INTO family_trust_set_epochs
    (family_id, trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id, issued_at, received_at)
    VALUES (?, 1, 1, NULL, ?, ?, ?, ?, ?, ?)`, [familyId, Buffer.from(epoch), 'synthetic-test-signature', keyId, deviceId, now, now]);
  await pool.query(`INSERT INTO device_policy_activation_targets
    (device_id, family_id, target_generation, policy_message_id, policy_envelope_sha256, policy_envelope_expires_at,
     canonical_envelope_bytes, envelope_signature, trust_set_epoch, key_epoch, target_state,
     bootstrap_capability_hash, bootstrap_capability_expires_at, bootstrap_capability_consumed_at,
     challenge_id, challenge_nonce_hash, challenge_expires_at, challenge_consumed_at, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1, 1, 'PENDING', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  [deviceId, familyId, `policy-${randomUUID()}`, envelopeDigest, new Date(Date.now() + 120_000), envelopeBytes,
    Buffer.alloc(64, 1), createHash('sha256').update(randomBytes(32)).digest(), challengeExpiresAt, now,
    challengeId, createHash('sha256').update(Buffer.from(nonce, 'base64url')).digest(), challengeExpiresAt, now, now]);
  const transcript = {
    familyId, deviceId,
    policyEnvelopeMessageId: (await pool.query('SELECT policy_message_id FROM device_policy_activation_targets WHERE device_id = ?', [deviceId]))[0][0].policy_message_id,
    policyEnvelopeSha256: envelopeDigest.toString('base64url'), trustSetEpoch: 1, keyEpoch: 1,
    applicationResult: result, challengeId, challengeNonce: nonce, challengeExpiresAt: challengeExpiresAt.toISOString(),
  };
  const transcriptBytes = canonicalizeDevicePolicyApplicationProof(transcript);
  const signature = canonicalizeP256Signature(cryptoSign('sha256', transcriptBytes, { key: keyPair.privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
  const input = {
    transcript, challengeNonceBytes: Buffer.from(nonce, 'base64url'), deviceKeyId: keyId, dskPublicKey,
    transcriptSha256: createHash('sha256').update(transcriptBytes).digest(),
    exactRequestSha256: createHash('sha256').update(transcriptBytes).update(Buffer.from(signature, 'base64url')).digest(),
  };
  return { familyId, deviceId, keyId, keyPair, dskPublicKey, transcript, signature, input };
}

test('MySQL 0066 commit activates only APPLIED; exact retry is idempotent and conflict rejects', async () => {
  const fixture = await seedTarget('APPLIED');
  const store = new MySqlDevicePolicyApplicationProofStore(() => true);
  const first = await store.commitVerifiedProof(fixture.input);
  assert.deepEqual(first, { outcome: 'ACTIVATED', idempotent: false });
  const [deviceRows] = await getPool().query('SELECT status, activated_at FROM devices WHERE device_id = ?', [fixture.deviceId]);
  assert.equal(deviceRows[0].status, 'ACTIVE');
  assert.ok(deviceRows[0].activated_at);
  const exactRetry = await store.commitVerifiedProof(fixture.input);
  assert.deepEqual(exactRetry, { outcome: 'ACTIVATED', idempotent: true });
  const conflicting = await store.commitVerifiedProof({ ...fixture.input, exactRequestSha256: Buffer.alloc(32, 99) });
  assert.deepEqual(conflicting, { outcome: 'CONFLICT' });
});

test('MySQL 0066 DEGRADED/REJECTED records do not activate and concurrent exact proofs resolve once', async () => {
  for (const result of ['DEGRADED', 'REJECTED']) {
    const fixture = await seedTarget(result);
    const store = new MySqlDevicePolicyApplicationProofStore(() => true);
    const [left, right] = await Promise.all([store.commitVerifiedProof(fixture.input), store.commitVerifiedProof(fixture.input)]);
    assert.deepEqual([left.outcome, right.outcome].sort(), ['RECORDED_NOT_ACTIVATED', 'RECORDED_NOT_ACTIVATED']);
    assert.equal([left, right].filter((item) => item.idempotent === false).length, 1);
    const [rows] = await getPool().query('SELECT status, activated_at FROM devices WHERE device_id = ?', [fixture.deviceId]);
    assert.equal(rows[0].status, 'PAIRED');
    assert.equal(rows[0].activated_at, null);
  }
});

test('MySQL 0066 commit rechecks family, device, Trust Set floor and target at commit time', async () => {
  for (const mutate of [
    async (f) => getPool().query("UPDATE devices SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3) WHERE device_id = ?", [f.deviceId]),
    async (f) => getPool().query("UPDATE device_public_keys SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3) WHERE device_id = ? AND key_id = ?", [f.deviceId, f.keyId]),
    async (f) => getPool().query('UPDATE family_epoch_floors SET minimum_accepted_trust_set_epoch = 2 WHERE family_id = ?', [f.familyId]),
    async (f) => getPool().query('UPDATE family_trust_set_epochs SET trust_set_epoch = 2, key_epoch = 2 WHERE family_id = ? AND trust_set_epoch = 1', [f.familyId]),
    async (f) => getPool().query('UPDATE family_trust_set_epochs SET key_epoch = 2 WHERE family_id = ? AND trust_set_epoch = 1', [f.familyId]),
    async (f) => getPool().query("UPDATE device_policy_activation_targets SET target_generation = 2, policy_message_id = 'replacement-target' WHERE device_id = ?", [f.deviceId]),
    async (f) => getPool().query('UPDATE device_policy_activation_targets SET challenge_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE device_id = ?', [f.deviceId]),
    async (f) => getPool().query('UPDATE families SET deleted_at = UTC_TIMESTAMP(3) WHERE family_id = ?', [f.familyId]),
  ]) {
    const fixture = await seedTarget('APPLIED');
    const store = new MySqlDevicePolicyApplicationProofStore(() => true);
    const racedVerifier = { async verify() { await mutate(fixture); return true; } };
    const result = await store.submitSignedProof(fixture.transcript, fixture.signature, racedVerifier);
    assert.deepEqual(result, { outcome: 'REJECTED' });
    const [devices] = await getPool().query('SELECT status FROM devices WHERE device_id = ?', [fixture.deviceId]);
    assert.notEqual(devices[0].status, 'ACTIVE');
    const [proofs] = await getPool().query('SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?', [fixture.transcript.challengeId]);
    assert.equal(proofs.length, 0);
  }
});

test('MySQL 0066 rejects a proof when the DSK is revoked while its signature is being verified', async () => {
  const fixture = await seedTarget('APPLIED');
  const racedVerifier = { async verify() {
    await getPool().query("UPDATE device_public_keys SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(3) WHERE device_id = ? AND key_id = ?", [fixture.deviceId, fixture.keyId]);
    return true;
  } };
  const result = await new MySqlDevicePolicyApplicationProofStore(() => true)
    .submitSignedProof(fixture.transcript, fixture.signature, racedVerifier);
  assert.deepEqual(result, { outcome: 'REJECTED' });
  const [devices] = await getPool().query('SELECT status FROM devices WHERE device_id = ?', [fixture.deviceId]);
  assert.equal(devices[0].status, 'PAIRED');
  const [proofs] = await getPool().query('SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?', [fixture.transcript.challengeId]);
  assert.equal(proofs.length, 0);
});

test('MySQL 0066 concurrent distinct valid signatures on one challenge activate once and reject the conflicting replay', async () => {
  const fixture = await seedTarget('APPLIED');
  const secondSignature = canonicalizeP256Signature(cryptoSign('sha256', canonicalizeDevicePolicyApplicationProof(fixture.transcript),
    { key: fixture.keyPair.privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
  assert.notEqual(secondSignature, fixture.signature);
  const store = new MySqlDevicePolicyApplicationProofStore(() => true);
  const [first, second] = await Promise.all([
    store.submitSignedProof(fixture.transcript, fixture.signature, { async verify() { return true; } }),
    store.submitSignedProof(fixture.transcript, secondSignature, { async verify() { return true; } }),
  ]);
  assert.deepEqual([first.outcome, second.outcome].sort(), ['ACTIVATED', 'CONFLICT']);
  const [devices] = await getPool().query('SELECT status FROM devices WHERE device_id = ?', [fixture.deviceId]);
  assert.equal(devices[0].status, 'ACTIVE');
  const [proofs] = await getPool().query('SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?', [fixture.transcript.challengeId]);
  assert.equal(proofs.length, 1);
});

test('MySQL 0066 transition failure rolls back proof insert and ACTIVE update atomically', async () => {
  const fixture = await seedTarget('APPLIED');
  const trigger = `pca_test_fail_policy_target_${randomUUID().replaceAll('-', '')}`;
  await getPool().query(`CREATE TRIGGER \`${trigger}\` BEFORE UPDATE ON device_policy_activation_targets FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test_forced_target_failure'`);
  try {
    await assert.rejects(() => new MySqlDevicePolicyApplicationProofStore(() => true).commitVerifiedProof(fixture.input));
    const [devices] = await getPool().query('SELECT status, activated_at FROM devices WHERE device_id = ?', [fixture.deviceId]);
    assert.equal(devices[0].status, 'PAIRED');
    assert.equal(devices[0].activated_at, null);
    const [proofs] = await getPool().query('SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?', [fixture.transcript.challengeId]);
    assert.equal(proofs.length, 0);
  } finally {
    await getPool().query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
});

test('MySQL production default rejects APPLIED activation until receiver crypto is approved and composed', async () => {
  const fixture = await seedTarget('APPLIED');
  const result = await new MySqlDevicePolicyApplicationProofStore().commitVerifiedProof(fixture.input);
  assert.deepEqual(result, { outcome: 'REJECTED' });
  const [devices] = await getPool().query('SELECT status, activated_at FROM devices WHERE device_id = ?', [fixture.deviceId]);
  assert.equal(devices[0].status, 'PAIRED');
  assert.equal(devices[0].activated_at, null);
  const [proofs] = await getPool().query('SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?', [fixture.transcript.challengeId]);
  assert.equal(proofs.length, 0);
});

test('MySQL 0066 proof retention prunes only expired tombstones through the bounded procedure and preserves activation fact', async () => {
  const fixture = await seedTarget('APPLIED');
  const currentFixture = await seedTarget('DEGRADED');
  const trigger = `pca_test_age_policy_proof_${randomUUID().replaceAll('-', '')}`;
  await getPool().query(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON device_policy_application_proofs FOR EACH ROW
    BEGIN
      IF NEW.challenge_id = '${fixture.transcript.challengeId}' THEN
        SET NEW.committed_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 DAY),
            NEW.retention_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND);
      END IF;
    END`);
  try {
    const store = new MySqlDevicePolicyApplicationProofStore(() => true);
    assert.deepEqual(await store.commitVerifiedProof(fixture.input), { outcome: 'ACTIVATED', idempotent: false });
    assert.deepEqual(await store.commitVerifiedProof(currentFixture.input), { outcome: 'RECORDED_NOT_ACTIVATED', idempotent: false });
    const retention = new MySqlDevicePolicyProofRetention();
    const connection = await getPool().getConnection();
    try {
      await assert.rejects(() => retention.pruneExpiredTombstones(connection, 0), RangeError);
      assert.equal(await retention.pruneExpiredTombstones(connection, 1), 1);
    } finally { connection.release(); }
    const [proofs] = await getPool().query(
      'SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?',
      [fixture.transcript.challengeId],
    );
    assert.equal(proofs.length, 0);
    const [currentProofs] = await getPool().query(
      'SELECT challenge_id FROM device_policy_application_proofs WHERE challenge_id = ?',
      [currentFixture.transcript.challengeId],
    );
    assert.equal(currentProofs.length, 1, 'unexpired proof tombstones are retained');
    const [devices] = await getPool().query('SELECT status, activated_at FROM devices WHERE device_id = ?', [fixture.deviceId]);
    assert.equal(devices[0].status, 'ACTIVE');
    assert.ok(devices[0].activated_at, 'the durable lifecycle fact survives tombstone pruning');
    assert.deepEqual(await store.commitVerifiedProof(fixture.input), { outcome: 'REJECTED' });
  } finally {
    await getPool().query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
});

test.after(async () => closePool());
