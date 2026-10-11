// PCA-ADD-ENR-016/PCA-FR-145: real-MySQL proof that MySqlDeviceProtectionStatusRepository
// genuinely persists and reads device-reported protection status, and that
// RealProtectiveAuthorityResolver correctly interprets it against a real
// database (not just the in-memory reference repository).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import {
  MySqlDeviceProtectionStatusRepository,
  ProtectionStatusDeviceUnavailableError,
} from '../../dist/device/DeviceProtectionStatusRepository.js';
import { MySqlDeviceChallengeRepository } from '../../dist/deviceauth/MySqlDeviceChallengeRepository.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { DeviceSessionService } from '../../dist/runtime-sync/DeviceSessionService.js';
import { InMemoryDeviceSessionRepository } from '../../dist/runtime-sync/DeviceSessionRepository.js';
import { DeviceSyncStatusTracker } from '../../dist/runtime-sync/StatusService.js';
import { createTestOnlyDeviceSignatureVerifier, signTestOnlyChallenge } from '../support/testOnlyDeviceSignatureVerifier.mjs';
import { registerRuntimeSyncRoutes } from '../../dist/http/routes/runtimeSyncRoutes.js';
import { RealProtectiveAuthorityResolver } from '../../dist/familyrbac/RealProtectiveAuthorityResolver.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceProtectionStatusRepository();
const deviceRepository = new MySqlDeviceRepository();
const noOpPreHandler = async () => {};

async function seedFamily() {
  const familyId = randomUUID();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  return familyId;
}

async function seedDevice(familyId) {
  const deviceId = randomUUID();
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'ANDROID', 'ACTIVE', NOW(3))`,
    [deviceId, familyId],
  );
  return deviceId;
}

async function registerStatusTestDevice(familyId) {
  const deviceId = randomUUID();
  const keyId = randomUUID();
  const publicKey = `test-dsk-${randomUUID()}`;
  const createdAt = new Date();
  const created = await deviceRepository.createDeviceWithKey(
    {
      deviceId,
      familyId,
      platform: 'ANDROID',
      status: 'ACTIVE',
      createdAt,
      revokedAt: null,
      pairedAt: null,
      pairedByAccountId: null,
      registeredByAccountId: null,
    },
    {
      deviceId,
      keyId,
      keyPurpose: 'DSK',
      publicKey,
      status: 'ACTIVE',
      createdAt,
      revokedAt: null,
    },
  );
  assert.equal(created.outcome, 'CREATED');
  return { deviceId, keyId, publicKey };
}

function buildRuntimeSyncStatusApp({ deviceProtectionStatusRepository, trustSetRoleResolver }) {
  const deviceAuthService = new DeviceAuthService(
    new MySqlDeviceChallengeRepository(),
    deviceRepository,
    createTestOnlyDeviceSignatureVerifier(),
  );
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository());
  const app = Fastify({ logger: false });
  registerRuntimeSyncRoutes(app, {
    deviceSessionService,
    // These dependencies are required by sibling runtime-sync routes but are
    // not reached by this protection-status-only integration test.
    outboundRelayService: {},
    inboundReconnectService: {},
    statusTracker: new DeviceSyncStatusTracker(),
    resolveEnvelopeContext: () => { throw new Error('not reached by protection-status'); },
    rateLimiter: () => noOpPreHandler,
    authAttemptLimiter: noOpPreHandler,
    deviceProtectionStatusRepository,
    trustSetRoleResolver,
  });
  return { app, deviceSessionService };
}

async function authenticateRuntimeSyncDevice(app, deviceId, publicKey) {
  const challenge = await app.inject({ method: 'POST', url: `/v1/runtime-sync/devices/${deviceId}/challenge` });
  assert.equal(challenge.statusCode, 200, challenge.body);
  const { challengeId, nonce } = challenge.json();
  const session = await app.inject({
    method: 'POST',
    url: `/v1/runtime-sync/devices/${deviceId}/session`,
    payload: { challengeId, signature: signTestOnlyChallenge(publicKey, nonce) },
  });
  assert.equal(session.statusCode, 200, session.body);
  return session.json().sessionToken;
}

test('upsert persists a real row, readable back with the exact protection level and a server-stamped updated_at', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  const before = new Date();

  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: before });
  const record = await repository.findForDevice(familyId, deviceId);

  assert.ok(record);
  assert.equal(record.deviceId, deviceId);
  assert.equal(record.familyId, familyId);
  assert.equal(record.protectionLevel, 'PROTECTED');
});

test('upsert is a true upsert -- reporting a new level overwrites the old one, never appends a second row', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);

  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  await repository.upsert({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() });

  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM device_protection_status WHERE device_id = ?', [deviceId]);
  assert.equal(rows[0].n, 1);
  const record = await repository.findForDevice(familyId, deviceId);
  assert.equal(record.protectionLevel, 'DEGRADED');
});

test('concurrent MySQL status transitions serialize on the device row and expose exactly one DEGRADED transition', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });

  const prior = await Promise.all([
    repository.recordAndReadPrevious({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() }),
    repository.recordAndReadPrevious({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() }),
  ]);

  assert.deepEqual(prior.map((item) => item?.protectionLevel).sort(), ['DEGRADED', 'PROTECTED']);
  assert.equal((await repository.findForDevice(familyId, deviceId))?.protectionLevel, 'DEGRADED');
  const [[rows]] = await getPool().query(
    `SELECT COUNT(*) AS count FROM device_protection_status WHERE device_id = ? AND family_id = ?`,
    [deviceId, familyId],
  );
  assert.equal(Number(rows.count), 1);
});

test('concurrent first MySQL status reports serialize even though no status row exists yet', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);

  const previous = await Promise.all([
    repository.recordAndReadPrevious({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() }),
    repository.recordAndReadPrevious({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() }),
  ]);

  assert.equal(previous.filter((item) => item === null).length, 1);
  assert.deepEqual(previous.filter(Boolean).map((item) => item.protectionLevel), ['DEGRADED']);
  assert.equal((await repository.findForDevice(familyId, deviceId))?.protectionLevel, 'DEGRADED');
});

test('status writes reject a device revoked or family suspended before the transaction lock', async () => {
  const revokedFamilyId = await seedFamily();
  const revokedDeviceId = await seedDevice(revokedFamilyId);
  await getPool().query(
    `UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3) WHERE device_id = ? AND family_id = ?`,
    [revokedDeviceId, revokedFamilyId],
  );
  await assert.rejects(
    repository.upsert({ deviceId: revokedDeviceId, familyId: revokedFamilyId, protectionLevel: 'DEGRADED', updatedAt: new Date() }),
    ProtectionStatusDeviceUnavailableError,
  );
  assert.equal(await repository.findForDevice(revokedFamilyId, revokedDeviceId), null);

  const suspendedFamilyId = await seedFamily();
  const suspendedDeviceId = await seedDevice(suspendedFamilyId);
  const adminId = randomUUID();
  await getPool().query(
    `INSERT INTO platform_admin_accounts (admin_id, email_hash, display_name, password_credential, status, created_at, disabled_at)
     VALUES (?, ?, 'Device protection test admin', 'test-placeholder', 'ACTIVE', NOW(3), NULL)`,
    [adminId, randomBytes(32)],
  );
  await getPool().query(
    `UPDATE families
        SET status = 'SUSPENDED', suspended_at = NOW(3), suspended_by_admin_id = ?, suspension_reason = 'protection test fixture'
      WHERE family_id = ?`,
    [adminId, suspendedFamilyId],
  );
  await assert.rejects(
    repository.upsert({ deviceId: suspendedDeviceId, familyId: suspendedFamilyId, protectionLevel: 'PROTECTED', updatedAt: new Date() }),
    ProtectionStatusDeviceUnavailableError,
  );
  assert.equal(await repository.findForDevice(suspendedFamilyId, suspendedDeviceId), null);
});

test('an unknown device/family pair reads back null, never a fabricated default', async () => {
  const record = await repository.findForDevice(randomUUID(), randomUUID());
  assert.equal(record, null);
});

test('the schema CHECK constraint rejects a protection_level outside the documented vocabulary', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at) VALUES (?, ?, 'MADE_UP_LEVEL', NOW(3))`,
      [deviceId, familyId],
    ),
  );
});

test('a device_protection_status row cannot reference a nonexistent device (FK constraint)', async () => {
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO device_protection_status (device_id, family_id, protection_level, updated_at) VALUES (?, ?, 'PROTECTED', NOW(3))`,
      [randomUUID(), randomUUID()],
    ),
  );
});

test('end-to-end against real MySQL: RealProtectiveAuthorityResolver resolves true for a fresh PROTECTED report and false for a different family/device', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });

  const resolver = new RealProtectiveAuthorityResolver(repository);
  assert.equal(await resolver.resolve(familyId, deviceId), true);
  assert.equal(await resolver.resolve(familyId, randomUUID()), false);
  assert.equal(await resolver.resolve(randomUUID(), deviceId), false);
});

test('end-to-end against real MySQL: RealProtectiveAuthorityResolver fails closed once the report is older than the freshness bound', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  const maxStalenessMs = 60_000;
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date(Date.now() - maxStalenessMs - 5_000) });

  const resolver = new RealProtectiveAuthorityResolver(repository, { maxStalenessMs });
  assert.ok(await repository.findForDevice(familyId, deviceId), 'a stale report remains distinguishable from an absent/inactive report');
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test('protective authority immediately fails closed after device revocation despite a fresh PROTECTED report', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  const resolver = new RealProtectiveAuthorityResolver(repository);

  assert.equal(await resolver.resolve(familyId, deviceId), true);
  const revoked = await deviceRepository.revokeDeviceAndKeysAtomically(familyId, deviceId, new Date());
  assert.equal(revoked.outcome, 'REVOKED');
  assert.equal(await repository.findForDevice(familyId, deviceId), null);
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test('MySQL HTTP: authenticated runtime-sync protection-status writes only the session device with server receipt time and current authority', async () => {
  const familyId = await seedFamily();
  const foreignFamilyId = await seedFamily();
  const device = await registerStatusTestDevice(familyId);
  const foreignDeviceId = await seedDevice(foreignFamilyId);
  const foreignBefore = new Date(Date.now() - 60_000);
  await repository.upsert({
    deviceId: foreignDeviceId,
    familyId: foreignFamilyId,
    protectionLevel: 'STANDARD',
    updatedAt: foreignBefore,
  });

  let authorityAvailable = true;
  const trustSetRoleResolver = {
    async resolveActor(requestFamilyId, requestDeviceId, requestKeyId) {
      if (!authorityAvailable || requestFamilyId !== familyId || requestDeviceId !== device.deviceId || requestKeyId !== device.keyId) {
        return 'DEVICE_NOT_ACTIVE';
      }
      return { deviceId: device.deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
    },
  };
  const { app } = buildRuntimeSyncStatusApp({
    deviceProtectionStatusRepository: repository,
    trustSetRoleResolver,
  });
  try {
    const sessionToken = await authenticateRuntimeSyncDevice(app, device.deviceId, device.publicKey);
    const url = '/v1/runtime-sync/protection-status';

    const unauthenticated = await app.inject({ method: 'POST', url, payload: { protectionLevel: 'PROTECTED' } });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(await repository.findForDevice(familyId, device.deviceId), null);

    const beforeWrite = new Date();
    const written = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: {
        protectionLevel: 'PROTECTED',
        familyId: foreignFamilyId,
        deviceId: foreignDeviceId,
        updatedAt: '2000-01-01T00:00:00.000Z',
      },
    });
    const afterWrite = new Date();
    assert.equal(written.statusCode, 204, written.body);

    const actual = await repository.findForDevice(familyId, device.deviceId);
    assert.ok(actual);
    assert.equal(actual.protectionLevel, 'PROTECTED');
    assert.ok(actual.updatedAt.getTime() >= beforeWrite.getTime() - 1000, 'the client timestamp must not backdate the receipt');
    assert.ok(actual.updatedAt.getTime() <= afterWrite.getTime() + 1000, 'the timestamp must be server-received time');
    assert.equal(await repository.findForDevice(foreignFamilyId, foreignDeviceId).then(row => row.protectionLevel), 'STANDARD');
    assert.equal(await repository.findForDevice(foreignFamilyId, device.deviceId), null);
    assert.equal(await repository.findForDevice(familyId, foreignDeviceId), null);

    const [[rowCounts]] = await getPool().query(
      `SELECT SUM(device_id = ?) AS actual_rows, SUM(device_id = ?) AS foreign_rows
         FROM device_protection_status WHERE device_id IN (?, ?)`,
      [device.deviceId, foreignDeviceId, device.deviceId, foreignDeviceId],
    );
    assert.equal(Number(rowCounts.actual_rows), 1);
    assert.equal(Number(rowCounts.foreign_rows), 1);

    authorityAvailable = false;
    const staleAuthority = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { protectionLevel: 'DEGRADED' },
    });
    assert.equal(staleAuthority.statusCode, 403);
    assert.equal((await repository.findForDevice(familyId, device.deviceId))?.protectionLevel, 'PROTECTED');

    authorityAvailable = true;
    const revoked = await deviceRepository.revokeDeviceAndKeysAtomically(familyId, device.deviceId, new Date());
    assert.equal(revoked.outcome, 'REVOKED');
    const afterRevocation = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { protectionLevel: 'DEGRADED' },
    });
    assert.equal(afterRevocation.statusCode, 401);
    const [[persisted]] = await getPool().query(
      `SELECT protection_level FROM device_protection_status WHERE device_id = ?`,
      [device.deviceId],
    );
    assert.equal(persisted.protection_level, 'PROTECTED');
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: device revoked after session/Trust Set checks but before persistence cannot write protection status', async () => {
  const familyId = await seedFamily();
  const device = await registerStatusTestDevice(familyId);
  let resolverCalls = 0;
  const trustSetRoleResolver = {
    async resolveActor(requestFamilyId, requestDeviceId, requestKeyId) {
      assert.equal(requestFamilyId, familyId);
      assert.equal(requestDeviceId, device.deviceId);
      assert.equal(requestKeyId, device.keyId);
      resolverCalls += 1;
      const revoked = await deviceRepository.revokeDeviceAndKeysAtomically(familyId, device.deviceId, new Date());
      assert.equal(revoked.outcome, 'REVOKED');
      return { deviceId: device.deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
    },
  };
  const { app } = buildRuntimeSyncStatusApp({
    deviceProtectionStatusRepository: repository,
    trustSetRoleResolver,
  });
  try {
    const sessionToken = await authenticateRuntimeSyncDevice(app, device.deviceId, device.publicKey);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/runtime-sync/protection-status',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { protectionLevel: 'DEGRADED' },
    });

    assert.equal(resolverCalls, 1);
    assert.equal(response.statusCode, 403, response.body);
    assert.deepEqual(response.json(), { error: 'device_not_authorized' });
    assert.equal(await repository.findForDevice(familyId, device.deviceId), null);
    const [[rows]] = await getPool().query(
      `SELECT COUNT(*) AS count FROM device_protection_status WHERE device_id = ?`,
      [device.deviceId],
    );
    assert.equal(Number(rows.count), 0);
  } finally {
    await app.close();
  }
});

test('protective authority fails closed while the family is suspended or deleted', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'PROTECTED', updatedAt: new Date() });
  const resolver = new RealProtectiveAuthorityResolver(repository);

  const adminId = randomUUID();
  await getPool().query(
    `INSERT INTO platform_admin_accounts (admin_id, email_hash, display_name, password_credential, status, created_at, disabled_at)
     VALUES (?, ?, 'Device protection test admin', 'test-placeholder', 'ACTIVE', NOW(3), NULL)`,
    [adminId, randomBytes(32)],
  );
  await getPool().query(
    `UPDATE families
        SET status = 'SUSPENDED', suspended_at = NOW(3), suspended_by_admin_id = ?, suspension_reason = 'protection test fixture'
      WHERE family_id = ?`,
    [adminId, familyId],
  );
  assert.equal(await repository.findForDevice(familyId, deviceId), null);
  assert.equal(await resolver.resolve(familyId, deviceId), false);

  await getPool().query(
    `UPDATE families
        SET status = 'ACTIVE', suspended_at = NULL, suspended_by_admin_id = NULL, suspension_reason = NULL, deleted_at = NOW(3)
      WHERE family_id = ?`,
    [familyId],
  );
  assert.equal(await repository.findForDevice(familyId, deviceId), null);
  assert.equal(await resolver.resolve(familyId, deviceId), false);
});

test('revoke/read interleaving exposes the pre-commit state only until the revocation transaction commits', async () => {
  const familyId = await seedFamily();
  const deviceId = await seedDevice(familyId);
  await repository.upsert({ deviceId, familyId, protectionLevel: 'DEGRADED', updatedAt: new Date() });
  const resolver = new RealProtectiveAuthorityResolver(repository);
  const conn = await getPool().getConnection();

  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3) WHERE device_id = ? AND family_id = ?`, [deviceId, familyId]);

    // The update is still uncommitted: the reader sees the last committed
    // ACTIVE state, then must stop treating the receipt as authoritative
    // immediately after the revocation becomes durable.
    assert.equal(await resolver.resolve(familyId, deviceId), true);
    await conn.commit();
    assert.equal(await resolver.resolve(familyId, deviceId), false);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
});

test.after(async () => {
  await closePool();
});
