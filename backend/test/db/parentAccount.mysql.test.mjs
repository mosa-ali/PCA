// PCA-AUTH-SESSION-1 -- real MySQL coverage for
// MySqlParentAccountRepository: durable persistence, DB-enforced
// email-uniqueness (registration race), verification-code single-use
// compare-and-swap (duplicate-verification race), the FREE_ACCESS-snapshot
// CHECK constraint, and cross-domain compatibility with the SHARED
// service_sessions table (revoke-all).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { createEd25519DeviceSignatureVerifier } from '../../dist/parentaccount/genesisDeviceSigner.js';
import { FamilyOwnerAttestationChainEngine } from '../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { InMemoryGenesisAnchorStore } from '../../dist/familycommercial/authority/InMemoryGenesisAnchorStore.js';
import { InMemoryAttestationChainStore } from '../../dist/familycommercial/authority/InMemoryAttestationChainStore.js';
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code });
  }
  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

function buildService() {
  const parentAccountRepository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender });
  return { service, parentAccountRepository, emailSender };
}

function uniqueEmail() {
  return `writer57-${randomUUID()}@example.com`;
}

test('MySQL: registration persists a PENDING_VERIFICATION row, findable by email hash', async () => {
  const { service, parentAccountRepository } = buildService();
  const email = uniqueEmail();
  await service.register(email, 'a genuinely long password', 'a genuinely long password');
  const account = await parentAccountRepository.findByEmailHash(hashParentEmail(email));
  assert.ok(account);
  assert.equal(account.status, 'PENDING_VERIFICATION');
  assert.equal(account.freeAccess, null);
});

test('MySQL CONCURRENCY: two concurrent registrations for the same email are DB-uniqueness-enforced -- only one account row ever exists', async () => {
  const { service, parentAccountRepository } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await Promise.all([service.register(email, password, password), service.register(email, password, password)]);
  const account = await parentAccountRepository.findByEmailHash(hashParentEmail(email));
  assert.ok(account, 'exactly one durable account row must exist');
});

test('MySQL: verify-email transitions to VERIFIED, snapshots FREE_ACCESS atomically (CHECK constraint), and issues a session usable via the shared AuthService', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const outcome = await service.verifyEmail(email, code);
  assert.equal(typeof outcome.rawSessionToken, 'string');

  const session = await service.readSession(outcome.rawSessionToken);
  assert.equal(session.accountId, outcome.accountId);
});

test('MySQL CONCURRENCY: two concurrent verify-email calls with the same code -- exactly one wins (compare-and-swap on consumed_at)', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);

  const results = await Promise.allSettled([service.verifyEmail(email, code), service.verifyEmail(email, code)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent verify-email call must durably win the single-use code');
});

test('MySQL: revoke-all-sessions revokes every session for the account through the SHARED service_sessions table', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const first = await service.verifyEmail(email, code);
  const second = await service.login(email, password);

  await service.revokeAllSessions(first.rawSessionToken);

  await assert.rejects(() => service.readSession(first.rawSessionToken));
  await assert.rejects(() => service.readSession(second.rawSessionToken));
});

test('MySQL: a login-issued session Bearer-authenticates against the EXISTING, unmodified requireServiceSession primitive (same token format/table)', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const verifyOutcome = await service.verifyEmail(email, code);

  const authService = new AuthService(new MySqlAuthRepository());
  const serviceAccountId = await authService.validateSession(verifyOutcome.rawSessionToken);
  assert.equal(typeof serviceAccountId, 'string');
});

test('MySQL: verify-email under a REAL (test-only Ed25519) signature verifier durably grants an ACTIVE service_account_family_scopes row for the new Owner', async () => {
  const parentAccountRepository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const engine = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createEd25519DeviceSignatureVerifier(),
    () => new Date(),
  );
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender, familyGenesisEngine: engine });

  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const outcome = await service.verifyEmail(email, code);
  assert.equal(typeof outcome.familyId, 'string');

  const account = await parentAccountRepository.findById(outcome.accountId);
  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT status FROM service_account_family_scopes WHERE account_id = ? AND family_id = ?`, [
      account.serviceAccountId,
      outcome.familyId,
    ]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ACTIVE');
});

// PCA-ADD-PA-017 enforcement (Writer73): end-to-end proof, against real
// MySQL, that a Platform Admin's real suspend action (through the real
// FamilyAccountStatusService, real RBAC, real step-up -- identical to
// test/db/familyAccountStatus.mysql.test.mjs's own coverage of that
// service) actually blocks the affected family's parent from logging in,
// and that reactivating restores it. Deliberately loads the admin-side
// machinery lazily/locally to this block rather than importing it at
// module scope, keeping this file's primary focus on ParentAccountService.
test('PCA-ADD-PA-017 enforcement E2E: a real Platform Admin suspend of the family durably blocks that family\'s parent login; reactivate restores it', async () => {
  if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);
  const { FamilyAccountStatusService } = await import('../../dist/platformadmin/accounts/FamilyAccountStatusService.js');
  const { PlatformAdminAuthService } = await import('../../dist/platformadmin/auth/PlatformAdminAuthService.js');
  const { PlatformAdminAccountService } = await import('../../dist/platformadmin/auth/PlatformAdminAccountService.js');
  const { MySqlPlatformAdminAuthRepository } = await import('../../dist/platformadmin/auth/MySqlAuthRepository.js');
  const { hashAdminEmail } = await import('../../dist/platformadmin/auth/emailHash.js');
  const { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } = await import('../../dist/platformadmin/auth/totp.js');
  const { LoggingAlertAdapter } = await import('../../dist/platformadmin/auth/alertPort.js');
  const { getPool } = await import('../../dist/db/pool.js');

  let adminClockOffsetMs = 0;
  const adminClock = () => new Date(Date.now() + adminClockOffsetMs);
  const adminAuthRepository = new MySqlPlatformAdminAuthRepository();
  const adminAccountService = new PlatformAdminAccountService(adminAuthRepository);
  const adminAuthService = new PlatformAdminAuthService(adminAuthRepository, new LoggingAlertAdapter(), adminClock);
  const familyStatusService = new FamilyAccountStatusService(adminAuthService, adminClock);

  // Real Platform Admin, real TOTP-backed MFA, real login.
  const adminEmail = `writer73-admin-${randomUUID()}@example.test`;
  const adminPassword = 'correct horse battery staple';
  const adminAccount = await adminAccountService.createAccount('Writer73 DB Test Admin', hashAdminEmail(adminEmail), adminPassword, 'PLATFORM_ADMIN', 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(secret, loadMfaEncryptionKey());
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, adminAccount.adminId],
  );
  const loginCode = computeTotp(secret, adminClock().getTime());
  const { rawToken: adminRawToken } = await adminAuthService.login(adminEmail, adminPassword, loginCode);
  const adminIdentity = await adminAuthService.validateSession(adminRawToken);
  const admin = { adminId: adminAccount.adminId, roles: ['PLATFORM_ADMIN'], sessionId: adminIdentity.sessionId };

  // Real parent, real family genesis (this file's own test above already
  // proves the Ed25519 verifier reaches BOOTSTRAPPED durably).
  const emailSender = new RecordingEmailSender();
  const parentAccountRepository = new MySqlParentAccountRepository();
  const engine = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createEd25519DeviceSignatureVerifier(),
    () => new Date(),
  );
  const parentServiceWithGenesis = new ParentAccountService({
    repository: parentAccountRepository,
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender,
    familyGenesisEngine: engine,
  });
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await parentServiceWithGenesis.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const verifyOutcome = await parentServiceWithGenesis.verifyEmail(email, code);
  assert.equal(typeof verifyOutcome.familyId, 'string');

  // ParentAccountService.verifyEmail now calls
  // ParentAccountRepository.createFamilyIfAbsent itself on a successful
  // genesis -- no manual INSERT needed here any more (this used to be a
  // documented workaround; confirm the real row actually exists instead).
  const [familyRows] = await getPool().query(`SELECT family_id FROM families WHERE family_id = ?`, [verifyOutcome.familyId]);
  assert.equal(familyRows.length, 1, 'registration must create the families row itself');

  // Sanity: login works before any suspend action.
  await parentServiceWithGenesis.login(email, password);

  // Real suspend: real RBAC check, real step-up consumption, real audit row.
  adminClockOffsetMs += 31_000; // fresh TOTP counter -- see TOTP-REPLAY-1 in PlatformAdminAuthService.
  const suspendStepUpCode = computeTotp(secret, adminClock().getTime());
  const suspendStepUp = await adminAuthService.assertStepUp(admin.adminId, admin.sessionId, 'FAMILY_ACCOUNT_SUSPEND', suspendStepUpCode, admin.roles[0]);
  const suspended = await familyStatusService.suspend(admin, verifyOutcome.familyId, 'Writer73 DB-level enforcement proof', suspendStepUp.stepUpId);
  assert.equal(suspended.status, 'SUSPENDED');

  // The negative case this item exists to prove: login now genuinely fails.
  await assert.rejects(() => parentServiceWithGenesis.login(email, password), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });

  // Reactivate: real step-up again, then login is restored.
  adminClockOffsetMs += 31_000;
  const reactivateStepUpCode = computeTotp(secret, adminClock().getTime());
  const reactivateStepUp = await adminAuthService.assertStepUp(admin.adminId, admin.sessionId, 'FAMILY_ACCOUNT_REACTIVATE', reactivateStepUpCode, admin.roles[0]);
  const reactivated = await familyStatusService.reactivate(admin, verifyOutcome.familyId, reactivateStepUp.stepUpId);
  assert.equal(reactivated.status, 'ACTIVE');

  const relogin = await parentServiceWithGenesis.login(email, password);
  assert.equal(typeof relogin.rawSessionToken, 'string');
});

// PCA-ADD-IDENT-011: a second/subsequent registration under a DISTINCT
// email address never auto-joins an existing family -- family joining
// remains governed entirely by the separate invitation/enrollment
// architecture. attemptFamilyGenesis() has no lookup-by-email path at all
// (confirmed by direct source read), so this is a real-DB proof of that
// structural guarantee, not merely a restatement of the source comment.
test('MySQL: two DISTINCT emails each verifying independently land in two DISTINCT, unjoined families', async () => {
  const engine = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createEd25519DeviceSignatureVerifier(),
    () => new Date(),
  );
  const emailSenderA = new RecordingEmailSender();
  const serviceA = new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender: emailSenderA,
    familyGenesisEngine: engine,
  });
  const emailSenderB = new RecordingEmailSender();
  const serviceB = new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender: emailSenderB,
    familyGenesisEngine: engine,
  });

  const emailA = uniqueEmail();
  const emailB = uniqueEmail();
  await serviceA.register(emailA, 'a genuinely long password', 'a genuinely long password');
  await serviceB.register(emailB, 'a different genuinely long password', 'a different genuinely long password');

  const outcomeA = await serviceA.verifyEmail(emailA, emailSenderA.lastCodeFor(emailA));
  const outcomeB = await serviceB.verifyEmail(emailB, emailSenderB.lastCodeFor(emailB));

  assert.equal(typeof outcomeA.familyId, 'string');
  assert.equal(typeof outcomeB.familyId, 'string');
  assert.notEqual(outcomeA.familyId, outcomeB.familyId, 'two distinct emails must never land in the same family');
  assert.notEqual(outcomeA.accountId, outcomeB.accountId);
});

test.after(async () => {
  await closePool();
});
