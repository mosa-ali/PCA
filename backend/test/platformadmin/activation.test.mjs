process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import test from 'node:test';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, base32Decode, decryptTotpSecret } from '../../dist/platformadmin/auth/totp.js';
import { verifyPassword } from '../../dist/platformadmin/auth/passwordCredential.js';
import { PlatformAdminActivationError, PlatformAdminActivationService, generateActivationToken, hashActivationToken } from '../../dist/platformadmin/auth/PlatformAdminActivationService.js';

function harness() {
  const email = 'mdrwesh@outlook.com';
  const account = { adminId: 'admin-1', emailHash: hashAdminEmail(email), displayName: 'Owner', passwordCredential: 'placeholder', status: 'ACTIVE', createdAt: new Date(), disabledAt: null };
  const mfa = { adminId: 'admin-1', status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: new Date(), lastAcceptedTotpCounter: null };
  const tokens = new Map();
  const auth = { findAccountById: async () => account, findActiveRoles: async () => ['PLATFORM_ADMIN'], getMfaState: async () => mfa };
  const repo = {
    issue: async (input) => { for (const t of tokens.values()) if (t.adminId === input.adminId && !t.usedAt && !t.revokedAt) t.revokedAt = input.createdAt; mfa.totpSecretCiphertext = null; mfa.totpSecretNonce = null; mfa.lastAcceptedTotpCounter = null; tokens.set(input.tokenHash, { ...input, usedAt: null, revokedAt: null }); },
    findUsable: async (hash, now) => { const t = tokens.get(hash); if (!t || t.usedAt || t.revokedAt || t.expiresAt <= now) return null; return { token: t, account, mfa }; },
    beginMfa: async (input) => { const t = tokens.get(input.tokenHash); if (!t) return null; mfa.totpSecretCiphertext = input.ciphertext; mfa.totpSecretNonce = input.nonce; return { token: t, account, mfa }; },
    complete: async (input) => { const t = tokens.get(input.tokenHash); if (!t || t.usedAt) return false; account.passwordCredential = input.passwordCredential; mfa.status = 'ACTIVE'; mfa.lastAcceptedTotpCounter = input.acceptedTotpCounter; t.usedAt = input.now; return true; },
  };
  const sent = [];
  const emailSender = { sendVerificationCode: async () => {}, sendPasswordResetCode: async () => {}, sendPlatformAdminActivationLink: async (toEmail, url) => sent.push({ toEmail, url }) };
  let now = new Date('2026-01-01T00:00:00Z');
  const service = new PlatformAdminActivationService(auth, repo, emailSender, { NODE_ENV: 'test', PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL: 'https://www.pcasafe.com/platform-admin/activate', PLATFORM_ADMIN_MFA_ENC_KEY: 'ab'.repeat(32) }, () => now);
  return { service, account, mfa, tokens, sent, now: () => now, setNow: (v) => { now = v; } };
}

test('activation tokens are random and only their SHA-256 digest is issued to persistence', () => {
  const a = generateActivationToken(); const b = generateActivationToken();
  assert.notEqual(a.rawToken, b.rawToken); assert.match(a.rawToken, /^[A-Za-z0-9_-]{43}$/); assert.equal(a.tokenHash, hashActivationToken(a.rawToken)); assert.notEqual(a.tokenHash, a.rawToken);
});

test('first-time activation establishes scrypt password, encrypted TOTP and single-use completion', async () => {
  const h = harness();
  await h.service.issueActivation('admin-1', 'mdrwesh@outlook.com', { adminId: 'owner-1', roles: ['APP_OWNER'] });
  const token = new URL(h.sent[0].url).searchParams.get('token');
  assert.ok(token); assert.equal(h.tokens.size, 1); assert.equal(h.tokens.values().next().value.tokenHash, hashActivationToken(token));
  const started = await h.service.start(token);
  const secret = base32Decode(new URL(started.otpauthUri).searchParams.get('secret'));
  assert.ok(h.mfa.totpSecretCiphertext && h.mfa.totpSecretNonce); assert.deepEqual(decryptTotpSecret(h.mfa.totpSecretCiphertext, h.mfa.totpSecretNonce, Buffer.from('ab'.repeat(32), 'hex')), secret);
  await h.service.complete(token, 'a new owner password', computeTotp(secret, h.now().getTime()));
  assert.equal(h.mfa.status, 'ACTIVE'); assert.equal(await verifyPassword('a new owner password', h.account.passwordCredential), true);
  await assert.rejects(() => h.service.complete(token, 'another password', '000000'), PlatformAdminActivationError);
});

test('APP_OWNER reissue revokes the old token and invalidates abandoned TOTP enrollment', async () => {
  const h = harness();
  await h.service.issueActivation('admin-1', 'mdrwesh@outlook.com', { adminId: 'owner-1', roles: ['APP_OWNER'] });
  const first = new URL(h.sent[0].url).searchParams.get('token');
  await h.service.start(first);
  await h.service.issueActivation('admin-1', 'mdrwesh@outlook.com', { adminId: 'owner-1', roles: ['APP_OWNER'] });
  const second = new URL(h.sent[1].url).searchParams.get('token');
  assert.notEqual(first, second);
  assert.equal(h.mfa.totpSecretCiphertext, null);
  await assert.rejects(() => h.service.start(first), PlatformAdminActivationError);
  await assert.doesNotReject(() => h.service.start(second));
});

test('a malformed configured legacy key refuses start BEFORE anything is persisted', async () => {
  const email = 'mdrwesh@outlook.com';
  const account = { adminId: 'admin-1', emailHash: hashAdminEmail(email), displayName: 'Owner', passwordCredential: 'placeholder', status: 'ACTIVE', createdAt: new Date(), disabledAt: null };
  const mfa = { adminId: 'admin-1', status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: new Date(), lastAcceptedTotpCounter: null };
  const tokens = new Map();
  let beginCalls = 0;
  const auth = { findAccountById: async () => account, findActiveRoles: async () => ['PLATFORM_ADMIN'], getMfaState: async () => mfa };
  const repo = {
    issue: async (input) => { tokens.set(input.tokenHash, { ...input, usedAt: null, revokedAt: null }); },
    findUsable: async (hash, now) => { const t = tokens.get(hash); if (!t || t.usedAt || t.revokedAt || t.expiresAt <= now) return null; return { token: t, account, mfa }; },
    beginMfa: async (input) => { beginCalls += 1; mfa.totpSecretCiphertext = input.ciphertext; mfa.totpSecretNonce = input.nonce; return { token: tokens.get(input.tokenHash), account, mfa }; },
    complete: async () => false,
  };
  const sent = [];
  const emailSender = { sendVerificationCode: async () => {}, sendPasswordResetCode: async () => {}, sendPlatformAdminActivationLink: async (toEmail, url) => sent.push({ toEmail, url }) };
  const service = new PlatformAdminActivationService(auth, repo, emailSender, {
    NODE_ENV: 'test',
    PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL: 'https://www.pcasafe.com/platform-admin/activate',
    PLATFORM_ADMIN_MFA_ENC_KEY: 'ab'.repeat(32),
    PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1: 'not-hex',
  }, () => new Date('2026-01-01T00:00:00Z'));

  await service.issueActivation('admin-1', email, { adminId: 'owner-1', roles: ['APP_OWNER'] });
  const token = new URL(sent[0].url).searchParams.get('token');

  // start() seals with the active key, so validating only that key would let this
  // succeed and hand out a QR -- and complete() would then fail on the ring,
  // burning the enrollment and forcing a reissue. Refusing here means the operator
  // fixes the configuration and retries the SAME link.
  await assert.rejects(() => service.start(token));
  assert.equal(beginCalls, 0);
  assert.equal(mfa.totpSecretCiphertext, null);
});
