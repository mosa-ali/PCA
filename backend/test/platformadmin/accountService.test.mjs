import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PlatformAdminAccountService, PlatformAdminAccountError } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, decryptTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { createInMemoryPlatformAdminAuthRepository } from '../support/inMemoryPlatformAdminAuthRepository.mjs';

process.env.PLATFORM_ADMIN_MFA_ENC_KEY ??= 'ab'.repeat(32);

function buildService(now = () => new Date()) {
  const repository = createInMemoryPlatformAdminAuthRepository();
  const service = new PlatformAdminAccountService(repository, now);
  return { repository, service };
}

test('createAccount via BOOTSTRAP succeeds and seeds MFA PENDING_SETUP', async () => {
  const { repository, service } = buildService();
  const email = `owner-${randomUUID()}@example.test`;
  const account = await service.createAccount('Owner', hashAdminEmail(email), 'password-value', 'APP_OWNER', 'BOOTSTRAP');
  assert.equal(account.status, 'ACTIVE');
  const mfa = await repository.getMfaState(account.adminId);
  assert.equal(mfa.status, 'PENDING_SETUP');
});

test('createAccount by an actor lacking MANAGE_ADMIN_ACCOUNTS is rejected generically', async () => {
  const { service } = buildService();
  const actor = { adminId: randomUUID(), roles: ['SUPPORT_ADMIN'] };
  await assert.rejects(
    () => service.createAccount('Someone', hashAdminEmail('x@example.test'), 'password-value', 'SUPPORT_ADMIN', actor),
    PlatformAdminAccountError,
  );
});

test('createAccount by an APP_OWNER actor succeeds', async () => {
  const { service } = buildService();
  const actor = { adminId: randomUUID(), roles: ['APP_OWNER'] };
  await assert.doesNotReject(() => service.createAccount('Someone', hashAdminEmail(`y-${randomUUID()}@example.test`), 'password-value', 'SUPPORT_ADMIN', actor));
});

test('beginMfaEnrollment refuses a malformed configured legacy key BEFORE writing anything', async () => {
  // REVIEWER FINDING (Codex, CODEX_20260923T202742Z_e1d2e5e1): the malformed-key
  // negative test covered only ActivationService.start. This is the OTHER sealing
  // site, and it had the same defect -- sealing with the active key alone, while
  // activateMfa validates the whole ring. A malformed PREVIOUS_1 therefore let the
  // write land and the enrollment burn, with recovery possible only by reissue.
  const { repository, service } = buildService();
  const actor = { adminId: randomUUID(), roles: ['APP_OWNER'] };
  const account = await service.createAccount('Owner', hashAdminEmail(`enroll-${randomUUID()}@example.test`), 'password-value', 'APP_OWNER', 'BOOTSTRAP');
  assert.equal((await repository.getMfaState(account.adminId)).status, 'PENDING_SETUP');

  process.env.PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1 = 'not-hex';
  try {
    await assert.rejects(() => service.beginMfaEnrollment(account.adminId, actor));
    // The refusal must come BEFORE the write, so the operator can fix the
    // configuration and retry rather than being sent to a reissue.
    const mfa = await repository.getMfaState(account.adminId);
    assert.equal(mfa.totpSecretCiphertext, null);
    assert.equal(mfa.totpSecretNonce, null);
    assert.equal(mfa.status, 'PENDING_SETUP');
  } finally {
    // The ring is read from process.env, so the malformed slot must not leak into
    // any later test in this file.
    delete process.env.PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1;
  }
});

test('duplicate email is rejected generically (DB unique constraint surfaced through the domain error)', async () => {
  const { service } = buildService();
  const email = `dup-${randomUUID()}@example.test`;
  await service.createAccount('First', hashAdminEmail(email), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(
    () => service.createAccount('Second', hashAdminEmail(email), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP'),
    PlatformAdminAccountError,
  );
});

test('MFA enrollment stores an encrypted secret and returns a one-time URI', async () => {
  const now = new Date('2026-09-14T12:00:00.000Z');
  const { repository, service } = buildService(() => now);
  const account = await service.createAccount('Real Platform Admin', hashAdminEmail(`mfa-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');

  const result = await service.beginMfaEnrollment(account.adminId, { adminId: randomUUID(), roles: ['APP_OWNER'] });
  assert.match(result.otpauthUri, /^otpauth:\/\/totp\//);
  const state = await repository.getMfaState(account.adminId);
  assert.equal(state.status, 'PENDING_SETUP');
  assert.ok(state.totpSecretCiphertext);
  assert.ok(state.totpSecretNonce);
  assert.equal(repository._auditEvents.some((event) => event.metadata?.otpauthUri), false);
  await assert.rejects(
    () => service.beginMfaEnrollment(account.adminId, { adminId: randomUUID(), roles: ['APP_OWNER'] }),
    PlatformAdminAccountError,
  );
});

test('MFA activation verifies the first TOTP code atomically and audits success', async () => {
  const now = new Date('2026-09-14T12:00:00.000Z');
  const { repository, service } = buildService(() => now);
  const account = await service.createAccount('Real Platform Admin', hashAdminEmail(`activate-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await service.beginMfaEnrollment(account.adminId, { adminId: randomUUID(), roles: ['APP_OWNER'] });
  const state = await repository.getMfaState(account.adminId);
  const secret = decryptTotpSecret(state.totpSecretCiphertext, state.totpSecretNonce, loadMfaEncryptionKey());
  const code = computeTotp(secret, now.getTime());

  await service.activateMfa(account.adminId, code, { adminId: randomUUID(), roles: ['APP_OWNER'] });
  assert.equal((await repository.getMfaState(account.adminId)).status, 'ACTIVE');
  assert.equal(repository._auditEvents.at(-1).eventType, 'ADMIN_MFA_ENROLLED');
  await assert.rejects(
    () => service.activateMfa(account.adminId, code, { adminId: randomUUID(), roles: ['APP_OWNER'] }),
    PlatformAdminAccountError,
  );
});

test('MFA activation rejects an invalid code and leaves the factor pending', async () => {
  const { repository, service } = buildService();
  const account = await service.createAccount('Real Platform Admin', hashAdminEmail(`invalid-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await service.beginMfaEnrollment(account.adminId, { adminId: randomUUID(), roles: ['APP_OWNER'] });
  await assert.rejects(
    () => service.activateMfa(account.adminId, '000000', { adminId: randomUUID(), roles: ['APP_OWNER'] }),
    PlatformAdminAccountError,
  );
  assert.equal((await repository.getMfaState(account.adminId)).status, 'PENDING_SETUP');
});

test('assignRole rejects a duplicate ACTIVE (admin, role) grant', async () => {
  const { service } = buildService();
  const account = await service.createAccount('Grant Target', hashAdminEmail(`grant-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(() => service.assignRole(account.adminId, 'PLATFORM_ADMIN', 'BOOTSTRAP'), PlatformAdminAccountError);
});

test('assignRole allows a different role for the same admin', async () => {
  const { repository, service } = buildService();
  const account = await service.createAccount('Multi Role', hashAdminEmail(`multi-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await service.assignRole(account.adminId, 'SUPPORT_ADMIN', 'BOOTSTRAP');
  const roles = await repository.findActiveRoles(account.adminId);
  assert.deepEqual(new Set(roles), new Set(['PLATFORM_ADMIN', 'SUPPORT_ADMIN']));
});

test('revoking a role leaving zero active roles is allowed (a valid fully-disabled state)', async () => {
  const { repository, service } = buildService();
  const account = await service.createAccount('Solo Role', hashAdminEmail(`solo-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await service.revokeRole(account.adminId, 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const roles = await repository.findActiveRoles(account.adminId);
  assert.deepEqual(roles, []);
});

test('every mutating account operation writes an audit event of the correct type', async () => {
  const { repository, service } = buildService();
  const account = await service.createAccount('Audited', hashAdminEmail(`audited-${randomUUID()}@example.test`), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await service.assignRole(account.adminId, 'SUPPORT_ADMIN', 'BOOTSTRAP');
  await service.revokeRole(account.adminId, 'SUPPORT_ADMIN', 'BOOTSTRAP');
  await service.disableAccount(account.adminId, 'BOOTSTRAP');
  await service.reactivateAccount(account.adminId, 'BOOTSTRAP');

  const types = repository._auditEvents.map((e) => e.eventType);
  assert.ok(types.includes('ADMIN_CREATED'));
  assert.ok(types.filter((t) => t === 'ADMIN_ROLE_CHANGED').length >= 3); // initial grant + assign + revoke
  assert.ok(types.includes('ACCOUNT_SUSPENDED'));
  assert.ok(types.includes('ACCOUNT_REACTIVATED'));
});
