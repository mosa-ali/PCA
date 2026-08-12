import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { MySqlEnrollmentCoordinatorRepository } from '../../dist/enrollment/MySqlEnrollmentCoordinatorRepository.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { MySqlInvitationRepository } from '../../dist/invitation/MySqlInvitationRepository.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const enrollmentRepository = new MySqlEnrollmentCoordinatorRepository();
const invitationRepository = new MySqlInvitationRepository();
const deviceRepository = new MySqlDeviceRepository();

function buildCoordinator(now = () => new Date()) {
  return new EnrollmentCoordinator(enrollmentRepository, now);
}

function key() {
  return randomBytes(32).toString('base64url');
}

function attemptId() {
  return randomBytes(24).toString('base64url');
}

function recoveryToken() {
  return randomBytes(32).toString('base64url');
}

function deviceKeysInput(overrides = {}) {
  return {
    platform: 'ANDROID',
    signingPublicKey: key(),
    encryptionPublicKey: key(),
    attemptId: attemptId(),
    attemptRecoveryToken: recoveryToken(),
    ...overrides,
  };
}

async function createInvitation(overrides = {}) {
  const invitationService = new InvitationService(invitationRepository);
  return invitationService.createInvitation({
    familyId: `family-${randomUUID()}`,
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
    ...overrides,
  });
}

test('MySQL: successful enrollment creates a PAIRING_PENDING device with DSK+DEK and redeems the invitation, all visible after commit', async () => {
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();
  const result = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() });

  assert.equal(result.familyId, record.familyId);
  assert.equal(result.invitationId, record.invitationId);
  assert.equal(result.status, 'PAIRING_PENDING');
  assert.notEqual(result.signingKeyId, result.encryptionKeyId);

  const device = await deviceRepository.findDeviceForFamily(record.familyId, result.deviceId);
  assert.equal(device.status, 'PAIRING_PENDING');
  const keys = await deviceRepository.findKeysByDeviceForFamily(record.familyId, result.deviceId);
  assert.equal(keys.length, 2);
  const dsk = keys.find((k) => k.keyPurpose === 'DSK');
  const dek = keys.find((k) => k.keyPurpose === 'DEK');
  assert.ok(dsk);
  assert.ok(dek);
  assert.equal(dsk.keyId, result.signingKeyId);
  assert.equal(dek.keyId, result.encryptionKeyId);

  const [rows] = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = ?`, [record.invitationId]);
  assert.equal(rows[0].status, 'REDEEMED');

  const [attemptRows] = await getPool().query(`SELECT device_id, status FROM enrollment_bootstrap_attempts WHERE device_id = ?`, [result.deviceId]);
  assert.equal(attemptRows.length, 1, 'exactly one bootstrap-attempt row must be persisted atomically with the device it created');
  assert.equal(attemptRows[0].status, 'COMPLETED');
});

test('MySQL: identical signing and encryption keys rejected', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  const sharedKey = key();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput({ signingPublicKey: sharedKey, encryptionPublicKey: sharedKey }) }),
    { code: 'KEYS_NOT_DISTINCT' },
  );
});

test('MySQL: already-redeemed invitation rejected with a NEW attempt id, no second device created', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  const first = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'ALREADY_REDEEMED' },
  );
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = (SELECT family_id FROM devices WHERE device_id = ?)`, [first.deviceId]);
  assert.equal(rows[0].n, 1);
});

test('MySQL: expired invitation rejected, no device created', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation({ ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'EXPIRED' },
  );
});

test('MySQL: revoked invitation rejected, no device created', async () => {
  const invitationService = new InvitationService(invitationRepository);
  const { rawToken, record } = await createInvitation();
  await invitationService.revokeInvitation(record.invitationId);
  const coordinator = buildCoordinator();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'REVOKED' },
  );
});

test('MySQL: platform mismatch rejected, invitation remains usable afterward', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation({ platform: 'ANDROID' });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput({ platform: 'IOS' }) }),
    { code: 'PLATFORM_MISMATCH' },
  );
  const result = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput({ platform: 'ANDROID' }) });
  assert.ok(result.deviceId);
});

test('MySQL FAILURE INJECTION: duplicate public key (DSK or DEK) aborts the WHOLE transaction -- no orphan device, invitation stays unredeemed, no attempt row', async () => {
  const coordinator = buildCoordinator();
  const sharedKey = key();
  const first = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: first.rawToken, ...deviceKeysInput({ signingPublicKey: sharedKey }) });

  const second = await createInvitation();
  const secondAttemptId = attemptId();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput({ attemptId: secondAttemptId, encryptionPublicKey: sharedKey }) }),
    { code: 'DUPLICATE_KEY' },
  );

  // Invitation must NOT be consumed by the failed attempt.
  const [invitationRows] = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = ?`, [second.record.invitationId]);
  assert.equal(invitationRows[0].status, 'CREATED');

  // No device row for the failed attempt's family (proves the DSK insert's
  // success didn't survive the DEK insert's failure -- both rows of the
  // single multi-row INSERT statement are atomic together).
  const [deviceRows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [second.record.familyId]);
  assert.equal(deviceRows[0].n, 0, 'no orphan device may survive a rolled-back enrollment transaction');

  const [attemptRows] = await getPool().query(`SELECT COUNT(*) AS n FROM enrollment_bootstrap_attempts WHERE attempt_id = ?`, [secondAttemptId]);
  assert.equal(attemptRows[0].n, 0, 'no orphan attempt row may survive a rolled-back enrollment transaction');

  // The invitation can still be redeemed with fresh keys.
  const retry = await coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput() });
  assert.ok(retry.deviceId);
});

test('MySQL FAILURE INJECTION: duplicate DSK specifically rolls back the device insert too', async () => {
  const coordinator = buildCoordinator();
  const sharedSigningKey = key();
  const first = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: first.rawToken, ...deviceKeysInput({ signingPublicKey: sharedSigningKey }) });

  const second = await createInvitation();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput({ signingPublicKey: sharedSigningKey }) }),
    { code: 'DUPLICATE_KEY' },
  );
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [second.record.familyId]);
  assert.equal(rows[0].n, 0);
});

test('MySQL FAILURE INJECTION: duplicate DEK specifically rolls back the device insert too', async () => {
  const coordinator = buildCoordinator();
  const sharedEncryptionKey = key();
  const first = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: first.rawToken, ...deviceKeysInput({ encryptionPublicKey: sharedEncryptionKey }) });

  const second = await createInvitation();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput({ encryptionPublicKey: sharedEncryptionKey }) }),
    { code: 'DUPLICATE_KEY' },
  );
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [second.record.familyId]);
  assert.equal(rows[0].n, 0);
});

test('MySQL: device never becomes ACTIVE from bootstrap alone', async () => {
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();
  const result = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() });
  const device = await deviceRepository.findDeviceForFamily(record.familyId, result.deviceId);
  assert.notEqual(device.status, 'ACTIVE');
  assert.notEqual(device.status, 'PAIRED');
  assert.equal(device.status, 'PAIRING_PENDING');
});

test('MySQL REQUIRED CONCURRENCY: 30 simultaneous enrollment attempts (distinct attempt ids) against ONE invitation -- exactly one PAIRING_PENDING device, no orphans, no duplicates', async () => {
  // Note: the connection pool defaults to connectionLimit: 10 (see
  // backend/src/db/pool.ts), so this arrives as several overlapping waves
  // of up to 10 truly concurrent DB round-trips rather than one instant of
  // 30, with the remainder queued on the pool. That does not weaken the
  // invariant under test: the exactly-one-winner guarantee is enforced by
  // the invitation row's SELECT...FOR UPDATE lock (see
  // MySqlEnrollmentCoordinatorRepository), not by connection-level
  // simultaneity -- a transaction queued on the pool is operationally
  // indistinguishable, for this property, from one queued on the row lock.
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();

  const attempts = await Promise.allSettled(
    Array.from({ length: 30 }, () =>
      coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    ),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent enrollment attempt must succeed');
  assert.equal(rejected.length, 29);
  for (const failure of rejected) assert.equal(failure.reason.code, 'ALREADY_REDEEMED');

  const [deviceRows] = await getPool().query(
    `SELECT COUNT(*) AS n, GROUP_CONCAT(DISTINCT status) AS statuses FROM devices WHERE family_id = ?`,
    [record.familyId],
  );
  assert.equal(deviceRows[0].n, 1, 'no duplicate enrollment: exactly one device row for this family');
  assert.deepEqual(deviceRows[0].statuses.split(','), ['PAIRING_PENDING']);

  const [keyRows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM device_public_keys WHERE device_id = (SELECT device_id FROM devices WHERE family_id = ?)`,
    [record.familyId],
  );
  assert.equal(keyRows[0].n, 2, 'no orphan public key: exactly DSK+DEK for the enrolled device');

  const [invitationRows] = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = ?`, [record.invitationId]);
  assert.equal(invitationRows[0].status, 'REDEEMED');

  const [attemptRows] = await getPool().query(`SELECT COUNT(*) AS n FROM enrollment_bootstrap_attempts WHERE invitation_id = ?`, [record.invitationId]);
  assert.equal(attemptRows[0].n, 1, 'exactly one attempt row must be persisted -- the winner\'s');
});

// --- PCA-ENROLLMENT-RUNTIME-2: ambiguous-retry / idempotent-recovery MySQL tests ---

test('MySQL RETRY: same (attemptId, token, DSK, DEK) tuple replays the original device, never creates a second one', async () => {
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();
  const input = deviceKeysInput();
  const first = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...input });
  const retry = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...input });
  assert.equal(retry.deviceId, first.deviceId);
  assert.equal(retry.signingKeyId, first.signingKeyId);
  assert.equal(retry.encryptionKeyId, first.encryptionKeyId);

  const [deviceRows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [record.familyId]);
  assert.equal(deviceRows[0].n, 1, 'DEVICE_COUNT_AFTER_RETRIES: exactly one device after a retry of the same attempt');
});

test('MySQL RETRY: 20 concurrent retries of the SAME attempt id -- exactly one device, all responses agree', async () => {
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();
  const input = deviceKeysInput();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...input })),
  );
  const uniqueDeviceIds = new Set(results.map((r) => r.deviceId));
  assert.equal(uniqueDeviceIds.size, 1, 'all 20 concurrent retries of the same attempt must agree on one deviceId');

  const [deviceRows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [record.familyId]);
  assert.equal(deviceRows[0].n, 1, 'MULTI_PROCESS/CONCURRENT_DUPLICATE: exactly one device after 20 concurrent duplicate requests');
});

test('MySQL: a DIFFERENT attempt id against an already-redeemed invitation is genuine ALREADY_REDEEMED, not a replay', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'ALREADY_REDEEMED' },
  );
});

test('MySQL ADVERSARIAL: same attempt id reused against a DIFFERENT invitation token is ATTEMPT_CONFLICT, no device created for the loser', async () => {
  const coordinator = buildCoordinator();
  const { rawToken: firstToken } = await createInvitation();
  const sharedAttemptId = attemptId();
  await coordinator.enrollDevice({ rawInvitationToken: firstToken, ...deviceKeysInput({ attemptId: sharedAttemptId }) });

  const { rawToken: secondToken, record: secondRecord } = await createInvitation();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: secondToken, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
    { code: 'ATTEMPT_CONFLICT' },
  );
  const [deviceRows] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [secondRecord.familyId]);
  assert.equal(deviceRows[0].n, 0, 'the losing conflicting attempt must not create a device');
  const [invitationRows] = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = ?`, [secondRecord.invitationId]);
  assert.equal(invitationRows[0].status, 'CREATED', 'the second invitation must remain unredeemed after the conflicting attempt rolls back');
});

test('MySQL ADVERSARIAL CONCURRENCY: same attempt id, two DIFFERENT invitation tokens, truly concurrent -- exactly one may ever win', async () => {
  const coordinator = buildCoordinator();
  const { rawToken: tokenA, record: recordA } = await createInvitation();
  const { rawToken: tokenB, record: recordB } = await createInvitation();
  const sharedAttemptId = attemptId();

  const results = await Promise.allSettled([
    coordinator.enrollDevice({ rawInvitationToken: tokenA, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
    coordinator.enrollDevice({ rawInvitationToken: tokenB, ...deviceKeysInput({ attemptId: sharedAttemptId }) }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one of two competing attempt-id claims across different tokens may succeed');

  const [attemptRows] = await getPool().query(`SELECT COUNT(*) AS n FROM enrollment_bootstrap_attempts WHERE attempt_id = ?`, [sharedAttemptId]);
  assert.equal(attemptRows[0].n, 1, 'exactly one attempt row for the shared attempt id, regardless of which token won');

  const [deviceRowsA] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [recordA.familyId]);
  const [deviceRowsB] = await getPool().query(`SELECT COUNT(*) AS n FROM devices WHERE family_id = ?`, [recordB.familyId]);
  assert.equal(Number(deviceRowsA[0].n) + Number(deviceRowsB[0].n), 1, 'exactly one device total across both families -- never two, never zero');
});

test('MySQL RECOVERY: recoverAttempt returns the original deviceId after a lost response, using only attemptId+attemptRecoveryToken', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  const input = deviceKeysInput();
  const original = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...input });

  // Simulate total loss of the original in-memory rawInvitationToken/response:
  // recovery uses only attemptId + attemptRecoveryToken.
  const recovered = await coordinator.recoverAttempt({ attemptId: input.attemptId, attemptRecoveryToken: input.attemptRecoveryToken });
  assert.equal(recovered.deviceId, original.deviceId);
  assert.equal(recovered.status, 'PAIRING_PENDING');
});

test('MySQL RECOVERY: unknown attempt id and wrong recovery token both raise the identical NOT_FOUND error -- no oracle', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  const input = deviceKeysInput();
  await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...input });

  await assert.rejects(() => coordinator.recoverAttempt({ attemptId: attemptId(), attemptRecoveryToken: recoveryToken() }), { code: 'NOT_FOUND' });
  await assert.rejects(
    () => coordinator.recoverAttempt({ attemptId: input.attemptId, attemptRecoveryToken: recoveryToken() }),
    { code: 'NOT_FOUND' },
  );
});

test('MySQL RECOVERY: cross-family -- a recovery secret from one family\'s attempt never recovers a different family\'s attempt', async () => {
  const coordinator = buildCoordinator();
  const { rawToken: tokenA } = await createInvitation();
  const { rawToken: tokenB } = await createInvitation();
  const inputA = deviceKeysInput();
  const inputB = deviceKeysInput();
  await coordinator.enrollDevice({ rawInvitationToken: tokenA, ...inputA });
  await coordinator.enrollDevice({ rawInvitationToken: tokenB, ...inputB });

  await assert.rejects(
    () => coordinator.recoverAttempt({ attemptId: inputB.attemptId, attemptRecoveryToken: inputA.attemptRecoveryToken }),
    { code: 'NOT_FOUND' },
  );
});

test('MySQL BACKWARD COMPATIBILITY: a REDEEMED invitation with no attempt row (pre-migration record) fails safely to ALREADY_REDEEMED', async () => {
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();
  // Simulate a Runtime-1-era redemption: invitation marked REDEEMED directly,
  // with no corresponding enrollment_bootstrap_attempts row (that table did
  // not exist before this migration).
  await getPool().query(`UPDATE enrollment_invitations SET status = 'REDEEMED', redeemed_at = NOW(3) WHERE invitation_id = ?`, [record.invitationId]);
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'ALREADY_REDEEMED' },
  );
});

test.after(async () => {
  await closePool();
});
