import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import {
  canonicalizeP256Signature,
  isCanonicalBase64Url,
  isCanonicalP256Signature,
  P256DeviceSignatureVerifier,
  P256_ORDER,
} from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { DeviceRepositoryFamilyAuthorityKeyResolver } from '../../dist/familycommercial/authority/FamilyAuthorityKeyResolver.js';
import {
  ATTESTATION_CLOCK_SKEW_MS,
  MAX_ATTESTATION_AGE_MS,
  MAX_ATTESTATION_TTL_MS,
  MIN_ATTESTATION_TTL_MS,
  hasSaneAttestationTemporalPolicy,
} from '../../dist/familycommercial/authority/policy.js';
import { ParentAccountError, ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { InMemoryGenesisStepUpRepository } from '../../dist/parentaccount/InMemoryGenesisStepUpRepository.js';
import { hashGenesisSessionId } from '../../dist/parentaccount/sessionBinding.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { createInMemoryParentAccountRepository } from '../support/inMemoryParentAccountRepository.mjs';

const EMAIL = 'parent@example.com';
const PASSWORD = 'correct horse battery staple';

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }

  async sendVerificationCode(email, code) {
    this.sent.push({ email, code, kind: 'VERIFICATION' });
  }

  async sendPasswordResetCode(email, code) {
    this.sent.push({ email, code, kind: 'PASSWORD_RESET' });
  }

  async sendLoginStepUpCode(email, code) {
    this.sent.push({ email, code, kind: 'LOGIN_STEP_UP' });
  }

  async sendGenesisStepUpCode(email, code) {
    this.sent.push({ email, code, kind: 'GENESIS_STEP_UP' });
  }

  lastCodeFor(email, kind) {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const entry = this.sent[index];
      if (entry.email === email && entry.kind === kind) return entry.code;
    }
    return null;
  }
}

function keyMaterial() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { pair, publicKey };
}

function sign(privateKey, message) {
  return canonicalizeP256Signature(cryptoSign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
}

function scalarBytes(value) {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

function buildHarness() {
  let currentTime = new Date('2026-08-15T00:00:00.000Z').getTime();
  const now = () => new Date(currentTime);
  const advance = (milliseconds) => {
    currentTime += milliseconds;
  };
  const authRepository = createInMemoryAuthRepository();
  const authService = new AuthService(authRepository, now);
  const parentRepository = createInMemoryParentAccountRepository({
    revokeAllSessionsForAccount: (accountId, revokedAt) => authRepository._revokeAllSessionsForAccountTest(accountId, revokedAt),
  });
  const emailSender = new RecordingEmailSender();
  const stepUpRepository = new InMemoryGenesisStepUpRepository();
  const parentGenesisService = {
    async begin(input) {
      return input;
    },
  };
  const service = new ParentAccountService({
    repository: parentRepository,
    authService,
    emailSender,
    genesisStepUpRepository: stepUpRepository,
    parentGenesisService,
    now,
  });
  return { service, authService, parentRepository, emailSender, stepUpRepository, now, advance };
}

async function registerAndVerify(harness) {
  await harness.service.register(EMAIL, PASSWORD, PASSWORD);
  const verificationCode = harness.emailSender.lastCodeFor(EMAIL, 'VERIFICATION');
  assert.ok(verificationCode);
  return harness.service.verifyEmail(EMAIL, verificationCode);
}

test('R2 low-S P1363 verifier accepts canonical signatures and rejects malleated/high-S variants', async () => {
  const { pair, publicKey } = keyMaterial();
  const message = 'PCA-DEC-020-R2';
  const lowSignature = sign(pair.privateKey, message);
  const highSignature = Buffer.from(lowSignature);
  const lowS = BigInt(`0x${lowSignature.subarray(32).toString('hex')}`);
  scalarBytes(P256_ORDER - lowS).copy(highSignature, 32);
  const verifier = new P256DeviceSignatureVerifier();

  assert.equal(await verifier.verify(publicKey, message, lowSignature.toString('base64url')), true);
  assert.equal(await verifier.verify(publicKey, message, highSignature.toString('base64url')), false);
  assert.equal(isCanonicalP256Signature(lowSignature.toString('base64url')), true);
  assert.equal(isCanonicalP256Signature(highSignature.toString('base64url')), false);

  const zeroR = Buffer.from(lowSignature);
  zeroR.fill(0, 0, 32);
  assert.equal(isCanonicalP256Signature(zeroR.toString('base64url')), false);
  const orderR = Buffer.from(lowSignature);
  scalarBytes(P256_ORDER).copy(orderR, 0);
  assert.equal(isCanonicalP256Signature(orderR.toString('base64url')), false);
});

test('R2 strict base64url validation rejects noncanonical trailing bits while accepting exact 32-byte wire values', () => {
  const canonical = Buffer.from('01234567890123456789012345678901', 'utf8').toString('base64url');
  const noncanonical = `${canonical.slice(0, -1)}F`;
  assert.equal(canonical.length, 43);
  assert.equal(isCanonicalBase64Url(canonical, 32), true);
  assert.equal(isCanonicalBase64Url(noncanonical, 32), false);
  assert.equal(isCanonicalBase64Url(`${canonical}=`, 32), false);
  assert.equal(isCanonicalBase64Url(canonical.slice(0, -1), 32), false);
});

test('R2 shared temporal policy enforces server-time freshness, skew, and bounded TTL', () => {
  const now = new Date('2026-08-15T00:00:00.000Z');
  const at = (milliseconds) => new Date(now.getTime() + milliseconds);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MIN_ATTESTATION_TTL_MS), now), true);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MAX_ATTESTATION_TTL_MS), now), true);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MAX_ATTESTATION_TTL_MS + 1), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(now, at(MIN_ATTESTATION_TTL_MS - 1), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(at(ATTESTATION_CLOCK_SKEW_MS), at(ATTESTATION_CLOCK_SKEW_MS + MIN_ATTESTATION_TTL_MS), now), true);
  assert.equal(hasSaneAttestationTemporalPolicy(at(ATTESTATION_CLOCK_SKEW_MS + 1), at(ATTESTATION_CLOCK_SKEW_MS + 1 + MIN_ATTESTATION_TTL_MS), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(at(-MAX_ATTESTATION_AGE_MS - 1), at(1), now), false);
  assert.equal(hasSaneAttestationTemporalPolicy(at(-1), at(1), now), false);
});

test('R2 family authority key resolution requires ACTIVE device and ACTIVE DSK', async () => {
  const states = ['PAIRING_PENDING', 'PAIRED', 'ACTIVE', 'REVOKED'];
  let currentStatus = 'PAIRING_PENDING';
  const resolver = new DeviceRepositoryFamilyAuthorityKeyResolver({
    async findDeviceForFamily(_familyId, _deviceId) {
      return { deviceId: 'device-1', familyId: 'family-1', platform: 'BROWSER', status: currentStatus, createdAt: new Date(), revokedAt: null, pairedAt: null, pairedByAccountId: null, registeredByAccountId: null };
    },
    async findKeysByDeviceForFamily() {
      return [{ deviceId: 'device-1', keyId: 'key-1', keyPurpose: 'DSK', publicKey: 'public-key', status: 'ACTIVE', createdAt: new Date(), revokedAt: null }];
    },
  });
  for (const status of states) {
    currentStatus = status;
    const result = await resolver.isActiveDsk({ familyId: 'family-1', deviceId: 'device-1', keyId: 'key-1', publicKey: 'public-key' });
    assert.equal(result, status === 'ACTIVE', status);
  }
});

test('R2 genesis authorization requires the exact authenticated session, password re-auth, and fresh mailbox code', async () => {
  const harness = buildHarness();
  const firstSession = await registerAndVerify(harness);
  const { publicKey } = keyMaterial();

  await assert.rejects(
    () => harness.service.beginGenesisChallenge(firstSession.rawSessionToken, { publicKey, platform: 'BROWSER' }),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
  await assert.rejects(
    () => harness.service.requestGenesisStepUp(firstSession.rawSessionToken, EMAIL, 'wrong password'),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
  assert.equal(harness.emailSender.lastCodeFor(EMAIL, 'GENESIS_STEP_UP'), null);

  await harness.service.requestGenesisStepUp(firstSession.rawSessionToken, EMAIL, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'GENESIS_STEP_UP');
  assert.ok(code);
  await assert.rejects(
    () => harness.service.completeGenesisStepUp(firstSession.rawSessionToken, '000000'),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
  await harness.service.completeGenesisStepUp(firstSession.rawSessionToken, code);
  const challenge = await harness.service.beginGenesisChallenge(firstSession.rawSessionToken, { publicKey, platform: 'BROWSER' });
  assert.equal(challenge.publicKey, publicKey);
  assert.equal(typeof challenge.accountId, 'string');

  const secondSession = await harness.service.login(EMAIL, PASSWORD);
  await assert.rejects(
    () => harness.service.beginGenesisChallenge(secondSession.rawSessionToken, { publicKey, platform: 'BROWSER' }),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );

  const firstRecord = await harness.authService.validateSessionRecord(firstSession.rawSessionToken);
  const parentAccount = await harness.parentRepository.findByServiceAccountId(firstRecord.accountId);
  assert.ok(parentAccount);
  const verifiedAuthorization = await harness.stepUpRepository.findVerifiedForSession({
    accountId: parentAccount.accountId,
    serviceAccountId: firstRecord.accountId,
    sessionIdHash: hashGenesisSessionId(firstRecord.sessionId),
    now: harness.now(),
  });
  assert.ok(verifiedAuthorization);
  assert.equal(await harness.stepUpRepository.consumeAtomically({
    authorizationId: verifiedAuthorization.authorizationId,
    accountId: parentAccount.accountId,
    serviceAccountId: firstRecord.accountId,
    sessionIdHash: hashGenesisSessionId(firstRecord.sessionId),
    operation: 'FAMILY_GENESIS',
    consumedAt: harness.now(),
  }), true);
  assert.equal(await harness.stepUpRepository.consumeAtomically({
    authorizationId: verifiedAuthorization.authorizationId,
    accountId: parentAccount.accountId,
    serviceAccountId: firstRecord.accountId,
    sessionIdHash: hashGenesisSessionId(firstRecord.sessionId),
    operation: 'FAMILY_GENESIS',
    consumedAt: harness.now(),
  }), false);
});

test('R2 genesis mailbox authorization expires before it can authorize a challenge', async () => {
  const harness = buildHarness();
  const session = await registerAndVerify(harness);
  await harness.service.requestGenesisStepUp(session.rawSessionToken, EMAIL, PASSWORD);
  const code = harness.emailSender.lastCodeFor(EMAIL, 'GENESIS_STEP_UP');
  harness.advance(10 * 60 * 1000 + 1);
  await assert.rejects(
    () => harness.service.completeGenesisStepUp(session.rawSessionToken, code),
    (error) => error instanceof ParentAccountError && error.code === 'UNAUTHORIZED',
  );
});
