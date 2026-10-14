import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService } from '../../dist/device/DeviceDirectoryService.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { computeKeyFingerprint } from '../../dist/pairing/fingerprint.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceRepository();
const deviceService = new DeviceDirectoryService(repository, () => new Date());
const pairingService = new PairingService(repository, () => new Date());
const authRepository = new MySqlAuthRepository();

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return randomUUID();
}

async function currentPairingFingerprints(familyId, deviceId) {
  const view = await pairingService.getPairingRequest(familyId, deviceId);
  return { expectedDskFingerprint: view.dskFingerprint, expectedDekFingerprint: view.dekFingerprint };
}

// paired_by_account_id FK-references a real service_accounts row -- a
// pairing confirmation always comes from an authenticated parent account,
// never a synthetic id, so tests must create one for real.
async function realAccountId(familyId) {
  const { accountId } = await authRepository.findOrCreateAccount(randomBytes(32), new Date());
  const parentAccountId = randomUUID();
  const now = new Date();
  await getPool().query(
    `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, family_id, service_account_id, free_access_mode, created_at, verified_at)
     VALUES (?, ?, 'pairing-test-placeholder', 'VERIFIED', ?, ?, 'PERPETUAL', ?, ?)`,
    [parentAccountId, randomBytes(32), familyId, accountId, now, now],
  );
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at, provisioned_for_account_id)
     VALUES (?, ?, ?, ?)`,
    [familyId, randomBytes(32), now, parentAccountId],
  );
  await getPool().query(
    `INSERT INTO family_parent_memberships
       (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ADMINISTRATOR', 'ACTIVE', ?, ?)`,
    [randomUUID(), familyId, parentAccountId, accountId, now, now],
  );
  return accountId;
}

async function pairedCandidateDevice(familyId) {
  const signingKey = key();
  const encryptionKey = key();
  const { device } = await deviceService.registerDevice({ familyId, platform: 'ANDROID', keyPurpose: 'DSK', publicKey: signingKey });
  await deviceService.addDeviceKey(familyId, device.deviceId, encryptionKey, 'DEK');
  return { device, signingKey, encryptionKey };
}

test('MySQL: getPairingRequest exposes real DSK/DEK fingerprints persisted in MySQL', async () => {
  const familyId = family();
  const { device, signingKey, encryptionKey } = await pairedCandidateDevice(familyId);
  const view = await pairingService.getPairingRequest(familyId, device.deviceId);
  assert.equal(view.status, 'PAIRING_PENDING');
  assert.equal(view.dskFingerprint, computeKeyFingerprint(signingKey));
  assert.equal(view.dekFingerprint, computeKeyFingerprint(encryptionKey));
});

test('MySQL: wrong family cannot inspect a pairing request (IDOR)', async () => {
  const familyId = family();
  const otherFamilyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const wrongFamilyError = await pairingService.getPairingRequest(otherFamilyId, device.deviceId).catch((e) => e);
  const unknownError = await pairingService.getPairingRequest(otherFamilyId, randomUUID()).catch((e) => e);
  assert.equal(wrongFamilyError.code, 'NOT_FOUND');
  assert.equal(wrongFamilyError.message, unknownError.message);
});

test('MySQL: authorized parent confirmation transitions PAIRING_PENDING -> PAIRED, persisted', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const confirmedBy = await realAccountId(familyId);
  const view = await pairingService.confirmPairing(familyId, device.deviceId, confirmedBy,
    await currentPairingFingerprints(familyId, device.deviceId));
  assert.equal(view.status, 'PAIRED');
  const reread = await pairingService.getPairingRequest(familyId, device.deviceId);
  assert.equal(reread.status, 'PAIRED');
});

test('MySQL: paired device rejects enrollment key mutation and persists the confirmed key set unchanged', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const confirmedBy = await realAccountId(familyId);
  await pairingService.confirmPairing(familyId, device.deviceId, confirmedBy,
    await currentPairingFingerprints(familyId, device.deviceId));

  const before = await repository.findKeysByDeviceForFamily(familyId, device.deviceId);
  await assert.rejects(
    () => deviceService.addDeviceKey(familyId, device.deviceId, key(), 'DEK'),
    { code: 'INVALID_STATE' },
  );
  const after = await repository.findKeysByDeviceForFamily(familyId, device.deviceId);
  assert.deepEqual(after.map((item) => item.keyId).sort(), before.map((item) => item.keyId).sort());
  assert.equal(after.length, 2, 'failed post-pairing enrollment must not append a key row');
});

test('MySQL: key enrollment after the displayed pairing view rejects stale confirmation and leaves durable status pending', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const confirmedBy = await realAccountId(familyId);
  const displayedFingerprints = await currentPairingFingerprints(familyId, device.deviceId);

  // This is the interleaving window: another valid key mutation commits after
  // the Parent reads the view but before the confirm transaction locks the
  // device and current active keys.
  await deviceService.addDeviceKey(familyId, device.deviceId, key(), 'DEK');
  await assert.rejects(
    () => pairingService.confirmPairing(familyId, device.deviceId, confirmedBy, displayedFingerprints),
    { code: 'FINGERPRINT_MISMATCH' },
  );
  assert.equal((await pairingService.getPairingRequest(familyId, device.deviceId)).status, 'PAIRING_PENDING');
});

test('MySQL: membership demotion or revocation after route preflight cannot pair a device', async () => {
  for (const change of [
    { role: 'VIEWER', status: 'ACTIVE', label: 'demoted' },
    { role: 'ADMINISTRATOR', status: 'REVOKED', label: 'revoked' },
  ]) {
    const familyId = family();
    const { device } = await pairedCandidateDevice(familyId);
    const serviceAccountId = await realAccountId(familyId);
    const displayedFingerprints = await currentPairingFingerprints(familyId, device.deviceId);

    // Model the route preflight/step-up window: authorization was valid,
    // then durable membership changed before the final repository boundary.
    await getPool().query(
      `UPDATE family_parent_memberships SET role = ?, status = ?, updated_at = NOW(3)
        WHERE family_id = ? AND service_account_id = ?`,
      [change.role, change.status, familyId, serviceAccountId],
    );
    await assert.rejects(
      () => pairingService.confirmPairing(familyId, device.deviceId, serviceAccountId, displayedFingerprints),
      { code: 'INVALID_STATE' },
      `${change.label} membership must fail closed`,
    );
    const persisted = await repository.findDeviceForFamily(familyId, device.deviceId);
    assert.equal(persisted?.status, 'PAIRING_PENDING', `${change.label} must not transition the device`);
    assert.equal(persisted?.pairedAt, null);
  }
});

test('MySQL: REVOKED pairing request cannot become PAIRED', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const expectedFingerprints = await currentPairingFingerprints(familyId, device.deviceId);
  await deviceService.revokeDevice(familyId, device.deviceId);
  const confirmedBy = await realAccountId(familyId);
  await assert.rejects(
    () => pairingService.confirmPairing(familyId, device.deviceId, confirmedBy, expectedFingerprints),
    { code: 'INVALID_STATE' },
  );
});

test('MySQL CONCURRENCY: many genuinely simultaneous confirmation attempts converge on one winning pairedAt', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const confirmedBy = await realAccountId(familyId);
  let currentTime = Date.now();
  const now = () => new Date(currentTime++);
  const auditRepository = new InMemoryFamilyAuditRepository();
  const auditedPairingService = new PairingService(repository, now, new FamilyAuditService(auditRepository, now));
  const expectedFingerprints = await currentPairingFingerprints(familyId, device.deviceId);
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => auditedPairingService.confirmPairing(familyId, device.deviceId, confirmedBy, expectedFingerprints)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'confirmation is idempotent, never a hard error under a race');
  const timestamps = new Set(attempts.map((a) => a.value.status));
  assert.equal(timestamps.size, 1);
  assert.equal([...timestamps][0], 'PAIRED');

  const persisted = await repository.findDeviceForFamily(familyId, device.deviceId);
  assert.ok(persisted?.pairedAt);
  const winningPairedAt = persisted.pairedAt.getTime();
  const lifecycleAudits = () => auditRepository.listForFamily(familyId).then((events) => events.filter((event) =>
    event.actionType === 'DEVICE_LIFECYCLE_TRANSITION' && event.targetScope.id === device.deviceId));
  assert.equal((await lifecycleAudits()).length, 1, 'only the database transition winner emits the lifecycle audit');

  currentTime += 60_000;
  const replay = await auditedPairingService.confirmPairing(familyId, device.deviceId, confirmedBy,
    await currentPairingFingerprints(familyId, device.deviceId));
  assert.equal(replay.status, 'PAIRED');
  const afterReplay = await repository.findDeviceForFamily(familyId, device.deviceId);
  assert.equal(afterReplay?.pairedAt?.getTime(), winningPairedAt, 'a later idempotent confirmation preserves the first pairedAt');
  assert.equal((await lifecycleAudits()).length, 1, 'a later replay must not create another transition audit');
});

test.after(async () => {
  await closePool();
});
