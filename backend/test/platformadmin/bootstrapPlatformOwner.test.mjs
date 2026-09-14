import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../scripts/bootstrap-platform-owner.mjs', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../../src/platformadmin/auth/MySqlAuthRepository.ts', import.meta.url), 'utf8');

test('first-owner bootstrap is lock-serialized and has a zero-owner precondition', () => {
  assert.match(script, /GET_LOCK\(\?, \?\)/);
  assert.match(script, /RELEASE_LOCK\(\?\)/);
  assert.match(script, /await assertNoExistingAppOwner\(lock\)/);
  assert.match(script, /finally \{\s*await releaseBootstrapLock\(lock\)/s);
  assert.match(script, /role = 'APP_OWNER'/);
});

test('first-owner bootstrap starts with a non-login credential and pending MFA', () => {
  assert.match(script, /PENDING_ACTIVATION_CREDENTIAL/);
  assert.match(script, /status: 'PENDING_SETUP'/);
  assert.doesNotMatch(script, /generateRandomPassword|Generated password|otpauthUri|MFA enrollment URI/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(rawToken|token|password|secret|uri)/i);
});

test('account creation remains one repository transaction with role, MFA and audit rows', () => {
  assert.match(repository, /async createAccount\(input: CreateAccountInput\)/);
  const body = repository.slice(repository.indexOf('async createAccount'), repository.indexOf('async findAccountByEmailHash'));
  assert.match(body, /return runInTransaction\(async \(conn\)/);
  assert.match(body, /INSERT INTO platform_admin_accounts/);
  assert.match(body, /INSERT INTO platform_admin_role_assignments/);
  assert.match(body, /INSERT INTO platform_admin_mfa_state/);
  assert.match(body, /insertPlatformAdminAuditEventRow/);
});

test('activation uses the existing hash-only token and encrypted MFA lifecycle', () => {
  const activation = readFileSync(new URL('../../src/platformadmin/auth/PlatformAdminActivationService.ts', import.meta.url), 'utf8');
  const repo = readFileSync(new URL('../../src/platformadmin/auth/MySqlPlatformAdminActivationRepository.ts', import.meta.url), 'utf8');
  assert.match(activation, /generateActivationToken/);
  assert.match(activation, /activationRepository\.issue/);
  assert.match(activation, /encryptTotpSecret/);
  assert.match(activation, /activationRepository\.complete/);
  assert.match(repo, /token_hash/);
  assert.match(repo, /used_at IS NULL/);
  assert.match(repo, /revoked_at IS NULL/);
});
