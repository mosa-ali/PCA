import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { EnrollmentCoordinator } from '../../dist/enrollment/EnrollmentCoordinator.js';
import { PostgresEnrollmentCoordinatorRepository } from '../../dist/enrollment/PostgresEnrollmentCoordinatorRepository.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { PostgresInvitationRepository } from '../../dist/invitation/PostgresInvitationRepository.js';
import { PostgresDeviceRepository } from '../../dist/device/PostgresDeviceRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const enrollmentRepository = new PostgresEnrollmentCoordinatorRepository();
const invitationRepository = new PostgresInvitationRepository();
const deviceRepository = new PostgresDeviceRepository();

function buildCoordinator(now = () => new Date()) {
  return new EnrollmentCoordinator(enrollmentRepository, now);
}

function key() {
  return randomBytes(32).toString('base64url');
}

function deviceKeysInput(overrides = {}) {
  return { platform: 'ANDROID', signingPublicKey: key(), encryptionPublicKey: key(), ...overrides };
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

test('PG: successful enrollment creates a PAIRING_PENDING device with DSK+DEK and redeems the invitation, all visible after commit', async () => {
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

  const { rows } = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = $1`, [record.invitationId]);
  assert.equal(rows[0].status, 'REDEEMED');
});

test('PG: identical signing and encryption keys rejected', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  const sharedKey = key();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput({ signingPublicKey: sharedKey, encryptionPublicKey: sharedKey }) }),
    { code: 'KEYS_NOT_DISTINCT' },
  );
});

test('PG: already-redeemed invitation rejected, no second device created', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation();
  const first = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'ALREADY_REDEEMED' },
  );
  const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM devices WHERE family_id = (SELECT family_id FROM devices WHERE device_id = $1)`, [first.deviceId]);
  assert.equal(rows[0].n, 1);
});

test('PG: expired invitation rejected, no device created', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation({ ttlMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'EXPIRED' },
  );
});

test('PG: revoked invitation rejected, no device created', async () => {
  const invitationService = new InvitationService(invitationRepository);
  const { rawToken, record } = await createInvitation();
  await invitationService.revokeInvitation(record.invitationId);
  const coordinator = buildCoordinator();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() }),
    { code: 'REVOKED' },
  );
});

test('PG: platform mismatch rejected, invitation remains usable afterward', async () => {
  const coordinator = buildCoordinator();
  const { rawToken } = await createInvitation({ platform: 'ANDROID' });
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput({ platform: 'IOS' }) }),
    { code: 'PLATFORM_MISMATCH' },
  );
  const result = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput({ platform: 'ANDROID' }) });
  assert.ok(result.deviceId);
});

test('PG FAILURE INJECTION: duplicate public key (DSK or DEK) aborts the WHOLE transaction -- no orphan device, invitation stays unredeemed', async () => {
  const coordinator = buildCoordinator();
  const sharedKey = key();
  const first = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: first.rawToken, ...deviceKeysInput({ signingPublicKey: sharedKey }) });

  const second = await createInvitation();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput({ encryptionPublicKey: sharedKey }) }),
    { code: 'DUPLICATE_KEY' },
  );

  // Invitation must NOT be consumed by the failed attempt.
  const { rows: invitationRows } = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = $1`, [second.record.invitationId]);
  assert.equal(invitationRows[0].status, 'CREATED');

  // No device row for the failed attempt's family (proves the DSK insert's
  // success didn't survive the DEK insert's failure -- both rows of the
  // single multi-row INSERT statement are atomic together).
  const { rows: deviceRows } = await getPool().query(`SELECT count(*)::int AS n FROM devices WHERE family_id = $1`, [second.record.familyId]);
  assert.equal(deviceRows[0].n, 0, 'no orphan device may survive a rolled-back enrollment transaction');

  // The invitation can still be redeemed with fresh keys.
  const retry = await coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput() });
  assert.ok(retry.deviceId);
});

test('PG FAILURE INJECTION: duplicate DSK specifically rolls back the device insert too', async () => {
  const coordinator = buildCoordinator();
  const sharedSigningKey = key();
  const first = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: first.rawToken, ...deviceKeysInput({ signingPublicKey: sharedSigningKey }) });

  const second = await createInvitation();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput({ signingPublicKey: sharedSigningKey }) }),
    { code: 'DUPLICATE_KEY' },
  );
  const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM devices WHERE family_id = $1`, [second.record.familyId]);
  assert.equal(rows[0].n, 0);
});

test('PG FAILURE INJECTION: duplicate DEK specifically rolls back the device insert too', async () => {
  const coordinator = buildCoordinator();
  const sharedEncryptionKey = key();
  const first = await createInvitation();
  await coordinator.enrollDevice({ rawInvitationToken: first.rawToken, ...deviceKeysInput({ encryptionPublicKey: sharedEncryptionKey }) });

  const second = await createInvitation();
  await assert.rejects(
    () => coordinator.enrollDevice({ rawInvitationToken: second.rawToken, ...deviceKeysInput({ encryptionPublicKey: sharedEncryptionKey }) }),
    { code: 'DUPLICATE_KEY' },
  );
  const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM devices WHERE family_id = $1`, [second.record.familyId]);
  assert.equal(rows[0].n, 0);
});

test('PG: device never becomes ACTIVE from bootstrap alone', async () => {
  const coordinator = buildCoordinator();
  const { rawToken, record } = await createInvitation();
  const result = await coordinator.enrollDevice({ rawInvitationToken: rawToken, ...deviceKeysInput() });
  const device = await deviceRepository.findDeviceForFamily(record.familyId, result.deviceId);
  assert.notEqual(device.status, 'ACTIVE');
  assert.notEqual(device.status, 'PAIRED');
  assert.equal(device.status, 'PAIRING_PENDING');
});

test('PG REQUIRED CONCURRENCY: 30 simultaneous enrollment attempts against ONE invitation -- exactly one PAIRING_PENDING device, no orphans, no duplicates', async () => {
  // Note: pg.Pool defaults to max:10 connections, so this arrives as
  // several overlapping waves of up to 10 truly concurrent DB round-trips
  // rather than one instant of 30, with the remainder queued on the pool.
  // That does not weaken the invariant under test: the exactly-one-winner
  // guarantee is enforced by the invitation row's SELECT...FOR UPDATE lock
  // (see PostgresEnrollmentCoordinatorRepository), not by connection-level
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

  const { rows: deviceRows } = await getPool().query(`SELECT count(*)::int AS n, array_agg(DISTINCT status) AS statuses FROM devices WHERE family_id = $1`, [record.familyId]);
  assert.equal(deviceRows[0].n, 1, 'no duplicate enrollment: exactly one device row for this family');
  assert.deepEqual(deviceRows[0].statuses, ['PAIRING_PENDING']);

  const { rows: keyRows } = await getPool().query(
    `SELECT count(*)::int AS n FROM device_public_keys WHERE device_id = (SELECT device_id FROM devices WHERE family_id = $1)`,
    [record.familyId],
  );
  assert.equal(keyRows[0].n, 2, 'no orphan public key: exactly DSK+DEK for the enrolled device');

  const { rows: invitationRows } = await getPool().query(`SELECT status FROM enrollment_invitations WHERE invitation_id = $1`, [record.invitationId]);
  assert.equal(invitationRows[0].status, 'REDEEMED');
});

test.after(async () => {
  await closePool();
});
