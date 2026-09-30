// PCA-DEC-037 -- real-MySQL proof for Parent family provisioning and TOTP MFA:
// provisioning is transactional, idempotent and race-safe (one family per
// account, enforced by the row lock AND by UNIQUE provisioned_for_account_id);
// grace starts once under concurrency; a TOTP code, a step-up grant and an
// enrollment ticket each win exactly once under concurrency; the secret is
// sealed at rest; and migration 0049 is re-runnable.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { MySqlFamilyMembershipRepository } from '../../dist/familymembers/MySqlFamilyMembershipRepository.js';
import { TestSandboxEmailSender } from '../../dist/parentaccount/TestSandboxEmailSender.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { createParentAccountTestKit, createTestClock, totpFor } from '../support/parentMfaTestKit.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const PASSWORD = 'a genuinely long password value 2026';
const STEP = 30 * 1000;

function build() {
  const clock = createTestClock(new Date().toISOString());
  const repository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository(), clock.now);
  const emailSender = new TestSandboxEmailSender();
  const kit = createParentAccountTestKit({
    repository,
    authService,
    emailSender,
    familyMembershipRepository: new MySqlFamilyMembershipRepository(),
    mfaRepository: new MySqlParentMfaRepository(),
    now: clock.now,
  });
  return { ...kit, clock, repository, authService, emailSender };
}

const email = (label) => `parent-mfa-${label}-${randomUUID()}@example.test`;

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function registerAndVerify(h, address) {
  await h.service.register(address, PASSWORD, PASSWORD);
  await h.service.verifyEmail(address, h.emailSender.lastCodeFor(address));
  return h.repository.findByEmailHash(hashParentEmail(address));
}

async function firstLogin(h, address) {
  return h.service.login(address, PASSWORD);
}

async function enrolled(h, address) {
  await registerAndVerify(h, address);
  const session = await firstLogin(h, address);
  const credential = { kind: 'SESSION', rawSessionToken: session.rawSessionToken };
  const started = await h.service.beginMfaEnrollment(credential, address, PASSWORD);
  const enrolledState = await h.service.confirmMfaEnrollment(credential, address, totpFor(started.secretBase32, h.clock.ms()));
  h.clock.advance(STEP);
  return { secret: started.secretBase32, session, trustedGrant: enrolledState.rawDailyLoginGrantToken };
}

test('provisioning race: 16 concurrent first-family calls create exactly ONE family, ONE ADMINISTRATOR membership, ONE scope', async () => {
  const h = build();
  const address = email('race');
  const account = await registerAndVerify(h, address);
  const issued = await h.authService.issueSession({ accountReferenceHash: createHash('sha256').update(account.accountId, 'utf8').digest() });
  await h.repository.setServiceAccountIdIfAbsent(account.accountId, issued.session.accountId);

  const results = await Promise.all(Array.from({ length: 16 }, () => h.repository.ensureProvisionedFamily(account.accountId, issued.session.accountId, new Date())));
  const familyIds = new Set(results.map((result) => result.familyId));
  assert.equal(familyIds.size, 1, 'every caller observes the same family');
  assert.equal(results.filter((result) => result.created).length, 1, 'exactly one caller created it');
  const [familyId] = familyIds;

  assert.equal((await query('SELECT COUNT(*) AS n FROM families WHERE provisioned_for_account_id = ?', [account.accountId]))[0].n, 1);
  const memberships = await query('SELECT role, status FROM family_parent_memberships WHERE account_id = ?', [account.accountId]);
  assert.deepEqual(memberships.map((row) => ({ ...row })), [{ role: 'ADMINISTRATOR', status: 'ACTIVE' }]);
  assert.equal((await query('SELECT COUNT(*) AS n FROM service_account_family_scopes WHERE account_id = ? AND family_id = ? AND status = ?', [issued.session.accountId, familyId, 'ACTIVE']))[0].n, 1);
  assert.equal((await query('SELECT family_id FROM parent_accounts WHERE account_id = ?', [account.accountId]))[0].family_id, familyId);

  // The database itself refuses a second initial family for this account.
  await assert.rejects(
    query('INSERT INTO families (family_id, family_reference_hash, created_at, provisioned_for_account_id) VALUES (?, ?, NOW(3), ?)', [randomUUID(), Buffer.from(randomUUID()), account.accountId]),
    (error) => error.code === 'ER_DUP_ENTRY',
  );
});

test('provisioning refuses to bind an account to another account\'s service identity, and never revives a REVOKED membership', async () => {
  const h = build();
  const addressA = email('iso-a');
  const addressB = email('iso-b');
  await registerAndVerify(h, addressA);
  await registerAndVerify(h, addressB);
  const sessionA = await firstLogin(h, addressA);
  const sessionB = await firstLogin(h, addressB);
  const accountA = await h.repository.findById(sessionA.accountId);
  const accountB = await h.repository.findById(sessionB.accountId);
  assert.notEqual(sessionA.familyId, sessionB.familyId);
  await assert.rejects(h.repository.ensureProvisionedFamily(accountA.accountId, accountB.serviceAccountId, new Date()), /refused/);

  await query('UPDATE family_parent_memberships SET status = ? WHERE account_id = ?', ['REVOKED', accountA.accountId]);
  await h.repository.ensureProvisionedFamily(accountA.accountId, accountA.serviceAccountId, new Date());
  assert.equal((await query('SELECT status FROM family_parent_memberships WHERE account_id = ?', [accountA.accountId]))[0].status, 'REVOKED');
});

test('grace starts exactly once under 12 concurrent attempts, and is never extended', async () => {
  const h = build();
  const account = await registerAndVerify(h, email('grace'));
  const mfaRepository = new MySqlParentMfaRepository();
  const starts = await Promise.all(Array.from({ length: 12 }, (_, i) => mfaRepository.startGraceIfAbsent(account.accountId, new Date(Date.now() + i * 1000), new Date(Date.now() + 3 * 86400000 + i * 1000))));
  assert.equal(starts.filter(Boolean).length, 1);
  const before = await mfaRepository.findState(account.accountId);
  assert.equal(await mfaRepository.startGraceIfAbsent(account.accountId, new Date(), new Date(Date.now() + 30 * 86400000)), false);
  assert.equal((await mfaRepository.findState(account.accountId)).graceExpiresAt.getTime(), before.graceExpiresAt.getTime());
});

test('one TOTP plus one email OTP authenticates an unknown browser exactly once under 8 concurrent completions', async () => {
  const h = build();
  const address = email('replay');
  const { secret } = await enrolled(h, address);
  const code = totpFor(secret, h.clock.ms());
  assert.equal((await h.service.login(address, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const emailCode = h.emailSender.lastCodeFor(address, 'LOGIN_STEP_UP');
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => h.service.completeLoginStepUp(address, emailCode, code)));
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled' && o.value.status === 'AUTHENTICATED').length, 1);
  assert.ok(outcomes.filter((o) => o.status === 'rejected').every((o) => ['UNAUTHORIZED', 'MFA_INVALID', 'MFA_LOCKED'].includes(o.reason.code)));
});

test('a commercial step-up grant is consumed exactly once under 8 concurrent mutations, and only by the ADMINISTRATOR of that family', async () => {
  const h = build();
  const address = email('stepup');
  const { secret, trustedGrant } = await enrolled(h, address);
  const login = await h.service.login(address, PASSWORD, trustedGrant);
  h.clock.advance(STEP);
  const grant = await h.service.issueCommercialStepUp(login.rawSessionToken, 'BILLING_CHECKOUT_CREATE', totpFor(secret, h.clock.ms()));
  const account = await h.repository.findById(login.accountId);
  const decisions = await Promise.all(Array.from({ length: 8 }, () => h.commercialOwnerAuthority.authorize(account.serviceAccountId, login.familyId, 'BILLING_CHECKOUT_CREATE', grant.stepUpToken)));
  assert.equal(decisions.filter((d) => d === 'OWNER_AUTHORIZED').length, 1);
  assert.equal(decisions.filter((d) => d === 'STEP_UP_REQUIRED').length, 7);
  const events = await query('SELECT event_type, detail FROM parent_account_security_events WHERE account_id = ? ORDER BY occurred_at', [login.accountId]);
  const types = events.map((row) => `${row.event_type}:${row.detail ?? ''}`);
  for (const expected of ['FAMILY_PROVISIONED:', 'PARENT_LOGIN_SUCCESS:', 'MFA_ENROLLED:', 'STEP_UP_GRANTED:BILLING_CHECKOUT_CREATE', 'STEP_UP_CONSUMED:BILLING_CHECKOUT_CREATE']) {
    assert.ok(types.includes(expected), `audited: ${expected}`);
  }
});

test('the TOTP secret is sealed at rest; recovery immediately revokes all auth material before replacement enrollment', async () => {
  const h = build();
  const address = email('recovery');
  const { secret, session } = await enrolled(h, address);
  const [state] = await query('SELECT totp_secret_ciphertext, totp_secret_nonce, status FROM parent_mfa_state WHERE account_id = ?', [session.accountId]);
  assert.equal(state.status, 'ACTIVE');
  assert.ok(!state.totp_secret_ciphertext.toString('latin1').includes(secret));
  const { base32Decode } = await import('../../dist/platformadmin/auth/totp.js');
  assert.ok(!state.totp_secret_ciphertext.includes(base32Decode(secret)));

  const accountBefore = await h.repository.findById(session.accountId);
  const secondSession = await h.service.login(address, PASSWORD, session.rawDailyLoginGrantToken);
  h.clock.advance(STEP);
  const stepUp = await h.service.issueCommercialStepUp(session.rawSessionToken, 'BILLING_CHECKOUT_CREATE', totpFor(secret, h.clock.ms()));
  await h.service.requestMfaRecovery(address, PASSWORD);
  const completed = await h.service.completeMfaRecovery(address, PASSWORD, h.emailSender.lastCodeFor(address, 'MFA_RECOVERY'));
  assert.equal(completed.status, 'MFA_SETUP_REQUIRED');
  assert.equal('recoveryAvailableAt' in completed, false, 'no 24-hour recovery state is returned');
  const [reset] = await query('SELECT status, totp_secret_ciphertext, recovery_hold_started_at, recovery_hold_expires_at, reset_count FROM parent_mfa_state WHERE account_id = ?', [session.accountId]);
  assert.equal(reset.status, 'NOT_ENROLLED', 'the old factor is immediately disabled');
  assert.equal(reset.totp_secret_ciphertext, null);
  assert.equal(reset.recovery_hold_started_at, null);
  assert.equal(reset.recovery_hold_expires_at, null);
  assert.equal(Number(reset.reset_count), 1);
  assert.ok(h.emailSender.kindsFor(address).includes('MFA_RESET'));
  const account = await h.repository.findById(session.accountId);
  assert.equal((await query('SELECT COUNT(*) AS n FROM service_sessions WHERE account_id = ? AND revoked_at IS NULL', [account.serviceAccountId]))[0].n, 0);
  assert.equal((await query('SELECT COUNT(*) AS n FROM parent_daily_login_grants WHERE account_id = ? AND revoked_at IS NULL', [session.accountId]))[0].n, 0);
  assert.equal((await query('SELECT COUNT(*) AS n FROM parent_mfa_step_up_grants WHERE account_id = ? AND consumed_at IS NULL', [session.accountId]))[0].n, 0);
  assert.equal((await query('SELECT COUNT(*) AS n FROM parent_mfa_enrollment_tickets WHERE account_id = ? AND consumed_at IS NULL', [session.accountId]))[0].n, 1, 'only the new recovery ticket remains live');
  await assert.rejects(h.service.readSession(session.rawSessionToken), (error) => error.code === 'UNAUTHORIZED');
  await assert.rejects(h.service.readSession(secondSession.rawSessionToken), (error) => error.code === 'UNAUTHORIZED');
  assert.equal((await h.service.login(address, PASSWORD, session.rawDailyLoginGrantToken)).status, 'STEP_UP_REQUIRED', 'the old browser grant cannot restore the old session');
  assert.equal(await h.commercialOwnerAuthority.authorize(accountBefore.serviceAccountId, session.familyId, 'BILLING_CHECKOUT_CREATE', stepUp.stepUpToken), 'STEP_UP_REQUIRED');

  const credential = { kind: 'TICKET', rawTicket: completed.rawEnrollmentTicket };
  const started = await h.service.beginMfaEnrollment(credential, address, PASSWORD);
  const code = totpFor(started.secretBase32, h.clock.ms());
  const confirmations = await Promise.allSettled(Array.from({ length: 6 }, () => h.service.confirmMfaEnrollment(credential, address, code)));
  assert.equal(confirmations.filter((o) => o.status === 'fulfilled' && o.value.status === 'ENROLLED_SESSION_ESTABLISHED').length, 1, 'one browser session from one ticket');
  h.clock.advance(STEP);
  assert.equal((await h.service.login(address, PASSWORD)).status, 'STEP_UP_REQUIRED');
  const loginCode = h.emailSender.lastCodeFor(address, 'LOGIN_STEP_UP');
  const oldFactor = totpFor(secret, h.clock.ms());
  await assert.rejects(h.service.completeLoginStepUp(address, loginCode, oldFactor), (error) => error.code === 'MFA_INVALID', 'old authenticator no longer authorizes login');
  h.clock.advance(STEP);
  assert.equal((await h.service.completeLoginStepUp(address, loginCode, totpFor(started.secretBase32, h.clock.ms()))).status, 'AUTHENTICATED', 'the confirmed replacement factor works');
});

test('migration 0049 is idempotent: re-running it against the migrated schema changes nothing', async () => {
  const sql = await readFile(new URL('../../migrations/0049_parent_totp_mfa_and_family_provisioning.sql', import.meta.url), 'utf8');
  const connection = await getPool().getConnection();
  try {
    await connection.query({ sql, multipleStatements: true }).catch(async (error) => {
      if (error.code !== 'ER_PARSE_ERROR') throw error;
      // Pool connections are single-statement; replay the file statement by statement.
      for (const statement of sql.split(/;\s*\n/).map((part) => part.replace(/^(\s*--[^\n]*\n)+/g, '').trim()).filter(Boolean)) {
        await connection.query(statement);
      }
    });
  } finally {
    connection.release();
  }
  const columns = await query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'families' AND column_name = 'provisioned_for_account_id'");
  assert.equal(columns[0].n, 1);
});

test('migration 0050 is idempotent after 0051 owns the widened successful-login event constraint', async () => {
  const sql = await readFile(new URL('../../migrations/0050_parent_mfa_recovery_hold.sql', import.meta.url), 'utf8');
  const connection = await getPool().getConnection();
  try {
    await connection.query({ sql, multipleStatements: true }).catch(async (error) => {
      if (error.code !== 'ER_PARSE_ERROR') throw error;
      for (const statement of sql.split(/;\s*\n/).map((part) => part.replace(/^(\s*--[^\n]*\n)+/g, '').trim()).filter(Boolean)) {
        await connection.query(statement);
      }
    });
  } finally {
    connection.release();
  }
  const columns = await query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'parent_mfa_state' AND column_name IN ('recovery_hold_started_at', 'recovery_hold_expires_at')");
  assert.equal(Number(columns[0].n), 2);
  const checks = await query("SELECT COUNT(*) AS n FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'parent_account_security_events' AND constraint_name = 'parent_account_security_events_type_check'");
  assert.equal(Number(checks[0].n), 1);
});

test('migration 0058 reconciles the canonical service-account index and can be replayed', async () => {
  const sql = await readFile(new URL('../../migrations/0058_family_authority_request_challenges_service_index.sql', import.meta.url), 'utf8');
  const connection = await getPool().getConnection();
  const replay = async () => connection.query({ sql, multipleStatements: true }).catch(async (error) => {
      if (error.code !== 'ER_PARSE_ERROR') throw error;
      for (const statement of sql.split(/;\s*\n/).map((part) => part.replace(/^(\s*--[^\n]*\n)+/g, '').trim()).filter(Boolean)) {
        await connection.query(statement);
      }
    });
  let restoreIndex = false;
  try {
    await replay();
    await connection.query('DROP INDEX family_authority_request_challenges_service_fk ON family_authority_request_challenges');
    restoreIndex = true;
    await connection.query('CREATE INDEX family_authority_request_challenges_service_fk ON family_authority_request_challenges (device_id)');
    await assert.rejects(replay(), (error) => error.code === 'ER_DUP_KEYNAME');
    await connection.query('DROP INDEX family_authority_request_challenges_service_fk ON family_authority_request_challenges');
    await replay();
    restoreIndex = false;
  } finally {
    try {
      if (restoreIndex) {
        await connection.query('DEALLOCATE PREPARE pca_0058_create_index_stmt').catch((error) => {
          if (error.code !== 'ER_UNKNOWN_STMT_HANDLER') throw error;
        });
        const [existing] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'family_authority_request_challenges' AND index_name = 'family_authority_request_challenges_service_fk'");
        if (Number(existing[0].n) > 0) {
          await connection.query('DROP INDEX family_authority_request_challenges_service_fk ON family_authority_request_challenges');
        }
        await replay();
      }
    } finally {
      connection.release();
    }
  }
  const indexes = await query("SELECT column_name AS columnName, non_unique AS nonUnique, seq_in_index AS sequence FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'family_authority_request_challenges' AND index_name = 'family_authority_request_challenges_service_fk'");
  assert.deepEqual(indexes.map((index) => ({ column: index.columnName, nonUnique: Number(index.nonUnique), sequence: Number(index.sequence) })), [
    { column: 'service_account_id', nonUnique: 1, sequence: 1 },
  ]);
});

test.after(async () => {
  await closePool();
});
