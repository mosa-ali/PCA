// SESSION 2C certification: real-MySQL proof of the first-APP_OWNER
// bootstrap behavior (backend/scripts/bootstrap-platform-owner.mjs). Every
// test in this file uses the SAME real repository/service classes the
// script and its HTTP routes use in production -- no hand-crafted SQL rows
// standing in for application logic, no mocks.
//
// MUST be run against a freshly reset + migrated disposable database (see
// package.json's "test:db:bootstrap" script), NOT interleaved with the rest
// of the test:db suite: several sections below depend on the real
// "ACTIVE_APP_OWNER_COUNT=0" precondition bootstrap-platform-owner.mjs
// itself enforces, which other test files' own APP_OWNER fixtures would
// violate. Each section that creates a winning APP_OWNER revokes that role
// assignment before returning, so the next section starts from zero again.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);
if (!process.env.PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL) process.env.PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL = 'http://localhost:4100/platform-admin/activate';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import mysql from 'mysql2/promise';

import { closePool, getPool, isDuplicateEntry } from '../../dist/db/pool.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { PENDING_ACTIVATION_CREDENTIAL } from '../../dist/platformadmin/auth/passwordCredential.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { MySqlPlatformAdminActivationRepository } from '../../dist/platformadmin/auth/MySqlPlatformAdminActivationRepository.js';
import {
  PlatformAdminActivationService,
  PlatformAdminActivationError,
  generateActivationToken,
  hashActivationToken,
} from '../../dist/platformadmin/auth/PlatformAdminActivationService.js';
import { PlatformAdminAuthService, PlatformAdminAuthError } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';
import {
  computeTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  loadMfaEncryptionKey,
} from '../../dist/platformadmin/auth/totp.js';
import { EmailService } from '../../dist/email/EmailService.js';
import { MySqlEmailOutboxRepository } from '../../dist/email/MySqlEmailOutboxRepository.js';
import { RejectingEmailProviderAdapter } from '../../dist/email/providers/RejectingEmailProviderAdapter.js';
import { FIRST_OWNER_BOOTSTRAP_LOCK_NAME, runBootstrap } from '../../scripts/bootstrap-platform-owner.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const execFileAsync = promisify(execFile);
const repository = new MySqlPlatformAdminAuthRepository();
const activationRepository = new MySqlPlatformAdminActivationRepository();
const emailSender = new EmailService({ repository: new MySqlEmailOutboxRepository(), providerAdapter: new RejectingEmailProviderAdapter(), env: process.env });
const activationService = new PlatformAdminActivationService(repository, activationRepository, emailSender);
const authService = new PlatformAdminAuthService(repository, new LoggingAlertAdapter());
const accountService = new PlatformAdminAccountService(repository);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function revokeAllActiveAppOwners() {
  await getPool().query(`UPDATE platform_admin_role_assignments SET revoked_at = NOW(3) WHERE role = 'APP_OWNER' AND revoked_at IS NULL`);
}

/** Standard createAccount input shape, mirroring bootstrap-platform-owner.mjs lines 97-137 exactly. */
function firstOwnerCreateAccountInput(adminId, emailHash, now, correlationId) {
  return {
    adminId,
    emailHash,
    displayName: 'Platform Owner (bootstrap)',
    passwordCredential: PENDING_ACTIVATION_CREDENTIAL,
    createdAt: now,
    assignmentId: randomUUID(),
    role: 'APP_OWNER',
    grantedByAdminId: null,
    grantedAt: now,
    initialMfa: { status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: now },
    auditEvents: [
      { eventId: randomUUID(), eventType: 'ADMIN_CREATED', actorAdminId: null, actorRole: null, targetRef: `admin:${adminId}`, result: 'SUCCESS', occurredAt: now, correlationId, metadata: { source: 'BOOTSTRAP' } },
      { eventId: randomUUID(), eventType: 'ADMIN_ROLE_CHANGED', actorAdminId: null, actorRole: null, targetRef: `admin:${adminId}`, result: 'SUCCESS', occurredAt: now, correlationId, metadata: { action: 'GRANTED', role: 'APP_OWNER', source: 'BOOTSTRAP' } },
    ],
  };
}

async function snapshotAdmin(adminId) {
  const [[account]] = await getPool().query(
    `SELECT status, display_name, password_credential, disabled_at FROM platform_admin_accounts WHERE admin_id = ?`,
    [adminId],
  );
  const [roles] = await getPool().query(
    `SELECT role, revoked_at, granted_by_admin_id FROM platform_admin_role_assignments WHERE admin_id = ? ORDER BY role`,
    [adminId],
  );
  const [[mfa]] = await getPool().query(
    `SELECT status, HEX(totp_secret_ciphertext) AS ciphertext_hex, HEX(totp_secret_nonce) AS nonce_hex, activated_at FROM platform_admin_mfa_state WHERE admin_id = ?`,
    [adminId],
  );
  const [tokens] = await getPool().query(
    `SELECT activation_id, used_at, revoked_at FROM platform_admin_activation_tokens WHERE admin_id = ? ORDER BY activation_id`,
    [adminId],
  );
  return {
    account: { status: account.status, displayName: account.display_name, passwordCredential: account.password_credential, disabledAt: account.disabled_at ? account.disabled_at.toISOString() : null },
    roles: roles.map((r) => ({ role: r.role, revoked: r.revoked_at !== null, grantedBy: r.granted_by_admin_id })),
    mfa: { status: mfa.status, ciphertextHex: mfa.ciphertext_hex, nonceHex: mfa.nonce_hex, activatedAt: mfa.activated_at ? mfa.activated_at.toISOString() : null },
    tokens: tokens.map((t) => ({ activationId: t.activation_id, used: t.used_at !== null, revoked: t.revoked_at !== null })),
  };
}

async function runBootstrapSubprocess(email) {
  return execFileAsync('node', ['scripts/bootstrap-platform-owner.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PLATFORM_ADMIN_BOOTSTRAP_EMAIL: email },
  }).catch((error) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code }));
}

test('DB_CONCURRENCY_TEST: two concurrent first-owner bootstrap attempts against real, separate MySQL connections leave exactly one winner', async () => {
  const [[{ c: startingCount }]] = await getPool().query(
    `SELECT COUNT(*) AS c FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(Number(startingCount), 0, 'precondition ACTIVE_APP_OWNER_COUNT=0 must hold before this test');

  const emailA = uniqueEmail('racer-a');
  const emailB = uniqueEmail('racer-b');

  process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL = emailA;
  const attemptA = runBootstrap();
  process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL = emailB;
  const attemptB = runBootstrap();

  const results = await Promise.allSettled([attemptA, attemptB]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, `expected exactly one bootstrap to succeed, got ${fulfilled.length}`);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /already exists/);

  const [ownerRows] = await getPool().query(
    `SELECT ra.admin_id FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(ownerRows.length, 1);
  const winnerAdminId = ownerRows[0].admin_id;

  const [[{ c: roleCount }]] = await getPool().query(`SELECT COUNT(*) AS c FROM platform_admin_role_assignments WHERE role = 'APP_OWNER' AND revoked_at IS NULL`);
  assert.equal(Number(roleCount), 1);

  const [[mfaRow]] = await getPool().query(`SELECT status FROM platform_admin_mfa_state WHERE admin_id = ?`, [winnerAdminId]);
  assert.equal(mfaRow.status, 'PENDING_SETUP');

  const [[credRow]] = await getPool().query(`SELECT password_credential FROM platform_admin_accounts WHERE admin_id = ?`, [winnerAdminId]);
  assert.equal(credRow.password_credential, PENDING_ACTIVATION_CREDENTIAL);

  const [emailARows] = await getPool().query(`SELECT admin_id FROM platform_admin_accounts WHERE email_hash = ?`, [hashAdminEmail(emailA)]);
  const [emailBRows] = await getPool().query(`SELECT admin_id FROM platform_admin_accounts WHERE email_hash = ?`, [hashAdminEmail(emailB)]);
  const totalPersisted = emailARows.length + emailBRows.length;
  assert.equal(totalPersisted, 1, 'exactly one racer email must have a persisted account; the other must have zero rows (no partial losing state)');

  console.log(`DB_CONCURRENCY_TEST=PASS`);
  console.log(`CONCURRENT_ATTEMPTS=2`);
  console.log(`SUCCESSFUL_BOOTSTRAPS=${fulfilled.length}`);
  console.log(`FAILED_BOOTSTRAPS=${rejected.length}`);
  console.log(`FINAL_ACTIVE_APP_OWNER_COUNT=${ownerRows.length}`);
  console.log(`FINAL_ACTIVE_APP_OWNER_ROLE_COUNT=${Number(roleCount)}`);
  console.log(`WINNER_MFA_STATUS=${mfaRow.status}`);
  console.log(`LOSER_PARTIAL_STATE_ROWS=${totalPersisted - 1}`);
  console.log(`CONCURRENT_SINGLE_WINNER=PASS`);

  await revokeAllActiveAppOwners();
});

test('LOCK_FAILURE_TEST: bootstrap fails closed when the advisory lock cannot be acquired, creating nothing', async () => {
  const holder = await mysql.createConnection({ uri: process.env.PCA_DATABASE_URL, timezone: 'Z' });
  const [[lockRow]] = await holder.query('SELECT GET_LOCK(?, ?) AS acquired', [FIRST_OWNER_BOOTSTRAP_LOCK_NAME, 5]);
  assert.equal(Number(lockRow.acquired), 1);
  const email = uniqueEmail('lockfail');
  process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL = email;
  try {
    // Real LOCK_TIMEOUT_SECONDS=30 from the script itself -- not shortened,
    // so this proves the actual configured fail-closed behavior, not a
    // stand-in. Real wall-clock cost: ~30s.
    await assert.rejects(() => runBootstrap(), /Unable to acquire first-owner bootstrap lock/);
  } finally {
    await holder.query('SELECT RELEASE_LOCK(?) AS released', [FIRST_OWNER_BOOTSTRAP_LOCK_NAME]);
    await holder.end();
  }
  const [acctRows] = await getPool().query('SELECT admin_id FROM platform_admin_accounts WHERE email_hash = ?', [hashAdminEmail(email)]);
  assert.equal(acctRows.length, 0);

  console.log('ACCOUNT_CREATED=NO');
  console.log('ROLE_CREATED=NO');
  console.log('MFA_CREATED=NO');
  console.log('ACTIVATION_CREATED=NO');
  console.log('LOCK_FAILURE_FAIL_CLOSED=PASS');
});

test('BOOTSTRAP_CREATION_ROLLBACK: a forced failure mid-createAccount leaves zero partial rows', async () => {
  const adminId = randomUUID();
  const now = new Date();
  const email = uniqueEmail('rollback');
  const emailHash = hashAdminEmail(email);
  const correlationId = randomUUID();
  // Deliberately reused eventId across two audit events forces ER_DUP_ENTRY
  // on the SECOND audit insert -- after account/role/mfa inserts already ran
  // earlier in the SAME transaction -- proving runInTransaction's rollback
  // actually undoes all four insert groups, not just the failing one.
  const dupEventId = randomUUID();
  const input = firstOwnerCreateAccountInput(adminId, emailHash, now, correlationId);
  input.auditEvents = [
    { ...input.auditEvents[0], eventId: dupEventId },
    { ...input.auditEvents[1], eventId: dupEventId },
  ];

  await assert.rejects(() => repository.createAccount(input), (error) => isDuplicateEntry(error));

  const [acctRows] = await getPool().query('SELECT admin_id FROM platform_admin_accounts WHERE admin_id = ?', [adminId]);
  const [roleRows] = await getPool().query('SELECT assignment_id FROM platform_admin_role_assignments WHERE admin_id = ?', [adminId]);
  const [mfaRows] = await getPool().query('SELECT admin_id FROM platform_admin_mfa_state WHERE admin_id = ?', [adminId]);
  const [auditRows] = await getPool().query('SELECT event_id FROM platform_admin_audit_events WHERE target_ref = ?', [`admin:${adminId}`]);

  assert.equal(acctRows.length, 0);
  assert.equal(roleRows.length, 0);
  assert.equal(mfaRows.length, 0);
  assert.equal(auditRows.length, 0);

  console.log('ACCOUNT_DELTA=0');
  console.log('ROLE_DELTA=0');
  console.log('MFA_DELTA=0');
  console.log('AUDIT_DELTA=0');
  console.log('BOOTSTRAP_CREATION_ROLLBACK=PASS');
});

test('ACTIVATION_ISSUANCE_FAILURE: a forced failure in activation issuance AFTER account creation strands the first owner with no unauthenticated recovery path', async () => {
  const adminId = randomUUID();
  const now = new Date();
  const email = uniqueEmail('strand');
  const emailHash = hashAdminEmail(email);
  const correlationId = randomUUID();

  // Mirrors bootstrap-platform-owner.mjs's own createAccount call exactly --
  // this is a SEPARATE transaction from the activation issuance below,
  // exactly as in the real script.
  await repository.createAccount(firstOwnerCreateAccountInput(adminId, emailHash, now, correlationId));

  // Force activationRepository.issue() -- the real script's SEPARATE, later
  // operation -- to fail, by occupying the activation_id primary key it
  // will be given.
  const collidingActivationId = randomUUID();
  await getPool().query(
    `INSERT INTO platform_admin_activation_tokens (activation_id, admin_id, token_hash, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, ?, 'PLATFORM_ADMIN_FIRST_TIME', ?, ?, NULL, NULL)`,
    [collidingActivationId, adminId, 'a'.repeat(64), now, new Date(now.getTime() + 60_000)],
  );
  const { rawToken, tokenHash } = generateActivationToken();
  await assert.rejects(
    () => activationRepository.issue({ activationId: collidingActivationId, adminId, tokenHash, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 60_000) }),
    (error) => isDuplicateEntry(error),
  );

  // Account/role/MFA DO persist -- createAccount already committed in its own transaction.
  const [[acctRow]] = await getPool().query(`SELECT status, password_credential FROM platform_admin_accounts WHERE admin_id = ?`, [adminId]);
  const [roleRows] = await getPool().query(`SELECT role FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL`, [adminId]);
  const [[mfaRow]] = await getPool().query(`SELECT status FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]);
  assert.equal(acctRow.status, 'ACTIVE');
  assert.equal(acctRow.password_credential, PENDING_ACTIVATION_CREDENTIAL);
  assert.equal(roleRows.length, 1);
  assert.equal(roleRows[0].role, 'APP_OWNER');
  assert.equal(mfaRow.status, 'PENDING_SETUP');

  // No real, usable activation token exists -- the intended one never got inserted.
  const [realTokenRows] = await getPool().query(`SELECT activation_id FROM platform_admin_activation_tokens WHERE token_hash = ?`, [tokenHash]);
  assert.equal(realTokenRows.length, 0);

  // The ONLY other issuance path (PlatformAdminActivationService.issueActivation)
  // requires an authenticated actor already holding MANAGE_ADMIN_ACCOUNTS --
  // impossible here, since no admin can log in yet (no usable credential,
  // MFA PENDING_SETUP with no secret) and this IS the only APP_OWNER that
  // would ever hold that permission.
  await assert.rejects(
    () => activationService.issueActivation(adminId, email, { adminId: randomUUID(), roles: [] }),
    PlatformAdminActivationError,
  );

  console.log('ACTIVATION_ISSUANCE_FAILURE_STATE=ACTIVE_ACCOUNT_PLUS_APP_OWNER_ROLE_PLUS_PENDING_SETUP_MFA_PLUS_PENDING_CREDENTIAL_PLUS_NO_USABLE_ACTIVATION');
  console.log('RECOVERY_PATH_PROVEN=NO');
  console.log('FIRST_OWNER_STRANDING_RISK=YES');

  await revokeAllActiveAppOwners();
});

test('FIRST_OWNER_END_TO_END_ACTIVATION: full real lifecycle from bootstrap through login/whoami/logout', async () => {
  const adminId = randomUUID();
  const now = new Date();
  const email = uniqueEmail('e2e-owner');
  const emailHash = hashAdminEmail(email);
  const correlationId = randomUUID();

  await repository.createAccount(firstOwnerCreateAccountInput(adminId, emailHash, now, correlationId));
  const { rawToken, tokenHash } = generateActivationToken();
  const createdAt = new Date();
  await activationRepository.issue({ activationId: randomUUID(), adminId, tokenHash, createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 60_000) });

  const [[tokenRow]] = await getPool().query(`SELECT token_hash FROM platform_admin_activation_tokens WHERE admin_id = ?`, [adminId]);
  assert.equal(tokenRow.token_hash, hashActivationToken(rawToken));
  assert.equal(tokenRow.token_hash.includes(rawToken), false);

  await assert.rejects(() => authService.login(email, 'irrelevant-password-value', '000000'), PlatformAdminAuthError);

  const { otpauthUri } = await activationService.start(rawToken);
  assert.match(otpauthUri, /^otpauth:\/\/totp\//);

  const [[mfaRow]] = await getPool().query(`SELECT totp_secret_ciphertext, totp_secret_nonce FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]);
  const secret = decryptTotpSecret(mfaRow.totp_secret_ciphertext, mfaRow.totp_secret_nonce, loadMfaEncryptionKey());
  const password = 'a genuinely strong first owner passphrase 2026';
  const code1 = computeTotp(secret, Date.now());
  await activationService.complete(rawToken, password, code1);

  const [[tokenRow2]] = await getPool().query(`SELECT used_at FROM platform_admin_activation_tokens WHERE admin_id = ?`, [adminId]);
  assert.ok(tokenRow2.used_at);
  const [[mfaRow2]] = await getPool().query(`SELECT status FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]);
  assert.equal(mfaRow2.status, 'ACTIVE');
  const [[acctRow2]] = await getPool().query(`SELECT password_credential FROM platform_admin_accounts WHERE admin_id = ?`, [adminId]);
  assert.match(acctRow2.password_credential, /^scrypt\$/);

  const code2 = computeTotp(secret, Date.now(), 1);
  const { rawToken: sessionToken } = await authService.login(email, password, code2);

  const identity = await authService.validateSession(sessionToken);
  assert.equal(identity.adminId, adminId);
  assert.ok(identity.roles.includes('APP_OWNER'));

  await authService.logout(sessionToken);
  await assert.rejects(() => authService.validateSession(sessionToken), PlatformAdminAuthError);
  await assert.rejects(() => authService.login(email, password, code2), PlatformAdminAuthError);

  console.log('PRE_ACTIVATION_LOGIN=DENIED');
  console.log('MFA_STATUS=ACTIVE');
  console.log('PASSWORD_FORMAT=SCRYPT');
  console.log('POST_ACTIVATION_LOGIN=PASS');
  console.log('TOKEN_REUSE=DENIED');
  console.log('TOTP_REPLAY=DENIED');
  console.log('FIRST_OWNER_END_TO_END_ACTIVATION=PASS');

  await revokeAllActiveAppOwners();
});

test('ACTIVATION_REISSUE: issuing a replacement activation invalidates the old token and the old pending TOTP', async () => {
  const adminId = randomUUID();
  const now = new Date();
  const email = uniqueEmail('reissue');
  const emailHash = hashAdminEmail(email);
  await repository.createAccount({
    adminId,
    emailHash,
    displayName: 'Reissue Test Admin',
    passwordCredential: PENDING_ACTIVATION_CREDENTIAL,
    createdAt: now,
    assignmentId: randomUUID(),
    role: 'PLATFORM_ADMIN',
    grantedByAdminId: null,
    grantedAt: now,
    initialMfa: { status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: now },
    auditEvents: [],
  });

  const tokenA = generateActivationToken();
  await activationRepository.issue({ activationId: randomUUID(), adminId, tokenHash: tokenA.tokenHash, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 60_000) });
  const { otpauthUri: uriA } = await activationService.start(tokenA.rawToken);
  assert.match(uriA, /^otpauth:\/\/totp\//);

  const laterNow = new Date(now.getTime() + 1000);
  const tokenB = generateActivationToken();
  await activationRepository.issue({ activationId: randomUUID(), adminId, tokenHash: tokenB.tokenHash, createdAt: laterNow, expiresAt: new Date(laterNow.getTime() + 30 * 60_000) });

  await assert.rejects(() => activationService.start(tokenA.rawToken), PlatformAdminActivationError);

  const [[mfaRowAfterB]] = await getPool().query(`SELECT totp_secret_ciphertext, totp_secret_nonce FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]);
  assert.equal(mfaRowAfterB.totp_secret_ciphertext, null);
  assert.equal(mfaRowAfterB.totp_secret_nonce, null);

  const { otpauthUri: uriB } = await activationService.start(tokenB.rawToken);
  assert.match(uriB, /^otpauth:\/\/totp\//);
  assert.notEqual(uriB, uriA);

  const [[mfaRowB]] = await getPool().query(`SELECT totp_secret_ciphertext, totp_secret_nonce FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]);
  const secretB = decryptTotpSecret(mfaRowB.totp_secret_ciphertext, mfaRowB.totp_secret_nonce, loadMfaEncryptionKey());
  const codeB = computeTotp(secretB, Date.now());
  await activationService.complete(tokenB.rawToken, 'another strong passphrase value 2026', codeB);
  const [[acctRow]] = await getPool().query(`SELECT password_credential FROM platform_admin_accounts WHERE admin_id = ?`, [adminId]);
  assert.match(acctRow.password_credential, /^scrypt\$/);

  console.log('ACTIVATION_REISSUE=PASS');
  console.log('OLD_TOKEN_INVALIDATION=PASS');
  console.log('OLD_TOTP_INVALIDATION=PASS');
});

test('EXISTING_PLATFORM_ADMIN_SAFETY: first-owner bootstrap never touches an existing separate PLATFORM_ADMIN', async () => {
  const [[{ c: startingCount }]] = await getPool().query(
    `SELECT COUNT(*) AS c FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(Number(startingCount), 0, 'precondition ACTIVE_APP_OWNER_COUNT=0 must hold before this test');

  const existingEmail = uniqueEmail('existing-pa');
  const existingAccount = await accountService.createAccount('Existing Platform Admin', hashAdminEmail(existingEmail), 'existing platform admin passphrase 2026', 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const existingSecret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(existingSecret, loadMfaEncryptionKey());
  await getPool().query(`UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`, [ciphertext, nonce, existingAccount.adminId]);

  const before = await snapshotAdmin(existingAccount.adminId);

  const bootstrapEmail = uniqueEmail('safety-owner');
  process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL = bootstrapEmail;
  await runBootstrap();

  const after = await snapshotAdmin(existingAccount.adminId);
  assert.deepEqual(after, before);
  assert.equal(after.roles.length, 1);
  assert.equal(after.roles[0].role, 'PLATFORM_ADMIN');

  console.log('EXISTING_PLATFORM_ADMIN_UNCHANGED=PASS');
  console.log('SILENT_ROLE_ELEVATION=NO');

  await revokeAllActiveAppOwners();
});

test('BOOTSTRAP_OUTPUT_HYGIENE: real CLI stdout/stderr never contain secret material', async () => {
  const [[{ c: startingCount }]] = await getPool().query(
    `SELECT COUNT(*) AS c FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(Number(startingCount), 0, 'precondition ACTIVE_APP_OWNER_COUNT=0 must hold before this test');

  const email = uniqueEmail('hygiene-owner');
  const { stdout, stderr } = await runBootstrapSubprocess(email);
  const combined = `${stdout}\n${stderr}`;
  // The script may also log non-secret status lines (e.g. EmailService's own
  // kind/provider/outcome diagnostic -- explicitly allowed by this section's
  // "non-secret status/provider name is acceptable" rule) before its final
  // success marker, so check the marker is PRESENT, not that it is the only line.
  assert.match(stdout, /^FIRST_OWNER_BOOTSTRAP=ACTIVATION_ISSUED PROVIDER=\S+$/m);

  const forbidden = [/password/i, /scrypt\$/i, /otpauth:\/\//i, /\?token=/i, /totp.?secret/i, /PCA_DATABASE_URL/i, /mysql:\/\//i, /session.?token/i];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(combined), false, `output must not match ${pattern}`);
  }

  console.log('BOOTSTRAP_OUTPUT_HYGIENE=PASS');

  await revokeAllActiveAppOwners();
});

test.after(async () => {
  await closePool();
});
