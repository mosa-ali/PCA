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

test('MySQL: exact DSK revocation immediately before challenge consumption rejects proof without consuming challenge', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const [dsk] = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  assert.equal(dsk.keyPurpose, 'DSK');
  const issued = await buildAuthService().issueChallenge(device.deviceId);
  const racingChallengeRepository = {
    create: (...args) => challengeRepository.create(...args),
    findById: (...args) => challengeRepository.findById(...args),
    async consumeAtomically(challengeId, consumedAt, verifiedSigner) {
      // Force the production key revocation to commit after signature
      // verification/initial DSK lookup but before the repository's locked
      // signer-key revalidation and challenge consume.
      const revoked = await directoryService.revokeKey(device.familyId, device.deviceId, dsk.keyId);
      assert.equal(revoked.status, 'REVOKED');
      return challengeRepository.consumeAtomically(challengeId, consumedAt, verifiedSigner);
    },
  };
  const verifier = { async verify(publicKey, message, signature) { return signature === sign(publicKey, message); } };
  const authService = new DeviceAuthService(racingChallengeRepository, deviceRepository, verifier);

  const error = await authService.verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce)).catch((e) => e);
  assert.ok(error instanceof DeviceAuthError);
  assert.equal(error.code, 'INVALID_SIGNATURE');
  const stored = await challengeRepository.findById(issued.challengeId);
  assert.equal(stored.consumedAt, null, 'a stale signer must not consume the valid challenge');
  const currentKeys = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  assert.equal(currentKeys.find((key) => key.keyId === dsk.keyId).status, 'REVOKED');
});

test('MySQL: challenge consume binds key id and public key exactly, not merely any active DSK on the device', async () => {
  const { device } = await registerDeviceWithDsk();
  const [dsk] = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  const issued = await buildAuthService().issueChallenge(device.deviceId);

  const result = await challengeRepository.consumeAtomically(issued.challengeId, new Date(), {
    familyId: device.familyId,
    deviceId: device.deviceId,
    keyId: dsk.keyId,
    publicKey: `${dsk.publicKey}-substituted`,
  });
  assert.equal(result.outcome, 'SIGNER_KEY_INACTIVE');
  const stored = await challengeRepository.findById(issued.challengeId);
  assert.equal(stored.consumedAt, null);
});

test('MySQL: challenge consume snapshots a valid DATETIME clock before awaiting and rejects invalid clocks without consuming', async () => {
  const { device } = await registerDeviceWithDsk();
  const [dsk] = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  const issued = await buildAuthService().issueChallenge(device.deviceId);
  const consumedAt = new Date();
  const expectedConsumedAt = new Date(consumedAt.getTime());
  const consuming = challengeRepository.consumeAtomically(issued.challengeId, consumedAt, {
    familyId: device.familyId,
    deviceId: device.deviceId,
    keyId: dsk.keyId,
    publicKey: dsk.publicKey,
  });
  // Mutate the original after the repository has captured its snapshot but
  // while connection acquisition/SQL execution may still be pending.
  consumedAt.setFullYear(10000);
  const outcome = await consuming;
  assert.equal(outcome.outcome, 'CONSUMED');
  const stored = await challengeRepository.findById(issued.challengeId);
  assert.equal(stored.consumedAt.toISOString(), expectedConsumedAt.toISOString());

  const second = await buildAuthService().issueChallenge(device.deviceId);
  const invalid = await challengeRepository.consumeAtomically(second.challengeId, new Date(Number.NaN), {
    familyId: device.familyId,
    deviceId: device.deviceId,
    keyId: dsk.keyId,
    publicKey: dsk.publicKey,
  });
  assert.equal(invalid.outcome, 'EXPIRED');
  assert.equal((await challengeRepository.findById(second.challengeId)).consumedAt, null);
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

test('MySQL CONCURRENCY: challenge proof waits for device-wide revocation and is not consumed in the key-cascade window', async () => {
  const { device, dskPublicKey } = await registerDeviceWithDsk();
  const [dsk] = await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
  const issued = await buildAuthService().issueChallenge(device.deviceId);
  const pool = getPool();
  const originalGetConnectionMethod = pool.getConnection;
  const originalGetConnection = pool.getConnection.bind(pool);
  let signalDeviceLockAttempt;
  const deviceLockAttempted = new Promise((resolve) => { signalDeviceLockAttempt = resolve; });
  let lockQueryObserved = false;
  const lockHolder = await originalGetConnection();
  let revocationCommitted = false;

  try {
    await lockHolder.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await lockHolder.beginTransaction();
    // Match the first durable mutation in revokeDeviceAndKeysAtomically, then
    // hold its device-row lock before the cascading public-key UPDATE.
    await lockHolder.query(
      `UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3)
        WHERE device_id = ? AND family_id = ? AND status != 'REVOKED'`,
      [device.deviceId, device.familyId],
    );

    pool.getConnection = async (...args) => {
      const connection = await originalGetConnection(...args);
      const originalQuery = connection.query.bind(connection);
      connection.query = (sql, ...queryArgs) => {
        const statement = typeof sql === 'string' ? sql : sql?.sql ?? '';
        const normalized = statement.replace(/\s+/g, ' ').toUpperCase();
        const result = originalQuery(sql, ...queryArgs);
        if (normalized.includes('FROM DEVICES') && normalized.includes('FOR UPDATE')) {
          lockQueryObserved = true;
          signalDeviceLockAttempt();
        }
        return result;
      };
      return connection;
    };

    const verification = buildAuthService().verifyChallenge(issued.challengeId, sign(dskPublicKey, issued.nonce))
      .then((identity) => ({ identity }), (error) => ({ error }));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('challenge consumption did not attempt the device-row lock')), 5000);
      deviceLockAttempted.then(() => { clearTimeout(timer); resolve(); });
    });
    assert.equal(lockQueryObserved, true);

    // The SELECT ... FOR UPDATE has been sent while the revoke transaction
    // still owns that row; it must remain pending until revocation commits.
    const settledBeforeRelease = await Promise.race([
      verification.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    assert.equal(settledBeforeRelease, false, 'proof consumption must serialize behind the in-flight device revocation');

    await lockHolder.query(
      `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
        WHERE device_id = ? AND key_id = ? AND status = 'ACTIVE'`,
      [device.deviceId, dsk.keyId],
    );
    await lockHolder.commit();
    revocationCommitted = true;
    const result = await verification;
    assert.ok(result.error instanceof DeviceAuthError);
    assert.equal(result.error.code, 'INVALID_SIGNATURE');
    assert.equal((await challengeRepository.findById(issued.challengeId)).consumedAt, null,
      'the challenge must remain available because revoked-device proof was not accepted');
    assert.equal((await deviceRepository.findDeviceForFamily(device.familyId, device.deviceId)).status, 'REVOKED');
    assert.equal((await deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId))
      .find((key) => key.keyId === dsk.keyId).status, 'REVOKED');
  } finally {
    pool.getConnection = originalGetConnectionMethod;
    if (!revocationCommitted) await lockHolder.rollback().catch(() => {});
    lockHolder.release();
  }
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
