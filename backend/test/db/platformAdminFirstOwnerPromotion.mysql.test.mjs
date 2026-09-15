// PCA-PA-1 owner architecture decision (2026-09-15): real-MySQL proof of
// the "grant APP_OWNER to an existing, already-ACTIVE Platform Admin"
// first-owner path (backend/scripts/promote-first-app-owner.mjs,
// backend/src/platformadmin/auth/MySqlFirstOwnerPromotionRepository.ts).
//
// Registered in package.json's shared "test:db" script (required by the
// anti-orphan gate test/meta/testSuiteRegistration.test.mjs) and safe to
// run there, interleaved with other files against one never-reset
// database: every test that needs the real "ACTIVE_APP_OWNER_COUNT=0"
// precondition calls forceZeroActiveAppOwners() first (mirroring
// platformAdminBootstrap.mysql.test.mjs's own established pattern) rather
// than assuming it already holds.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import { closePool, getPool, isDuplicateEntry } from '../../dist/db/pool.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { authorizePlatformAdminOperation } from '../../dist/platformadmin/auth/rbacPolicy.js';
import {
  promoteExistingAccountToFirstOwner,
  FirstOwnerPromotionError,
} from '../../dist/platformadmin/auth/MySqlFirstOwnerPromotionRepository.js';
import { generateTotpSecret, encryptTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { runPromotion } from '../../scripts/promote-first-app-owner.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const execFileAsync = promisify(execFile);
const repository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(repository);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function forceZeroActiveAppOwners() {
  await getPool().query(`UPDATE platform_admin_role_assignments SET revoked_at = NOW(3) WHERE role = 'APP_OWNER' AND revoked_at IS NULL`);
  const [[{ c }]] = await getPool().query(
    `SELECT COUNT(*) AS c FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(Number(c), 0, 'ACTIVE_APP_OWNER_COUNT=0 must hold after forcing it');
}

async function revokeAllActiveAppOwners() {
  await getPool().query(`UPDATE platform_admin_role_assignments SET revoked_at = NOW(3) WHERE role = 'APP_OWNER' AND revoked_at IS NULL`);
}

async function snapshotAdmin(adminId) {
  const [[account]] = await getPool().query(
    `SELECT status, display_name, password_credential, disabled_at FROM platform_admin_accounts WHERE admin_id = ?`,
    [adminId],
  );
  const [roles] = await getPool().query(
    `SELECT role, revoked_at, granted_by_admin_id FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL ORDER BY role`,
    [adminId],
  );
  const [[mfa]] = await getPool().query(
    `SELECT status, HEX(totp_secret_ciphertext) AS ciphertext_hex, HEX(totp_secret_nonce) AS nonce_hex, activated_at FROM platform_admin_mfa_state WHERE admin_id = ?`,
    [adminId],
  );
  return {
    account: { status: account.status, displayName: account.display_name, passwordCredential: account.password_credential, disabledAt: account.disabled_at ? account.disabled_at.toISOString() : null },
    roles: roles.map((r) => r.role).sort(),
    mfa: { status: mfa.status, ciphertextHex: mfa.ciphertext_hex, nonceHex: mfa.nonce_hex, activatedAt: mfa.activated_at ? mfa.activated_at.toISOString() : null },
  };
}

async function runPromotionSubprocess(email) {
  return execFileAsync('node', ['scripts/promote-first-app-owner.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, FIRST_OWNER_PROMOTION_EMAIL: email },
  }).catch((error) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code }));
}

async function runBootstrapSubprocess(email) {
  return execFileAsync('node', ['scripts/bootstrap-platform-owner.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PLATFORM_ADMIN_BOOTSTRAP_EMAIL: email },
  }).catch((error) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code }));
}

test('EXISTING_PLATFORM_ADMIN_PROMOTION: grants APP_OWNER to an existing ACTIVE Platform Admin while preserving everything else (PENDING_SETUP MFA case, matching the real target scenario)', async () => {
  await forceZeroActiveAppOwners();

  const email = uniqueEmail('existing-pa-pending-mfa');
  const account = await accountService.createAccount('Existing Platform Admin', hashAdminEmail(email), 'existing platform admin passphrase 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const before = await snapshotAdmin(account.adminId);
  assert.deepEqual(before.roles, ['PLATFORM_ADMIN']);
  assert.equal(before.mfa.status, 'PENDING_SETUP');

  const result = await promoteExistingAccountToFirstOwner({
    emailHash: hashAdminEmail(email),
    assignmentId: randomUUID(),
    grantedAt: new Date(),
    auditEventId: randomUUID(),
    correlationId: randomUUID(),
  });

  assert.equal(result.adminId, account.adminId, 'ACCOUNT_ID_UNCHANGED');
  assert.deepEqual([...result.previousRoles].sort(), ['PLATFORM_ADMIN']);
  assert.deepEqual([...result.newRoles].sort(), ['APP_OWNER', 'PLATFORM_ADMIN']);

  const after = await snapshotAdmin(account.adminId);
  assert.deepEqual(after.roles, ['APP_OWNER', 'PLATFORM_ADMIN'], 'APP_OWNER_ROLE_ADDED + PLATFORM_ADMIN_ROLE_PRESERVED');
  assert.equal(after.account.status, before.account.status);
  assert.equal(after.account.passwordCredential, before.account.passwordCredential, 'PASSWORD_UNCHANGED');
  assert.deepEqual(after.mfa, before.mfa, 'MFA_STATE_PRESERVED (PENDING_SETUP, still no secret material)');

  const [[{ c: accountCount }]] = await getPool().query(`SELECT COUNT(*) AS c FROM platform_admin_accounts WHERE admin_id = ?`, [account.adminId]);
  assert.equal(Number(accountCount), 1, 'ACCOUNT_COUNT_UNCHANGED (still exactly one row for this admin_id)');

  // AUDIT
  const [auditRows] = await getPool().query(
    `SELECT event_type, metadata_json FROM platform_admin_audit_events WHERE target_ref = ? AND event_type = 'ADMIN_ROLE_CHANGED' ORDER BY occurred_at DESC LIMIT 1`,
    [`admin:${account.adminId}`],
  );
  assert.equal(auditRows.length, 1);
  const metadata = typeof auditRows[0].metadata_json === 'string' ? JSON.parse(auditRows[0].metadata_json) : auditRows[0].metadata_json;
  assert.equal(metadata.source, 'FIRST_OWNER_PROMOTION');
  assert.equal(metadata.role, 'APP_OWNER');
  assert.deepEqual([...metadata.previousRoles].sort(), ['PLATFORM_ADMIN']);
  assert.deepEqual([...metadata.newRoles].sort(), ['APP_OWNER', 'PLATFORM_ADMIN']);

  console.log('EXISTING_PLATFORM_ADMIN_PROMOTION=PASS');
  console.log('PLATFORM_ADMIN_ROLE_PRESERVED=PASS');
  console.log('APP_OWNER_ROLE_ADDED=PASS');
  console.log('ACCOUNT_COUNT_UNCHANGED=PASS');
  console.log('ACCOUNT_ID_UNCHANGED=PASS');
  console.log('PASSWORD_UNCHANGED=PASS');
  console.log('MFA_STATE_PRESERVED=PASS');
  console.log('AUDIT=PASS');

  await revokeAllActiveAppOwners();
});

test('EXISTING_PLATFORM_ADMIN_PROMOTION with ACTIVE MFA already enrolled: still preserved byte-for-byte', async () => {
  await forceZeroActiveAppOwners();

  const email = uniqueEmail('existing-pa-active-mfa');
  const account = await accountService.createAccount('Existing Active-MFA Admin', hashAdminEmail(email), 'another strong passphrase 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, loadMfaEncryptionKey());
  await getPool().query(`UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`, [ciphertext, nonce, account.adminId]);
  const before = await snapshotAdmin(account.adminId);
  assert.equal(before.mfa.status, 'ACTIVE');
  assert.ok(before.mfa.ciphertextHex);

  await promoteExistingAccountToFirstOwner({
    emailHash: hashAdminEmail(email),
    assignmentId: randomUUID(),
    grantedAt: new Date(),
    auditEventId: randomUUID(),
    correlationId: randomUUID(),
  });

  const after = await snapshotAdmin(account.adminId);
  assert.deepEqual(after.mfa, before.mfa, 'MFA_STATE_PRESERVED (ACTIVE, real encrypted secret untouched)');
  assert.deepEqual(after.roles, ['APP_OWNER', 'PLATFORM_ADMIN']);

  console.log('MFA_STATE_PRESERVED_ACTIVE_CASE=PASS');
  await revokeAllActiveAppOwners();
});

test('SECOND_ADMIN_NOT_OWNER: a separate Platform Admin never automatically inherits APP_OWNER', async () => {
  await forceZeroActiveAppOwners();
  const email = uniqueEmail('second-admin');
  const account = await accountService.createAccount('Second Admin', hashAdminEmail(email), 'yet another passphrase 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const roles = await repository.findActiveRoles(account.adminId);
  assert.deepEqual(roles, ['PLATFORM_ADMIN']);
  console.log('SECOND_ADMIN_NOT_OWNER=PASS');
});

test('MULTI_ROLE_AUTHORIZATION + ROLE_ORDER_INDEPENDENCE: authorizePlatformAdminOperation evaluates the full role set, never roles[0]', () => {
  // MANAGE_ADMIN_ACCOUNTS: APP_OWNER=ALLOW, PLATFORM_ADMIN=DENY (per rbacPolicy.ts's matrix).
  // A multi-role admin must ALLOW because APP_OWNER is present, regardless of array order.
  assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN', 'APP_OWNER'], 'MANAGE_ADMIN_ACCOUNTS'), 'ALLOW');
  assert.equal(authorizePlatformAdminOperation(['APP_OWNER', 'PLATFORM_ADMIN'], 'MANAGE_ADMIN_ACCOUNTS'), 'ALLOW');
  // A single-role PLATFORM_ADMIN must still DENY on the same operation -- proves this isn't a blanket ALLOW.
  assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN'], 'MANAGE_ADMIN_ACCOUNTS'), 'DENY');
  // ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS: both roles individually ALLOW -- order-independence check on an operation neither role uniquely gates.
  assert.equal(authorizePlatformAdminOperation(['PLATFORM_ADMIN', 'APP_OWNER'], 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS'), 'ALLOW');
  assert.equal(authorizePlatformAdminOperation(['APP_OWNER', 'PLATFORM_ADMIN'], 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS'), 'ALLOW');
  console.log('MULTI_ROLE_AUTHORIZATION=PASS');
  console.log('ROLE_ORDER_INDEPENDENCE=PASS');
});

test('DUPLICATE_OWNER_PROMOTION: promoting an already-APP_OWNER account again is denied, fails closed', async () => {
  await forceZeroActiveAppOwners();
  const email = uniqueEmail('duplicate-promotion');
  const account = await accountService.createAccount('Duplicate Promotion Target', hashAdminEmail(email), 'strong passphrase value 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await promoteExistingAccountToFirstOwner({
    emailHash: hashAdminEmail(email),
    assignmentId: randomUUID(),
    grantedAt: new Date(),
    auditEventId: randomUUID(),
    correlationId: randomUUID(),
  });

  await assert.rejects(
    () => promoteExistingAccountToFirstOwner({
      emailHash: hashAdminEmail(email),
      assignmentId: randomUUID(),
      grantedAt: new Date(),
      auditEventId: randomUUID(),
      correlationId: randomUUID(),
    }),
    (error) => error instanceof FirstOwnerPromotionError && error.reason === 'ALREADY_APP_OWNER',
  );

  const [[{ c }]] = await getPool().query(`SELECT COUNT(*) AS c FROM platform_admin_role_assignments WHERE admin_id = ? AND role = 'APP_OWNER' AND revoked_at IS NULL`, [account.adminId]);
  assert.equal(Number(c), 1, 'exactly one APP_OWNER row, not two');

  console.log('DUPLICATE_OWNER_PROMOTION=DENIED');
  await revokeAllActiveAppOwners();
});

test('PROMOTION_ROLLBACK: a forced failure mid-transaction leaves zero partial rows', async () => {
  await forceZeroActiveAppOwners();
  const email = uniqueEmail('promotion-rollback');
  const account = await accountService.createAccount('Rollback Target', hashAdminEmail(email), 'rollback passphrase value 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  // Baseline AFTER createAccount, which itself emits its own ADMIN_ROLE_CHANGED
  // audit event for the initial PLATFORM_ADMIN grant -- the rollback proof
  // must be a DELTA against this baseline, not an absolute zero.
  const [baselineAuditRows] = await getPool().query(`SELECT event_id FROM platform_admin_audit_events WHERE target_ref = ? AND event_type = 'ADMIN_ROLE_CHANGED'`, [`admin:${account.adminId}`]);
  const baselineAuditCount = baselineAuditRows.length;

  // Force the role-assignment INSERT to fail via a real ER_DUP_ENTRY on the
  // primary key (assignment_id), by pre-inserting a row with that exact id.
  const collidingAssignmentId = randomUUID();
  await getPool().query(
    `INSERT INTO platform_admin_role_assignments (assignment_id, admin_id, role, granted_at, revoked_at, granted_by_admin_id) VALUES (?, ?, 'PLATFORM_ADMIN', NOW(3), NOW(3), NULL)`,
    [collidingAssignmentId, account.adminId],
  );

  await assert.rejects(
    () => promoteExistingAccountToFirstOwner({
      emailHash: hashAdminEmail(email),
      assignmentId: collidingAssignmentId,
      grantedAt: new Date(),
      auditEventId: randomUUID(),
      correlationId: randomUUID(),
    }),
    (error) => isDuplicateEntry(error),
  );

  const [[{ c: ownerCount }]] = await getPool().query(`SELECT COUNT(*) AS c FROM platform_admin_role_assignments WHERE admin_id = ? AND role = 'APP_OWNER'`, [account.adminId]);
  assert.equal(Number(ownerCount), 0, 'ROLE_DELTA must be 0 -- no APP_OWNER row from the failed attempt');
  const [auditRows] = await getPool().query(`SELECT event_id FROM platform_admin_audit_events WHERE target_ref = ? AND event_type = 'ADMIN_ROLE_CHANGED'`, [`admin:${account.adminId}`]);
  assert.equal(auditRows.length, baselineAuditCount, 'AUDIT_DELTA must be 0 relative to the pre-attempt baseline -- no NEW audit row from the failed attempt');

  console.log('PROMOTION_ROLLBACK=PASS');
});

test('CONCURRENT_FIRST_OWNER_SINGLE_WINNER: a promotion attempt and a brand-new-account bootstrap attempt racing for the SAME lock produce exactly one owner', async () => {
  await forceZeroActiveAppOwners();
  const existingEmail = uniqueEmail('concurrent-promotion-target');
  const account = await accountService.createAccount('Concurrent Promotion Target', hashAdminEmail(existingEmail), 'concurrent passphrase value 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const newOwnerEmail = uniqueEmail('concurrent-new-owner');

  const [promotionResult, bootstrapResult] = await Promise.all([
    runPromotionSubprocess(existingEmail),
    runBootstrapSubprocess(newOwnerEmail),
  ]);

  const promotionSucceeded = /^FIRST_OWNER_PROMOTION=COMPLETED/m.test(promotionResult.stdout);
  const bootstrapSucceeded = /^FIRST_OWNER_BOOTSTRAP=ACTIVATION_ISSUED/m.test(bootstrapResult.stdout);
  const successes = [promotionSucceeded, bootstrapSucceeded].filter(Boolean).length;
  assert.equal(successes, 1, `expected exactly one of the two racing scripts to succeed, got ${successes} (promotion stdout: ${promotionResult.stdout}; bootstrap stdout: ${bootstrapResult.stdout})`);

  const [ownerRows] = await getPool().query(
    `SELECT ra.admin_id FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(ownerRows.length, 1, 'FINAL_ACTIVE_APP_OWNER_COUNT must be exactly 1 across BOTH scripts combined');

  if (promotionSucceeded) {
    assert.equal(ownerRows[0].admin_id, account.adminId, 'the winner must be the promoted EXISTING account, not a new one');
    const [newAccountRows] = await getPool().query(`SELECT admin_id FROM platform_admin_accounts WHERE email_hash = ?`, [hashAdminEmail(newOwnerEmail)]);
    assert.equal(newAccountRows.length, 0, 'the losing new-account bootstrap must have created nothing');
  } else {
    assert.notEqual(ownerRows[0].admin_id, account.adminId, 'the winner must be the NEW account, not the existing one, since promotion lost the race');
    const stillOnlyPlatformAdmin = await repository.findActiveRoles(account.adminId);
    assert.deepEqual(stillOnlyPlatformAdmin, ['PLATFORM_ADMIN'], 'the losing promotion attempt must not have touched the existing account\'s roles');
  }

  console.log('CONCURRENT_FIRST_OWNER_SINGLE_WINNER=PASS');
  await revokeAllActiveAppOwners();
});

test('SECRET_LEAKAGE=NONE: promote-first-app-owner.mjs CLI stdout/stderr never contain secret material', async () => {
  await forceZeroActiveAppOwners();
  const email = uniqueEmail('hygiene-promotion');
  await accountService.createAccount('Hygiene Promotion Target', hashAdminEmail(email), 'hygiene passphrase value 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');

  const { stdout, stderr } = await runPromotionSubprocess(email);
  const combined = `${stdout}\n${stderr}`;
  assert.match(stdout, /^FIRST_OWNER_PROMOTION=COMPLETED/m);

  const forbidden = [/password/i, /scrypt\$/i, /otpauth:\/\//i, /totp.?secret/i, /PCA_DATABASE_URL/i, /mysql:\/\//i, /session.?token/i, /activation.?token/i];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(combined), false, `output must not match ${pattern}`);
  }

  console.log('SECRET_LEAKAGE=NONE');
  await revokeAllActiveAppOwners();
});

test.after(async () => {
  await closePool();
});
