import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PlatformAdminAccountService, PlatformAdminAccountError } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { createInMemoryPlatformAdminAuthRepository } from '../support/inMemoryPlatformAdminAuthRepository.mjs';

function buildService() {
  const repository = createInMemoryPlatformAdminAuthRepository();
  const service = new PlatformAdminAccountService(repository);
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

test('duplicate email is rejected generically (DB unique constraint surfaced through the domain error)', async () => {
  const { service } = buildService();
  const email = `dup-${randomUUID()}@example.test`;
  await service.createAccount('First', hashAdminEmail(email), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(
    () => service.createAccount('Second', hashAdminEmail(email), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP'),
    PlatformAdminAccountError,
  );
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
