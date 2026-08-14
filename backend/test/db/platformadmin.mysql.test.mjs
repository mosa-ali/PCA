if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, isDuplicateEntry } from '../../dist/db/pool.js';
import { PlatformAdminAuthService, PlatformAdminAuthError } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService, PlatformAdminAccountError } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';

// Cross-realm negative test also exercises the family-plane repository/service.
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { isPlausibleSessionToken } from '../../dist/auth/token.js';
import { isPlausiblePlatformAdminSessionToken } from '../../dist/platformadmin/auth/token.js';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlPlatformAdminAuthRepository();
const auditRepository = new MySqlPlatformAdminAuditRepository();
const auditService = new PlatformAdminAuditService(auditRepository);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createLoginableAdmin(accountService, { role = 'APP_OWNER', email = uniqueEmail('admin'), password = 'correct horse battery staple' } = {}) {
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  return { adminId: account.adminId, email, password, secret };
}

function buildServices(now = () => new Date()) {
  const authService = new PlatformAdminAuthService(repository, new LoggingAlertAdapter(), now);
  const accountService = new PlatformAdminAccountService(repository, now);
  return { authService, accountService };
}

test('MySQL: full login round trip persists through real MySQL and validates', async () => {
  const { authService, accountService } = buildServices();
  const admin = await createLoginableAdmin(accountService);
  const code = computeTotp(admin.secret, Date.now());
  const { rawToken } = await authService.login(admin.email, admin.password, code);
  const identity = await authService.validateSession(rawToken);
  assert.equal(identity.adminId, admin.adminId);
});

test('MySQL: raw session token is never stored -- only its hash', async () => {
  const { authService, accountService } = buildServices();
  const admin = await createLoginableAdmin(accountService);
  const code = computeTotp(admin.secret, Date.now());
  const { rawToken } = await authService.login(admin.email, admin.password, code);
  const [rows] = await getPool().query(`SELECT token_hash FROM platform_admin_sessions WHERE admin_id = ?`, [admin.adminId]);
  assert.equal(rows[0].token_hash.includes(rawToken), false);
});

test('MySQL: duplicate ACTIVE (admin_id, role) grant is rejected by the DB unique constraint (ER_DUP_ENTRY)', async () => {
  const { accountService } = buildServices();
  const account = await accountService.createAccount('Dup Role', hashAdminEmail(uniqueEmail('duprole')), 'password-value', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(
    () => accountService.assignRole(account.adminId, 'PLATFORM_ADMIN', 'BOOTSTRAP'),
    (error) => error instanceof PlatformAdminAccountError,
  );
  // Confirm the underlying DB error really was ER_DUP_ENTRY by calling the
  // repository directly (bypassing the service's generic-error mapping).
  await assert.rejects(
    () =>
      repository.assignRole({
        assignmentId: randomUUID(),
        adminId: account.adminId,
        role: 'PLATFORM_ADMIN',
        grantedAt: new Date(),
        grantedByAdminId: null,
        auditEvent: {
          eventId: randomUUID(),
          eventType: 'ADMIN_ROLE_CHANGED',
          actorAdminId: null,
          actorRole: null,
          targetRef: `admin:${account.adminId}`,
          result: 'SUCCESS',
          occurredAt: new Date(),
          correlationId: randomUUID(),
          metadata: null,
        },
      }),
    (error) => isDuplicateEntry(error),
  );
});

test('MySQL: role removal cascades to force-revoke active sessions', async () => {
  const { authService, accountService } = buildServices();
  const admin = await createLoginableAdmin(accountService, { role: 'PLATFORM_ADMIN' });
  const code = computeTotp(admin.secret, Date.now());
  const { rawToken } = await authService.login(admin.email, admin.password, code);
  await authService.validateSession(rawToken);
  await accountService.revokeRole(admin.adminId, 'PLATFORM_ADMIN', 'BOOTSTRAP');
  await assert.rejects(() => authService.validateSession(rawToken), PlatformAdminAuthError);
});

test('MySQL: disabling an account cascades to force-revoke active sessions', async () => {
  const { authService, accountService } = buildServices();
  const admin = await createLoginableAdmin(accountService);
  const code = computeTotp(admin.secret, Date.now());
  const { rawToken } = await authService.login(admin.email, admin.password, code);
  await authService.validateSession(rawToken);
  await accountService.disableAccount(admin.adminId, 'BOOTSTRAP');
  await assert.rejects(() => authService.validateSession(rawToken), PlatformAdminAuthError);
});

test('MySQL: lockout after 5 failed attempts within the window rejects a 6th attempt even with the correct password+code', async () => {
  let now = new Date();
  const { authService, accountService } = buildServices(() => now);
  const admin = await createLoginableAdmin(accountService);
  for (let i = 0; i < 5; i++) {
    await authService.login(admin.email, 'wrong-password', '000000').catch(() => {});
    now = new Date(now.getTime() + 1000);
  }
  const code = computeTotp(admin.secret, now.getTime());
  await assert.rejects(() => authService.login(admin.email, admin.password, code), PlatformAdminAuthError);
});

test('MySQL: audit metadata/free-text never contains the raw password, raw TOTP code, or raw session token used in this test', async () => {
  const { authService, accountService } = buildServices();
  const admin = await createLoginableAdmin(accountService);
  const code = computeTotp(admin.secret, Date.now());
  const { rawToken } = await authService.login(admin.email, admin.password, code);
  await authService.login(admin.email, 'a-completely-different-wrong-password', '111111').catch(() => {});

  const [rows] = await getPool().query(
    `SELECT event_id, event_type, metadata_json FROM platform_admin_audit_events WHERE actor_admin_id = ? OR target_ref = ?`,
    [admin.adminId, `admin:${admin.adminId}`],
  );
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    assert.equal(serialized.includes(admin.password), false);
    assert.equal(serialized.includes(code), false);
    assert.equal(serialized.includes(rawToken), false);
    assert.equal(serialized.includes('111111'), false);
  }
});

// NOTE (Defect-1 correction): platform_admin_audit_events' append-only
// guarantee is no longer enforced by DB triggers (a least-privilege MySQL 8
// user under binary logging cannot CREATE TRIGGER without SUPER -- see
// migration 0005's APPEND-ONLY ENFORCEMENT comment). It is now enforced by
// the runtime principal's per-table grant shape (never granted
// UPDATE/DELETE on this one table), which getPool() here -- an ordinary,
// typically fully-privileged local/test connection, not the least-privilege
// runtime principal -- cannot exercise. The real, DB-level privilege
// boundary is proven against an actual least-privilege throwaway user in
// backend/test/db/platformAdminAuditPrivileges.mysql.test.mjs instead.

test('MySQL: platform_admin_audit_events append-only enforcement is grant-based, not trigger-based -- migration 0005 defines zero CREATE TRIGGER statements', async () => {
  const migration = await (await import('node:fs/promises')).readFile(
    new URL('../../migrations/0005_platform_admin_identity_rbac_audit.sql', import.meta.url),
    'utf8',
  );
  // Strip `--` comments first: the APPEND-ONLY ENFORCEMENT comment
  // legitimately discusses, in prose, why CREATE TRIGGER cannot be used --
  // this assertion is about actual executable DDL, not comment text.
  const executableSql = migration.replace(/--[^\n]*/g, '');
  assert.equal(/CREATE TRIGGER/i.test(executableSql), false);
});

test('MySQL: audit read scoping -- queryForRole restricts a non-owner/auditor role to its own actions only', async () => {
  const { accountService } = buildServices();
  const actorOneAccount = await accountService.createAccount('Actor One', hashAdminEmail(uniqueEmail('actorone')), 'password-value', 'APP_OWNER', 'BOOTSTRAP');
  const actorOne = { adminId: actorOneAccount.adminId, roles: ['APP_OWNER'] };
  // actorOne performs an action (creating a second admin), generating audit
  // events whose actor_admin_id is actorOne's own id.
  const actorTwoAccount = await accountService.createAccount('Actor Two', hashAdminEmail(uniqueEmail('actortwo')), 'password-value', 'SUPPORT_ADMIN', actorOne);

  // Queried AS a non-owner/auditor role (e.g. SUPPORT_ADMIN), actorOne sees
  // only events it was the actor of.
  const ownEvents = await auditService.queryForRole(['SUPPORT_ADMIN'], actorOne.adminId, {});
  assert.ok(ownEvents.length > 0);
  assert.ok(ownEvents.every((e) => e.actorAdminId === actorOne.adminId));

  // Queried as APP_OWNER, the same caller sees the full log, including
  // events it did NOT act in (e.g. the bootstrap-created first admin, actor
  // null).
  const fullEvents = await auditService.queryForRole(['APP_OWNER'], actorOne.adminId, {});
  assert.ok(fullEvents.some((e) => e.targetRef === `admin:${actorTwoAccount.adminId}`));
  assert.ok(fullEvents.some((e) => e.actorAdminId === null));
});

test('MySQL CONCURRENCY: many simultaneous logout/revoke-all calls against the same/overlapping sessions converge to an idempotent revoked end state', async () => {
  const { authService, accountService } = buildServices();
  const admin = await createLoginableAdmin(accountService);
  const tokens = [];
  for (let i = 0; i < 3; i++) {
    // TOTP-REPLAY-1: each login must claim a DISTINCT, not-previously-
    // accepted HOTP counter -- rather than the same code being presented
    // (and correctly rejected as a replay) three times in a row. Using
    // computeTotp's own stepOffset parameter (-1, 0, +1) against the REAL
    // current time at each iteration keeps every code within verifyTotp's
    // ±1-step accepted skew window (this service uses real wall-clock time
    // here, not a fake clock -- pushing the timestamp itself forward by
    // whole steps, as an earlier version of this fix did, would push later
    // codes OUTSIDE that window relative to the server's own real "now" at
    // verification time and fail for the wrong reason).
    const code = computeTotp(admin.secret, Date.now(), i - 1);
    tokens.push((await authService.login(admin.email, admin.password, code)).rawToken);
  }

  const attempts = await Promise.allSettled([
    ...tokens.map((token) => authService.logout(token)),
    authService.revokeAllSessions(admin.adminId, { adminId: admin.adminId, roles: ['APP_OWNER'] }),
    authService.revokeAllSessions(admin.adminId, { adminId: admin.adminId, roles: ['APP_OWNER'] }),
  ]);
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'concurrent logout/revoke-all must never throw');

  for (const token of tokens) {
    await assert.rejects(() => authService.validateSession(token), PlatformAdminAuthError);
  }
});

test('CROSS-REALM (DB-backed): a Platform Administration session token is never plausible to the family-plane token parser, and vice versa', async () => {
  const familyAuthService = new AuthService(new MySqlAuthRepository());
  const { authService: platformAdminAuthService, accountService } = buildServices();

  const { rawToken: familyToken } = await familyAuthService.issueSession(verifyTestOnlyIdentity(`subject-${randomUUID()}`));
  const admin = await createLoginableAdmin(accountService);
  const code = computeTotp(admin.secret, Date.now());
  const { rawToken: platformAdminToken } = await platformAdminAuthService.login(admin.email, admin.password, code);

  assert.equal(isPlausibleSessionToken(platformAdminToken), false);
  assert.equal(isPlausiblePlatformAdminSessionToken(familyToken), false);
  // And each is still valid against its own service.
  await assert.doesNotReject(() => familyAuthService.validateSession(familyToken));
  await assert.doesNotReject(() => platformAdminAuthService.validateSession(platformAdminToken));
});

test.after(async () => {
  await closePool();
});
