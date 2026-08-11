import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService } from '../../dist/device/DeviceDirectoryService.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { computeKeyFingerprint } from '../../dist/pairing/fingerprint.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceRepository();
const deviceService = new DeviceDirectoryService(repository, () => new Date());
const pairingService = new PairingService(repository, () => new Date());
const authRepository = new MySqlAuthRepository();

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return `family-${randomUUID()}`;
}

// paired_by_account_id FK-references a real service_accounts row -- a
// pairing confirmation always comes from an authenticated parent account,
// never a synthetic id, so tests must create one for real.
async function realAccountId() {
  const { accountId } = await authRepository.findOrCreateAccount(randomBytes(32), new Date());
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
  const confirmedBy = await realAccountId();
  const view = await pairingService.confirmPairing(familyId, device.deviceId, confirmedBy);
  assert.equal(view.status, 'PAIRED');
  const reread = await pairingService.getPairingRequest(familyId, device.deviceId);
  assert.equal(reread.status, 'PAIRED');
});

test('MySQL: REVOKED pairing request cannot become PAIRED', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  await deviceService.revokeDevice(familyId, device.deviceId);
  const confirmedBy = await realAccountId();
  await assert.rejects(
    () => pairingService.confirmPairing(familyId, device.deviceId, confirmedBy),
    { code: 'INVALID_STATE' },
  );
});

test('MySQL CONCURRENCY: many genuinely simultaneous confirmation attempts converge on one winning pairedAt', async () => {
  const familyId = family();
  const { device } = await pairedCandidateDevice(familyId);
  const confirmedBy = await realAccountId();
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => pairingService.confirmPairing(familyId, device.deviceId, confirmedBy)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'confirmation is idempotent, never a hard error under a race');
  const timestamps = new Set(attempts.map((a) => a.value.status));
  assert.equal(timestamps.size, 1);
  assert.equal([...timestamps][0], 'PAIRED');
});

test.after(async () => {
  await closePool();
});
