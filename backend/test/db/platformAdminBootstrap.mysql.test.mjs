// SESSION 2C certification: real-MySQL proof of the first-APP_OWNER
// bootstrap behavior (backend/scripts/bootstrap-platform-owner.mjs), now
// including the atomic-transaction fix for the stranding defect found in
// the original certification (see
// docs/supervision/PCA_FIRST_APP_OWNER_BOOTSTRAP_DB_CERTIFICATION_2026-09-15.md).
// Every test uses the SAME real repository/service classes the script and
// its HTTP routes use in production -- no hand-crafted SQL rows standing
// in for application logic, no mocks.
//
// Registered in package.json's shared "test:db" script (required by the
// anti-orphan gate test/meta/testSuiteRegistration.test.mjs) and safe to
// run there, interleaved with ~60 other files against one never-reset
// database: every test that needs the real "ACTIVE_APP_OWNER_COUNT=0"
// precondition calls forceZeroActiveAppOwners() first (see that function's
// own doc comment) rather than assuming it already holds, and every test
// that creates a winning APP_OWNER revokes that role assignment before
// returning. For a fast, isolated run during development, use the
// dedicated "test:db:bootstrap" script instead, which resets the whole
// disposable database first.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);
if (!process.env.PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL) process.env.PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL = 'http://localhost:4100/platform-admin/activate';

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import mysql from 'mysql2/promise';

import { closePool, getPool, isDuplicateEntry } from '../../dist/db/pool.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { PENDING_ACTIVATION_CREDENTIAL } from '../../dist/platformadmin/auth/passwordCredential.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { MySqlPlatformAdminActivationRepository } from '../../dist/platformadmin/auth/MySqlPlatformAdminActivationRepository.js';
import { createFirstOwnerBootstrap } from '../../dist/platformadmin/auth/MySqlFirstOwnerBootstrapRepository.js';
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
import { EmailService, OUTBOX_MESSAGE_TTL_MS } from '../../dist/email/EmailService.js';
import { MySqlEmailOutboxRepository } from '../../dist/email/MySqlEmailOutboxRepository.js';
import { RejectingEmailProviderAdapter } from '../../dist/email/providers/RejectingEmailProviderAdapter.js';
import { encryptOutboxContent } from '../../dist/email/emailOutboxEncryption.js';
import { computeEmailIdempotencyKey } from '../../dist/email/emailIdempotencyKey.js';
import { EMAIL_OUTBOX_CLAIM_LEASE_MS } from '../../dist/email/emailTimingPolicy.js';
import { attemptDeliveryAndRecordOutcome } from '../../dist/email/EmailOutboxProcessor.js';
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

/**
 * This file is registered in package.json's shared "test:db" script (a
 * mechanical anti-orphan gate, test/meta/testSuiteRegistration.test.mjs,
 * requires every test/db/*.test.mjs file to be), which runs ~60 files
 * sequentially against ONE database with no reset between them. Other
 * files in that suite (e.g. test/db/platformadmin.mysql.test.mjs) create
 * their own APP_OWNER fixtures and never revoke them. So a test here that
 * needs the real "ACTIVE_APP_OWNER_COUNT=0" precondition cannot just
 * ASSERT zero and fail if another file already violated it -- it must
 * force zero first, deterministically, regardless of what ran before it
 * or in what order. This still exercises the exact same real precondition
 * and code paths; it just does not depend on this file's position within
 * a shared, unordered suite. (backend/package.json's dedicated
 * "test:db:bootstrap" script resets the whole database first, so in that
 * standalone run this is a no-op confirming zero, exactly as before.)
 */
async function forceZeroActiveAppOwners() {
  await getPool().query(`UPDATE platform_admin_role_assignments SET revoked_at = NOW(3) WHERE role = 'APP_OWNER' AND revoked_at IS NULL`);
  const [[{ c }]] = await getPool().query(
    `SELECT COUNT(*) AS c FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(Number(c), 0, 'ACTIVE_APP_OWNER_COUNT=0 must hold after forcing it -- if this fails, something is granting APP_OWNER concurrently with this test, which is itself a bug');
}

/** Standard createAccount input shape, mirroring bootstrap-platform-owner.mjs's account-creation fields exactly. */
function firstOwnerAccountInput(adminId, emailHash, now, correlationId) {
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

/**
 * Builds the exact input createFirstOwnerBootstrap needs, mirroring
 * bootstrap-platform-owner.mjs's own preparation step field-for-field
 * (same payload shape, same idempotency-key derivation, same TTLs).
 */
function buildFirstOwnerBootstrapInput(email, now = new Date()) {
  const adminId = randomUUID();
  const emailHash = hashAdminEmail(email);
  const correlationId = randomUUID();
  const { rawToken, tokenHash } = generateActivationToken();
  const activationId = randomUUID();
  const activationExpiresAt = new Date(now.getTime() + 30 * 60_000);
  const url = `http://localhost:4100/platform-admin/activate?token=${encodeURIComponent(rawToken)}`;
  const payload = { toEmail: email, kind: 'PLATFORM_ADMIN_ACTIVATION', code: url };
  const encryptedPayload = encryptOutboxContent(JSON.stringify(payload), process.env);
  const idempotencyKey = computeEmailIdempotencyKey('PLATFORM_ADMIN_ACTIVATION', email, rawToken, process.env);
  const outboxId = randomUUID();
  const outboxExpiresAt = new Date(now.getTime() + OUTBOX_MESSAGE_TTL_MS);
  return {
    adminId,
    rawToken,
    tokenHash,
    activationId,
    outboxId,
    payload,
    input: {
      account: firstOwnerAccountInput(adminId, emailHash, now, correlationId),
      activation: { activationId, tokenHash, createdAt: now, expiresAt: activationExpiresAt },
      outboxEmail: { outboxId, idempotencyKey, encryptedPayload, createdAt: now, expiresAt: outboxExpiresAt, initialClaimableAt: new Date(now.getTime() + EMAIL_OUTBOX_CLAIM_LEASE_MS) },
    },
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

test('DB_CONCURRENCY_TEST: two independent Node subprocesses race for the first-owner bootstrap lock against the same disposable MySQL database', async () => {
  await forceZeroActiveAppOwners();

  const emailA = uniqueEmail('racer-a');
  const emailB = uniqueEmail('racer-b');
  const [resultA, resultB] = await Promise.all([runBootstrapSubprocess(emailA), runBootstrapSubprocess(emailB)]);

  const succeeded = (r) => /^FIRST_OWNER_BOOTSTRAP=ACTIVATION_ISSUED PROVIDER=\S+$/m.test(r.stdout);
  const outcomes = [resultA, resultB];
  const successes = outcomes.filter(succeeded);
  const failures = outcomes.filter((r) => !succeeded(r));
  assert.equal(successes.length, 1, `expected exactly one subprocess to succeed, got ${successes.length}`);
  assert.equal(failures.length, 1);
  assert.match(failures[0].stderr, /already exists/);

  const [ownerRows] = await getPool().query(
    `SELECT ra.admin_id FROM platform_admin_role_assignments ra JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'`,
  );
  assert.equal(ownerRows.length, 1);
  const winnerAdminId = ownerRows[0].admin_id;

  const [[{ c: roleCount }]] = await getPool().query(`SELECT COUNT(*) AS c FROM platform_admin_role_assignments WHERE role = 'APP_OWNER' AND revoked_at IS NULL`);
  assert.equal(Number(roleCount), 1);

  const [emailARows] = await getPool().query(`SELECT admin_id FROM platform_admin_accounts WHERE email_hash = ?`, [hashAdminEmail(emailA)]);
  const [emailBRows] = await getPool().query(`SELECT admin_id FROM platform_admin_accounts WHERE email_hash = ?`, [hashAdminEmail(emailB)]);
  const totalPersisted = emailARows.length + emailBRows.length;
  assert.equal(totalPersisted, 1, 'exactly one racer email must have a persisted account; the other must have zero rows');

  console.log('CONCURRENCY_EXECUTION_MODEL=INDEPENDENT_NODE_SUBPROCESSES');
  console.log('DB_CONCURRENCY_TEST=PASS');
  console.log('CONCURRENT_ATTEMPTS=2');
  console.log('STARTING_ACTIVE_APP_OWNER_COUNT=0');
  console.log(`SUCCESSFUL_BOOTSTRAPS=${successes.length}`);
  console.log(`FINAL_ACTIVE_APP_OWNER_COUNT=${ownerRows.length}`);
  console.log(`FINAL_ACTIVE_APP_OWNER_ROLE_COUNT=${Number(roleCount)}`);
  console.log(`LOSER_PARTIAL_STATE_ROWS=${totalPersisted - 1}`);
  console.log('CONCURRENT_SINGLE_WINNER=PASS');

  await revokeAllActiveAppOwners();
  await getPool().query(`UPDATE platform_admin_activation_tokens SET revoked_at = NOW(3) WHERE admin_id = ? AND revoked_at IS NULL`, [winnerAdminId]);
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

test('BOOTSTRAP_CREATION_ROLLBACK: a forced failure mid-createAccount leaves zero partial rows (still-used primitive, independent of the atomic bootstrap path)', async () => {
  const adminId = randomUUID();
  const now = new Date();
  const email = uniqueEmail('rollback');
  const emailHash = hashAdminEmail(email);
  const correlationId = randomUUID();
  const dupEventId = randomUUID();
  const input = firstOwnerAccountInput(adminId, emailHash, now, correlationId);
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

  console.log('BOOTSTRAP_CREATION_ROLLBACK=PASS');
});

test('BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE (activation-token step): this is the exact scenario that previously stranded a first owner -- now rolls back account/role/MFA/audit/outbox too', async () => {
  // A throwaway PLATFORM_ADMIN account, needed only to give the pre-inserted
  // collision row a valid admin_id to satisfy its foreign key -- deliberately
  // NOT APP_OWNER, so this anchor never counts toward ACTIVE_APP_OWNER_COUNT.
  const anchorInput = firstOwnerAccountInput(randomUUID(), hashAdminEmail(uniqueEmail('collision-anchor-a')), new Date(), randomUUID());
  anchorInput.role = 'PLATFORM_ADMIN';
  const anchor = await repository.createAccount(anchorInput);
  const email = uniqueEmail('atomic-fail-activation');
  const built = buildFirstOwnerBootstrapInput(email);

  // Force the activation-token INSERT (the step that failed in the original
  // stranding defect) to fail via a real ER_DUP_ENTRY on its primary key.
  //
  // The token_hash must be FRESH PER RUN and must NOT equal built.tokenHash:
  //   * fresh, because this row is never cleaned up, so a literal like
  //     'a'.repeat(64) makes the SETUP ITSELF raise ER_DUP_ENTRY on
  //     platform_admin_activation_tokens_hash_key during any later run against
  //     populated state -- an empty-table dependency in the setup of a test
  //     whose whole subject is atomic rollback;
  //   * distinct from built.tokenHash, because the assertions below prove the
  //     rollback by reading back `WHERE token_hash = built.tokenHash` and
  //     requiring zero rows -- using the same value here would make that
  //     assertion vacuous rather than stronger.
  // The forced failure is the PRIMARY KEY collision on activation_id, which is
  // what this test has always exercised.
  const collisionTokenHash = randomBytes(32).toString('hex');
  await getPool().query(
    `INSERT INTO platform_admin_activation_tokens (activation_id, admin_id, token_hash, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, ?, 'PLATFORM_ADMIN_FIRST_TIME', NOW(3), DATE_ADD(NOW(3), INTERVAL 30 MINUTE), NULL, NULL)`,
    [built.activationId, anchor.adminId, collisionTokenHash],
  );

  await assert.rejects(() => createFirstOwnerBootstrap(built.input), (error) => isDuplicateEntry(error));

  const [acctRows] = await getPool().query('SELECT admin_id FROM platform_admin_accounts WHERE admin_id = ?', [built.adminId]);
  const [roleRows] = await getPool().query(`SELECT assignment_id FROM platform_admin_role_assignments WHERE admin_id = ?`, [built.adminId]);
  const [mfaRows] = await getPool().query('SELECT admin_id FROM platform_admin_mfa_state WHERE admin_id = ?', [built.adminId]);
  const [auditRows] = await getPool().query('SELECT event_id FROM platform_admin_audit_events WHERE target_ref = ?', [`admin:${built.adminId}`]);
  const [realTokenRows] = await getPool().query('SELECT activation_id FROM platform_admin_activation_tokens WHERE token_hash = ?', [built.tokenHash]);
  const [outboxRows] = await getPool().query('SELECT outbox_id FROM email_outbox WHERE outbox_id = ?', [built.outboxId]);

  assert.equal(acctRows.length, 0, 'ACCOUNT_DELTA must be 0');
  assert.equal(roleRows.length, 0, 'APP_OWNER_ROLE_DELTA must be 0');
  assert.equal(mfaRows.length, 0, 'MFA_DELTA must be 0');
  assert.equal(auditRows.length, 0, 'AUDIT_DELTA must be 0');
  assert.equal(realTokenRows.length, 0, 'ACTIVATION_DELTA must be 0');
  assert.equal(outboxRows.length, 0, 'OUTBOX_DELTA must be 0');

  console.log('BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE_ACTIVATION_STEP=PASS');
  console.log('ACCOUNT_DELTA=0');
  console.log('APP_OWNER_ROLE_DELTA=0');
  console.log('MFA_DELTA=0');
  console.log('ACTIVATION_DELTA=0');
  console.log('OUTBOX_DELTA=0');
  console.log('AUDIT_DELTA=0');
});

test('BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE (outbox step): a forced failure there rolls back account/role/MFA/audit/activation-token too', async () => {
  const email = uniqueEmail('atomic-fail-outbox');
  const built = buildFirstOwnerBootstrapInput(email);

  // Force the durable outbox INSERT to fail via a real ER_DUP_ENTRY on its
  // primary key. insertEmailOutboxRowOnConnection itself catches that and
  // returns a non-throwing 'DUPLICATE_IDEMPOTENCY_KEY' outcome (correct for
  // its own ordinary callers -- see that function's doc comment);
  // createFirstOwnerBootstrap is the layer that turns a non-INSERTED
  // outcome into a hard failure, since bootstrap has no prior-attempt
  // history to defer to.
  await getPool().query(
    `INSERT INTO email_outbox (outbox_id, idempotency_key, encrypted_iv, encrypted_auth_tag, encrypted_payload, status, attempt_count, next_attempt_at, created_at, expires_at) VALUES (?, ?, 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAA', NULL, 'PENDING', 0, NOW(3), NOW(3), DATE_ADD(NOW(3), INTERVAL 30 MINUTE))`,
    [built.outboxId, `dummy-collision-${randomUUID()}`],
  );

  await assert.rejects(() => createFirstOwnerBootstrap(built.input), /outbox enqueue did not insert a new row/);

  const [acctRows] = await getPool().query('SELECT admin_id FROM platform_admin_accounts WHERE admin_id = ?', [built.adminId]);
  const [roleRows] = await getPool().query(`SELECT assignment_id FROM platform_admin_role_assignments WHERE admin_id = ?`, [built.adminId]);
  const [mfaRows] = await getPool().query('SELECT admin_id FROM platform_admin_mfa_state WHERE admin_id = ?', [built.adminId]);
  const [auditRows] = await getPool().query('SELECT event_id FROM platform_admin_audit_events WHERE target_ref = ?', [`admin:${built.adminId}`]);
  const [tokenRows] = await getPool().query('SELECT activation_id FROM platform_admin_activation_tokens WHERE admin_id = ?', [built.adminId]);

  assert.equal(acctRows.length, 0, 'ACCOUNT_DELTA must be 0');
  assert.equal(roleRows.length, 0, 'APP_OWNER_ROLE_DELTA must be 0');
  assert.equal(mfaRows.length, 0, 'MFA_DELTA must be 0');
  assert.equal(auditRows.length, 0, 'AUDIT_DELTA must be 0');
  assert.equal(tokenRows.length, 0, 'ACTIVATION_DELTA must be 0');

  console.log('BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE_OUTBOX_STEP=PASS');
  console.log('BOOTSTRAP_ATOMIC_ISSUANCE_FAILURE=PASS');
});

test('POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE: provider delivery failure AFTER a successful atomic commit never invalidates the bootstrapped owner', async () => {
  await forceZeroActiveAppOwners();
  const email = uniqueEmail('post-commit-fail');
  const built = buildFirstOwnerBootstrapInput(email);

  const result = await createFirstOwnerBootstrap(built.input);
  assert.equal(result.outboxOutcome, 'INSERTED');

  // Real RejectingEmailProviderAdapter, no real Mailgun/SMTP call -- exactly
  // what a genuinely misconfigured/unreachable provider looks like.
  const deliveryOutcome = await attemptDeliveryAndRecordOutcome(
    { repository: new MySqlEmailOutboxRepository(), providerAdapter: new RejectingEmailProviderAdapter(), env: process.env },
    { outboxId: built.outboxId, attemptCount: 0, expiresAt: built.input.outboxEmail.expiresAt },
    built.payload,
    new Date(),
  );
  assert.equal(deliveryOutcome, 'RETRY_SCHEDULED');

  const [[acctRow]] = await getPool().query(`SELECT status FROM platform_admin_accounts WHERE admin_id = ?`, [built.adminId]);
  assert.equal(acctRow.status, 'ACTIVE');
  const [roleRows] = await getPool().query(`SELECT role FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL`, [built.adminId]);
  assert.equal(roleRows.length, 1);
  assert.equal(roleRows[0].role, 'APP_OWNER');
  const [[mfaRow]] = await getPool().query(`SELECT status FROM platform_admin_mfa_state WHERE admin_id = ?`, [built.adminId]);
  assert.equal(mfaRow.status, 'PENDING_SETUP');
  const [tokenRows] = await getPool().query(`SELECT activation_id FROM platform_admin_activation_tokens WHERE admin_id = ? AND used_at IS NULL AND revoked_at IS NULL`, [built.adminId]);
  assert.equal(tokenRows.length, 1);
  const [[outboxRow]] = await getPool().query(`SELECT status FROM email_outbox WHERE outbox_id = ?`, [built.outboxId]);
  assert.equal(outboxRow.status, 'PENDING');

  // No second APP_OWNER creation becomes possible while this one exists.
  process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL = uniqueEmail('post-commit-fail-second');
  await assert.rejects(() => runBootstrap(), /already exists/);

  console.log('APP_OWNER_EXISTS=YES');
  console.log('MFA_STATUS=PENDING_SETUP');
  console.log('ACTIVATION_TOKEN_EXISTS=YES');
  console.log('OUTBOX_MESSAGE_EXISTS=YES');
  console.log('OUTBOX_RETRYABLE=YES');
  console.log('POST_COMMIT_PROVIDER_FAILURE_RECOVERABLE=PASS');

  await revokeAllActiveAppOwners();
});

test('FIRST_OWNER_END_TO_END_ACTIVATION: full real lifecycle through the atomic bootstrap, then login/whoami/logout', async () => {
  await forceZeroActiveAppOwners();
  const email = uniqueEmail('e2e-owner');
  const built = buildFirstOwnerBootstrapInput(email);
  await createFirstOwnerBootstrap(built.input);
  const { adminId, rawToken } = built;

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
  await forceZeroActiveAppOwners();

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
  await forceZeroActiveAppOwners();

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
