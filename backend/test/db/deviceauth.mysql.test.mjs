import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeviceDirectoryService } from '../../dist/device/DeviceDirectoryService.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { DeviceAuthService, DeviceAuthError } from '../../dist/deviceauth/DeviceAuthService.js';
import { MySqlDeviceChallengeRepository } from '../../dist/deviceauth/MySqlDeviceChallengeRepository.js';
import { DEVICE_CHALLENGE_TTL_MS } from '../../dist/deviceauth/policy.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const deviceRepository = new MySqlDeviceRepository();
const directoryService = new DeviceDirectoryService(deviceRepository, () => new Date());
const challengeRepository = new MySqlDeviceChallengeRepository();

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return `family-${randomUUID()}`;
}

// Deterministic, non-cryptographic test-only "signature" -- see
// test/support/testOnlyDeviceSignatureVerifier.mjs for the equivalent
// used by the pure in-memory unit suite. Real signature verification is
// gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW.
function sign(publicKey, message) {
  return createHash('sha256').update(`${publicKey}:${message}`, 'utf8').digest('hex');
}

function buildAuthService(now = () => new Date()) {
  const verifier = { async verify(publicKey, message, signature) { return signature === sign(publicKey, message); } };
  return new DeviceAuthService(challengeRepository, deviceRepository, verifier, now);
}

async function registerDeviceWithDsk(familyId = family()) {
  const dskPublicKey = key();
  const { device } = await directoryService.registerDevice({ familyId, platform: 'ANDROID', publicKey: dskPublicKey, keyPurpose: 'DSK' });
  return { device, dskPublicKey };
}

test('MySQL: issueChallenge persists a real row, retrievable via findById', async () => {
  const { device } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);
  const stored = await challengeRepository.findById(issued.challengeId);
  assert.equal(stored.deviceId, device.deviceId);
  assert.equal(stored.familyId, device.familyId);
  assert.equal(stored.nonce, issued.nonce);
  assert.equal(stored.consumedAt, null);
});

test('MySQL: verifyChallenge with a valid signature succeeds and persists consumedAt', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);
  const identity = await authService.verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce));
  assert.equal(identity.deviceId, device.deviceId);
  const stored = await challengeRepository.findById(issued.challengeId);
  assert.ok(stored.consumedAt);
});

test('MySQL: second verification with the same replayed valid signature is ALREADY_CONSUMED after a real commit', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = sign(dskPublicKey, issued.nonce);
  await authService.verifyChallenge(issued.challengeId, signature);
  const error = await authService.verifyChallenge(issued.challengeId, signature).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'ALREADY_CONSUMED');
});

test('MySQL REQUIRED CONCURRENCY: many genuinely simultaneous verifications of the identical replayed valid signature -- exactly one CONSUMED', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);
  const signature = sign(dskPublicKey, issued.nonce);

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => authService.verifyChallenge(issued.challengeId, signature)),
  );
  const succeeded = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(succeeded.length, 1, 'exactly one concurrent verification of a replayed valid signature may ever succeed, even racing against real InnoDB row locking');
  assert.equal(rejected.length, 19);
  for (const outcome of rejected) {
    assert.ok(outcome.reason instanceof DeviceAuthError);
    assert.equal(outcome.reason.code, 'ALREADY_CONSUMED');
  }

  const stored = await challengeRepository.findById(issued.challengeId);
  assert.ok(stored.consumedAt);
});

test('MySQL: an invalid signature never consumes the challenge -- a later valid signature can still succeed', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);

  const badAttempt = await authService.verifyChallenge(issued.challengeId, 'garbage').catch((e) => e);
  assert.ok(badAttempt instanceof DeviceAuthError);
  assert.equal(badAttempt.code, 'INVALID_SIGNATURE');

  const identity = await authService.verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce));
  assert.equal(identity.deviceId, device.deviceId);
});

test('MySQL: expiry is enforced against the real persisted expires_at, not just service-side clock state', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);
  // Force the persisted row to already be expired, independent of the
  // service's own in-process clock, to prove the DB layer's own guard
  // (expires_at > ? in consumeAtomically) is real, not just the service's
  // pre-check.
  await getPool().query(`UPDATE device_challenges SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE challenge_id = ?`, [issued.challengeId]);
  const error = await authService.verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce)).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'EXPIRED');
});

test('MySQL: revoking the device after challenge issuance blocks verification even with a correct signature', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const issued = await authService.issueChallenge(device.deviceId);
  await directoryService.revokeDevice(device.familyId, device.deviceId);
  const error = await authService.verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce)).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'DEVICE_REVOKED');
});

test('MySQL: a DEK can never satisfy a device-authentication challenge, only the DSK, against real persisted key rows', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const authService = buildAuthService();
  const dekPublicKey = key();
  await directoryService.addDeviceKey(device.familyId, device.deviceId, dekPublicKey, 'DEK');

  const issued = await authService.issueChallenge(device.deviceId);
  const dekError = await authService.verifyChallenge(issued.challengeId, sign(dekPublicKey, issued.nonce)).catch((e) => e);
  assert.ok(dekError instanceof DeviceAuthError);
  assert.equal(dekError.code, 'INVALID_SIGNATURE');

  // Sanity: the challenge is still live -- the DEK attempt must not have consumed it.
  const identity = await authService.verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce));
  assert.equal(identity.deviceId, device.deviceId);
});

test('MySQL: a signature valid for a DIFFERENT device\'s real persisted DSK is rejected -- the challenge is bound to the device it was issued for', async () => {
  const authService = buildAuthService();
  const { device: deviceA } = await registerDeviceWithDsk();
  const { dskPublicKey: dskB } = await registerDeviceWithDsk();

  const issuedForA = await authService.issueChallenge(deviceA.deviceId);
  const error = await authService.verifyChallenge(issuedForA.challengeId, sign(dskB, issuedForA.nonce)).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');
});

test('MySQL: DEVICE_CHALLENGE_TTL_MS is genuinely short (sanity bound, catches an accidental policy regression)', () => {
  assert.ok(DEVICE_CHALLENGE_TTL_MS <= 5 * 60 * 1000, 'a device-auth challenge must stay short-lived');
  assert.ok(DEVICE_CHALLENGE_TTL_MS > 0);
});

test.after(async () => {
  await closePool();
});
