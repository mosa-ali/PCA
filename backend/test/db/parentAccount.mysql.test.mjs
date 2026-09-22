// PCA-AUTH-SESSION-1 -- real MySQL coverage for
// MySqlParentAccountRepository: durable persistence, DB-enforced
// email-uniqueness (registration race), verification-code single-use
// compare-and-swap (duplicate-verification race), the FREE_ACCESS-snapshot
// CHECK constraint, and cross-domain compatibility with the SHARED
// service_sessions table (revoke-all).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { closePool, execute, getPool, runInTransaction } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code });
  }
  async sendLoginStepUpCode(email, code) {
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

async function loginWithOtp(service, emailSender, email, password) {
  const pending = await service.login(email, password);
  assert.deepEqual(pending, { status: 'STEP_UP_REQUIRED' });
  const stepUpCode = emailSender.lastCodeFor(email, 'LOGIN_STEP_UP');
  return service.completeLoginStepUp(email, stepUpCode);
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
  const second = await loginWithOtp(service, emailSender, email, password);

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

test('MySQL: verify-email does not create family authority or a service scope before the separate DSK genesis ceremony', async () => {
  const parentAccountRepository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender });

  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const outcome = await service.verifyEmail(email, code);
  assert.equal(outcome.familyId, null);

  const account = await parentAccountRepository.findById(outcome.accountId);
  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT COUNT(*) AS count FROM service_account_family_scopes WHERE account_id = ?`, [account.serviceAccountId]),
  );
  assert.equal(Number(rows[0].count), 0);
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

  // Real parent identity plus an explicitly prepared disposable family. The
  // account-to-family binding is test setup for the suspend gate; production
  // genesis remains the separate client-held DSK ceremony.
  const emailSender = new RecordingEmailSender();
  const parentAccountRepository = new MySqlParentAccountRepository();
  const parentServiceWithGenesis = new ParentAccountService({
    repository: parentAccountRepository,
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender,
  });
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await parentServiceWithGenesis.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const verifyOutcome = await parentServiceWithGenesis.verifyEmail(email, code);
  assert.equal(verifyOutcome.familyId, null);
  const familyId = randomUUID();
  await parentAccountRepository.createFamilyIfAbsent(familyId, new Date());
  await bindAccountToFamilyForTest(verifyOutcome.accountId, familyId);
  const boundAccount = await parentAccountRepository.findById(verifyOutcome.accountId);
  await parentAccountRepository.grantFamilyScopeIfAbsent(boundAccount.serviceAccountId, familyId, new Date());
  const [familyRows] = await getPool().query(`SELECT family_id FROM families WHERE family_id = ?`, [familyId]);
  assert.equal(familyRows.length, 1, 'disposable suspend fixture must create its family row');

  // Sanity: login works before any suspend action.
  const preSuspendLogin = await loginWithOtp(parentServiceWithGenesis, emailSender, email, password);

  // Real suspend: real RBAC check, real step-up consumption, real audit row.
  adminClockOffsetMs += 31_000; // fresh TOTP counter -- see TOTP-REPLAY-1 in PlatformAdminAuthService.
  const suspendStepUpCode = computeTotp(secret, adminClock().getTime());
  const suspendStepUp = await adminAuthService.assertStepUp(admin.adminId, admin.sessionId, 'FAMILY_ACCOUNT_SUSPEND', suspendStepUpCode, admin.roles[0]);
  const suspended = await familyStatusService.suspend(admin, familyId, 'Writer73 DB-level enforcement proof', suspendStepUp.stepUpId);
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
  const reactivated = await familyStatusService.reactivate(admin, familyId, reactivateStepUp.stepUpId);
  assert.equal(reactivated.status, 'ACTIVE');

  const relogin = await loginWithOtp(parentServiceWithGenesis, emailSender, email, password);
  assert.equal(typeof relogin.rawSessionToken, 'string');
});

// PCA-ADD-IDENT-011: a second/subsequent registration under a DISTINCT
// email address never auto-joins an existing family. Both identities remain
// unbound until their own client-held genesis ceremony.
test('MySQL: two DISTINCT emails verify independently and remain unbound', async () => {
  const emailSenderA = new RecordingEmailSender();
  const serviceA = new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender: emailSenderA,
  });
  const emailSenderB = new RecordingEmailSender();
  const serviceB = new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService: new AuthService(new MySqlAuthRepository()),
    emailSender: emailSenderB,
  });

  const emailA = uniqueEmail();
  const emailB = uniqueEmail();
  await serviceA.register(emailA, 'a genuinely long password', 'a genuinely long password');
  await serviceB.register(emailB, 'a different genuinely long password', 'a different genuinely long password');

  const outcomeA = await serviceA.verifyEmail(emailA, emailSenderA.lastCodeFor(emailA));
  const outcomeB = await serviceB.verifyEmail(emailB, emailSenderB.lastCodeFor(emailB));

  assert.equal(outcomeA.familyId, null);
  assert.equal(outcomeB.familyId, null);
  assert.notEqual(outcomeA.accountId, outcomeB.accountId);
});

// PENDING_VERIFICATION credential-takeover fix (migration 0030): real-MySQL
// proof that the credential a verification code authorises now travels with
// the CODE ROW, not with the shared, third-party-writable
// parent_accounts.password_hash column, and that a code the real mailbox
// owner already holds stays redeemable after a hostile re-registration.
test('MySQL SECURITY: a hostile re-registration of a still-unverified email cannot install its own credential -- the first registrant\'s own code still verifies and activates THEIR password', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const ownerPassword = 'the real mailbox owner chose this';
  const attackerPassword = 'the attacker chose this other one';

  await service.register(email, ownerPassword, ownerPassword);
  const ownerCode = emailSender.lastCodeFor(email);

  let attackerCode = ownerCode;
  while (attackerCode === ownerCode) {
    await service.register(email, attackerPassword, attackerPassword);
    attackerCode = emailSender.lastCodeFor(email);
  }

  const verified = await service.verifyEmail(email, ownerCode);
  assert.equal(typeof verified.rawSessionToken, 'string');

  await assert.rejects(() => service.login(email, attackerPassword), (err) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    return true;
  });
  const login = await loginWithOtp(service, emailSender, email, ownerPassword);
  assert.equal(typeof login.rawSessionToken, 'string');
});

test('MySQL: parent_email_verification_codes.password_hash stores the same scrypt-derived digest shape as parent_accounts.password_hash -- never a raw password', async () => {
  const { service } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);

  const account = await new MySqlParentAccountRepository().findByEmailHash(hashParentEmail(email));
  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT password_hash FROM parent_email_verification_codes WHERE account_id = ?`, [account.accountId]),
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].password_hash, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(rows[0].password_hash.includes(password), false);
});

// ---------------------------------------------------------------------
// Family-member invitation acceptance is bound to parent_accounts.email_hash.
//
// These two live here, rather than in a file of their own, because
// backend/package.json's `test:db` file list is outside this lane's
// ownership -- a new test file would never actually be run. They belong
// with parent_accounts in any case: the property under test is precisely
// the cross-domain read of THIS table's email_hash column, and both need
// real, separately-registered parent_accounts rows to mean anything.
// ---------------------------------------------------------------------

function pendingInvitationRow(familyId, invitedEmailHash, at) {
  return {
    invitationId: randomUUID(),
    familyId,
    invitedEmailHash,
    role: 'VIEWER',
    status: 'PENDING',
    invitedByAccountId: randomUUID(),
    createdAt: at,
    expiresAt: new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    expiredAt: null,
    revokedAt: null,
    acceptedByAccountId: null,
  };
}

async function registerAndVerifyRealAccount(service, emailSender, email, password) {
  await service.register(email, password, password);
  return service.verifyEmail(email, emailSender.lastCodeFor(email));
}

// PCA-DEC-033 / MySqlFamilyMembershipRepository.findActiveRole.
//
// This deliberately links the repository's two PRODUCTION-REACHABLE methods
// through their real callers instead of calling either method directly:
//
//   FamilyMemberInvitationService.acceptInvitation
//     -> MySqlFamilyMemberAccountBinder
//     -> applyAcceptedInvitationRoleOnConnection (writer)
//
//   ParentAccountService.readSession
//     -> resolveFamilyRole
//     -> findActiveRole (consumer)
//
// The final REVOKED assertion is the hostile half of the reader contract: a
// durable row is not authority merely because it exists. Only ACTIVE may be
// returned to the browser session.
test('MySQL REAL WRITER->CONSUMER: accepted family membership is returned by ParentAccountService, while a revoked row fails closed', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { MySqlFamilyMemberAccountBinder } = await import('../../dist/familymembers/MySqlFamilyMemberAccountBinder.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';
  const owner = await registerAndVerifyRealAccount(service, emailSender, uniqueEmail(), password);
  const memberEmail = uniqueEmail();
  const member = await registerAndVerifyRealAccount(service, emailSender, memberEmail, password);
  const familyId = randomUUID();
  const now = new Date();

  await bindAccountToFamilyForTest(owner.accountId, familyId);
  await bindAccountToFamilyForTest(member.accountId, familyId);
  const beforeInvitation = await service.readSession(member.rawSessionToken);
  assert.equal(beforeInvitation.familyId, familyId);
  assert.equal(beforeInvitation.role, null, 'a family-bound account with no ACTIVE membership must fail closed before invitation acceptance');
  const entitlementRepository = new MySqlEntitlementRepository();
  await entitlementRepository.getOrCreateForFamily(
    familyId,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 2, managedDeviceLimit: 5, updatedAt: now, updatedByAdminId: null },
    now,
  );

  const invitationService = new FamilyMemberInvitationService(
    new MySqlFamilyMemberInvitationRepository(),
    { authorize: () => ({ verdict: 'ALLOW' }) },
    () => now,
    undefined,
    new MySqlFamilyMemberAccountBinder(),
    entitlementRepository,
  );
  const invitation = await invitationService.createInvitation({
    familyId,
    invitedEmail: memberEmail,
    role: 'VIEWER',
    invitedByAccountId: owner.accountId,
    actorDeviceId: 'dev-owner',
  });
  await invitationService.acceptInvitation(invitation.invitationId, member.accountId);

  const activeSession = await service.readSession(member.rawSessionToken);
  assert.equal(activeSession.familyId, familyId);
  assert.equal(activeSession.role, 'VIEWER', 'the real browser-session consumer must see the role written by the real invitation path');

  const [revoked] = await getPool().query(
    `UPDATE family_parent_memberships
     SET status = 'REVOKED', updated_at = ?
     WHERE account_id = ? AND family_id = ? AND status = 'ACTIVE'`,
    [new Date(now.getTime() + 1), member.accountId, familyId],
  );
  assert.equal(revoked.affectedRows, 1, 'hostile precondition: exactly the accepted membership is revoked');

  const revokedSession = await service.readSession(member.rawSessionToken);
  assert.equal(revokedSession.familyId, familyId, 'revoking normal role authority does not rewrite account identity');
  assert.equal(revokedSession.role, null, 'a REVOKED durable row must fail closed through the real ParentAccountService consumer');
});

test('MySQL SECURITY: a family-member invitation can only be accepted by the account whose OWN registered email it was addressed to -- a stranger with a valid session gets NOT_FOUND and the invitation stays PENDING', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { hashInvitedEmail } = await import('../../dist/familymembers/emailHash.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const invitedEmail = uniqueEmail();
  const strangerEmail = uniqueEmail();
  const invited = await registerAndVerifyRealAccount(service, emailSender, invitedEmail, password);
  const stranger = await registerAndVerifyRealAccount(service, emailSender, strangerEmail, password);

  const repository = new MySqlFamilyMemberInvitationRepository();
  const familyId = randomUUID();
  const now = new Date();
  const invitation = pendingInvitationRow(familyId, hashInvitedEmail(invitedEmail), now);
  await repository.createAtomically(invitation, now);

  // A fully authenticated, real parent account that this invitation was
  // simply not addressed to must learn nothing and change nothing.
  const stolen = await repository.acceptAtomically(invitation.invitationId, stranger.accountId, now);
  assert.equal(stolen.outcome, 'NOT_FOUND');
  const afterTheft = await repository.findByIdForFamily(familyId, invitation.invitationId);
  assert.equal(afterTheft.status, 'PENDING');
  assert.equal(afterTheft.acceptedByAccountId, null);

  // The real addressee is unaffected.
  const accepted = await repository.acceptAtomically(invitation.invitationId, invited.accountId, now);
  assert.equal(accepted.outcome, 'ACCEPTED');
  assert.equal(accepted.record.acceptedByAccountId, invited.accountId);

  // And a non-addressee still cannot distinguish an ACCEPTED invitation
  // from one that never existed.
  const afterwards = await repository.acceptAtomically(invitation.invitationId, stranger.accountId, now);
  assert.equal(afterwards.outcome, 'NOT_FOUND');
});

test('MySQL: accepting a family-member invitation consumes exactly one parent-member seat, in the SAME transaction as the invitation transition (a failed adjustment rolls the acceptance back)', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService, NoopFamilyMemberAccountBinder } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { hashInvitedEmail } = await import('../../dist/familymembers/emailHash.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const invitedEmail = uniqueEmail();
  const invited = await registerAndVerifyRealAccount(service, emailSender, invitedEmail, password);

  const repository = new MySqlFamilyMemberInvitationRepository();
  const entitlementRepository = new MySqlEntitlementRepository();
  const familyId = randomUUID();
  const now = new Date();
  await entitlementRepository.getOrCreateForFamily(
    familyId,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 4, managedDeviceLimit: 5, updatedAt: now, updatedByAdminId: null },
    now,
  );
  const before = await entitlementRepository.getForFamily(familyId);
  assert.equal(before.parentMemberUsedCount, 0);

  const authorization = { authorize: () => ({ verdict: 'ALLOW' }) };

  // 1. A seat adjustment that FAILS must leave the invitation PENDING --
  // proof the increment really runs inside the acceptance transaction.
  const failingEntitlementRepository = Object.create(entitlementRepository);
  failingEntitlementRepository.adjustParentMemberUsedCount = async () => {
    throw new Error('entitlement ledger unavailable');
  };
  const failingService = new FamilyMemberInvitationService(
    repository,
    authorization,
    () => now,
    undefined,
    new NoopFamilyMemberAccountBinder(),
    failingEntitlementRepository,
  );
  const doomed = pendingInvitationRow(familyId, hashInvitedEmail(invitedEmail), now);
  await repository.createAtomically(doomed, now);
  await assert.rejects(() => failingService.acceptInvitation(doomed.invitationId, invited.accountId), /entitlement ledger unavailable/);
  const rolledBack = await repository.findByIdForFamily(familyId, doomed.invitationId);
  assert.equal(rolledBack.status, 'PENDING', 'a failed seat adjustment must roll the whole acceptance back');
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 0);

  // 2. The real acceptance charges exactly one seat, durably.
  const memberService = new FamilyMemberInvitationService(
    repository,
    authorization,
    () => now,
    undefined,
    new NoopFamilyMemberAccountBinder(),
    entitlementRepository,
  );
  const accepted = await memberService.acceptInvitation(doomed.invitationId, invited.accountId);
  assert.equal(accepted.status, 'ACCEPTED');
  const after = await entitlementRepository.getForFamily(familyId);
  assert.equal(after.parentMemberUsedCount, 1);

  // 3. A second acceptance attempt is refused and charges nothing more.
  await assert.rejects(() => memberService.acceptInvitation(doomed.invitationId, invited.accountId));
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 1);
});

// ---------------------------------------------------------------------
// Family-member REMOVAL (real MySQL). Lives here for the same reason the
// two acceptance tests immediately above do: backend/package.json's
// test:db file list is outside this lane's ownership, and this file is
// already on it. The property under test is the cross-domain write this
// domain makes into parent_accounts.family_id (removeMemberAtomically),
// which needs real, separately-registered parent_accounts rows to mean
// anything.
// ---------------------------------------------------------------------

/** Directly sets an account's family_id, standing in for what the real MySqlFamilyMemberAccountBinder durably writes after a genuine acceptance (see FamilyMemberInvitationService.acceptInvitation's own doc comment on why that bind is a separate, best-effort step outside acceptAtomically's own transaction). The 0043 membership foreign key requires the synthetic family row to exist before the real binder is exercised. */
async function bindAccountToFamilyForTest(accountId, familyId) {
  const familyReferenceHash = createHash('sha256').update(familyId, 'utf8').digest();
  await runInTransaction(async (conn) => {
    await execute(
      conn,
      `INSERT INTO families (family_id, family_reference_hash, created_at)
       VALUES (?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE family_id = family_id`,
      [familyId, familyReferenceHash],
    );
    await execute(conn, `UPDATE parent_accounts SET family_id = ? WHERE account_id = ?`, [familyId, accountId]);
  });
}

async function readAccountFamilyId(accountId) {
  const { rows } = await runInTransaction((conn) => execute(conn, `SELECT family_id FROM parent_accounts WHERE account_id = ?`, [accountId]));
  return rows[0]?.family_id ?? null;
}

function acceptedInvitationRow(familyId, invitedEmailHash, acceptedByAccountId, at) {
  return {
    invitationId: randomUUID(),
    familyId,
    invitedEmailHash,
    role: 'VIEWER',
    status: 'ACCEPTED',
    invitedByAccountId: randomUUID(),
    createdAt: at,
    expiresAt: new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: at,
    expiredAt: null,
    revokedAt: null,
    acceptedByAccountId,
  };
}

test('MySQL: removeMember clears the target account\'s family_id and releases exactly one parent-member seat, in the SAME transaction -- and a retried removal is a safe, non-double-releasing no-op', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { hashInvitedEmail } = await import('../../dist/familymembers/emailHash.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const ownerEmail = uniqueEmail();
  const memberEmail = uniqueEmail();
  const owner = await registerAndVerifyRealAccount(service, emailSender, ownerEmail, password);
  const member = await registerAndVerifyRealAccount(service, emailSender, memberEmail, password);

  const repository = new MySqlFamilyMemberInvitationRepository();
  const entitlementRepository = new MySqlEntitlementRepository();
  const familyId = randomUUID();
  const now = new Date();

  // owner: bound to the family with NO accepted invitation -- the same
  // structural signature a genuine genesis-anchored Owner account has.
  await bindAccountToFamilyForTest(owner.accountId, familyId);
  // member: bound to the family WITH an accepted invitation -- what a real
  // acceptance + MySqlFamilyMemberAccountBinder durably produces together.
  await repository.createAtomically(acceptedInvitationRow(familyId, hashInvitedEmail(memberEmail), member.accountId, now), now);
  await bindAccountToFamilyForTest(member.accountId, familyId);

  await entitlementRepository.getOrCreateForFamily(
    familyId,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 2, managedDeviceLimit: 5, updatedAt: now, updatedByAdminId: null },
    now,
  );
  await runInTransaction((conn) => entitlementRepository.adjustParentMemberUsedCount(conn, familyId, 1, now)); // simulates the member's own real acceptance having charged its seat
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 1);

  const authorization = { authorize: () => ({ verdict: 'ALLOW' }) };
  const removalService = new FamilyMemberInvitationService(repository, authorization, () => now, undefined, undefined, entitlementRepository);

  // Owner protection: the structural Owner cannot be removed.
  await assert.rejects(
    () => removalService.removeMember(familyId, owner.accountId, member.accountId, 'dev-actor'),
    (err) => err.code === 'CANNOT_REMOVE_OWNER',
  );
  assert.equal(await readAccountFamilyId(owner.accountId), familyId, 'a refused removal must never touch family_id');

  // The real removal: clears family_id, releases the seat, durably.
  await removalService.removeMember(familyId, member.accountId, owner.accountId, 'dev-owner');
  assert.equal(await readAccountFamilyId(member.accountId), null);
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 0);

  // Idempotent retry: already removed -- NOT_FOUND, and no second release.
  await assert.rejects(
    () => removalService.removeMember(familyId, member.accountId, owner.accountId, 'dev-owner'),
    (err) => err.code === 'NOT_FOUND',
  );
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 0, 'a retried removal must never release a second seat');
});

// PCA-FAMILY-REMOVE-ROUNDTRIP: the accounting round trip end to end against
// real MySQL -- accept consumes a seat, capacity is genuinely exhausted,
// removal releases it, and the family can then genuinely invite again.
test('MySQL: after a real removal frees a parent-member seat, a new invitation can be sent using the freed capacity', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService, NoopFamilyMemberAccountBinder } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { MySqlFamilyMemberAccountBinder } = await import('../../dist/familymembers/MySqlFamilyMemberAccountBinder.js');
  const { hashInvitedEmail } = await import('../../dist/familymembers/emailHash.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const ownerEmail = uniqueEmail();
  const memberEmail = uniqueEmail();
  const owner = await registerAndVerifyRealAccount(service, emailSender, ownerEmail, password);
  const member = await registerAndVerifyRealAccount(service, emailSender, memberEmail, password);

  const repository = new MySqlFamilyMemberInvitationRepository();
  const entitlementRepository = new MySqlEntitlementRepository();
  const familyId = randomUUID();
  const now = new Date();
  await bindAccountToFamilyForTest(owner.accountId, familyId);
  await entitlementRepository.getOrCreateForFamily(
    familyId,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 1, managedDeviceLimit: 5, updatedAt: now, updatedByAdminId: null },
    now,
  );

  const authorization = { authorize: () => ({ verdict: 'ALLOW' }) };
  // The REAL account binder this time -- acceptInvitation's own family_id
  // write goes through the exact same production path removeMember's
  // guarded UPDATE later reads/clears.
  const memberService = new FamilyMemberInvitationService(repository, authorization, () => now, undefined, new MySqlFamilyMemberAccountBinder(), entitlementRepository);

  const invitation = await memberService.createInvitation({
    familyId,
    invitedEmail: memberEmail,
    role: 'VIEWER',
    invitedByAccountId: owner.accountId,
    actorDeviceId: 'dev-owner',
  });
  await memberService.acceptInvitation(invitation.invitationId, member.accountId);
  assert.equal(await readAccountFamilyId(member.accountId), familyId, 'the real MySqlFamilyMemberAccountBinder must have durably bound the member');
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 1);

  // Capacity (limit 1) is now genuinely exhausted.
  await assert.rejects(
    () => memberService.createInvitation({ familyId, invitedEmail: uniqueEmail(), role: 'VIEWER', invitedByAccountId: owner.accountId, actorDeviceId: 'dev-owner' }),
    (err) => err.code === 'CAPACITY_EXCEEDED',
  );

  // Remove the member through the real, MySQL-backed atomic path.
  const removalService = new FamilyMemberInvitationService(repository, authorization, () => now, undefined, new NoopFamilyMemberAccountBinder(), entitlementRepository);
  await removalService.removeMember(familyId, member.accountId, owner.accountId, 'dev-owner');
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 0);

  // The freed seat genuinely admits a new invitation -- the round-trip proof.
  const secondEmail = uniqueEmail();
  const secondInvitation = await memberService.createInvitation({
    familyId,
    invitedEmail: secondEmail,
    role: 'VIEWER',
    invitedByAccountId: owner.accountId,
    actorDeviceId: 'dev-owner',
  });
  assert.equal(secondInvitation.status, 'PENDING');

  const secondMember = await registerAndVerifyRealAccount(service, emailSender, secondEmail, password);
  await memberService.acceptInvitation(secondInvitation.invitationId, secondMember.accountId);
  assert.equal(await readAccountFamilyId(secondMember.accountId), familyId);
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 1);
});

// PCA-FAMILY-BINDER-CONTAINMENT: the HOSTILE half of the binder contract.
//
// MySqlFamilyMemberAccountBinder only ever writes family_id when it is
// currently NULL, and only applies the membership role when the row it reads
// back already carries the TARGET family. That guard is the whole reason a
// second invitation cannot move an account between families -- and until this
// test it was exercised only on the success path, where the account is
// unbound and the guard never has to refuse anything. A success-path-only test
// cannot distinguish "the guard works" from "the guard is absent", which is
// the classic shape of a security property that reads as covered and is not.
test('MySQL SECURITY: an account already bound to ONE family is REFUSED when it tries to accept a second family invitation -- the invitation stays PENDING and that family spends NO seat', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { MySqlFamilyMemberAccountBinder } = await import('../../dist/familymembers/MySqlFamilyMemberAccountBinder.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const repository = new MySqlFamilyMemberInvitationRepository();
  const entitlementRepository = new MySqlEntitlementRepository();
  const authorization = { authorize: () => ({ verdict: 'ALLOW' }) };
  const memberService = new FamilyMemberInvitationService(
    repository,
    authorization,
    () => new Date(),
    undefined,
    new MySqlFamilyMemberAccountBinder(),
    entitlementRepository,
  );

  // The account that will end up in TWO competing invitations. It is registered
  // and verified for real, and its OWN email is the address both invitations
  // are sent to, so the repository's identity binding accepts it in both cases.
  const memberEmail = uniqueEmail();
  const member = await registerAndVerifyRealAccount(service, emailSender, memberEmail, password);

  // FAMILY A -- bound through the REAL production path, not a helper.
  const familyA = randomUUID();
  const ownerA = await registerAndVerifyRealAccount(service, emailSender, uniqueEmail(), password);
  await bindAccountToFamilyForTest(ownerA.accountId, familyA);
  // A real entitlement row per family, so "no seat was spent" is MEASURED rather
  // than inferred from the absence of a ledger. Without a row, the seat hook's
  // lockForFamily returns null and charges nothing no matter what the conflict
  // handling does -- a test that would pass even if the refusal were absent.
  await entitlementRepository.getOrCreateForFamily(
    familyA,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 4, managedDeviceLimit: 5, updatedAt: new Date(), updatedByAdminId: null },
    new Date(),
  );
  const invitationA = await memberService.createInvitation({
    familyId: familyA,
    invitedEmail: memberEmail,
    role: 'VIEWER',
    invitedByAccountId: ownerA.accountId,
    actorDeviceId: 'dev-owner-a',
  });
  await memberService.acceptInvitation(invitationA.invitationId, member.accountId);
  assert.equal(await readAccountFamilyId(member.accountId), familyA, 'precondition: family A bound this account through the real accept path');

  // FAMILY B -- a completely separate family invites the SAME account.
  const familyB = randomUUID();
  const ownerB = await registerAndVerifyRealAccount(service, emailSender, uniqueEmail(), password);
  await bindAccountToFamilyForTest(ownerB.accountId, familyB);
  await entitlementRepository.getOrCreateForFamily(
    familyB,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 4, managedDeviceLimit: 5, updatedAt: new Date(), updatedByAdminId: null },
    new Date(),
  );
  const invitationB = await memberService.createInvitation({
    familyId: familyB,
    invitedEmail: memberEmail,
    role: 'ADMINISTRATOR',
    invitedByAccountId: ownerB.accountId,
    actorDeviceId: 'dev-owner-b',
  });

  // PCA-DEC-036. The acceptance is now REFUSED, distinguishably. Before the fix
  // this call SUCCEEDED -- the invitation really was addressed to this account's
  // own email, so the repository's identity binding was satisfied, and the bind
  // only ran afterwards, too late to un-spend anything. The previous version of
  // this test asserted that consumption as an observation ("RECORDED, NOT
  // ENDORSED"); that assertion is now inverted, because the owner ruled the
  // consumption itself the defect.
  await assert.rejects(
    () => memberService.acceptInvitation(invitationB.invitationId, member.accountId),
    (err) => err?.code === 'FAMILY_CONFLICT',
    'a second family must be refused with a DISTINGUISHABLE conflict, not a generic failure and not a silent success',
  );

  // THE PROPERTY UNDER TEST. The binder refuses to move the account and grants
  // it no role in a family it is not bound to.
  assert.equal(
    await readAccountFamilyId(member.accountId),
    familyA,
    'an account already bound to one family must NEVER be reassigned to another by accepting a second invitation',
  );
  const membershipsInB = await getPool().query(
    'SELECT membership_id FROM family_parent_memberships WHERE account_id = ? AND family_id = ?',
    [member.accountId, familyB],
  );
  assert.equal(membershipsInB[0].length, 0, 'the account must gain NO membership row in the family it was not bound to');
  const membershipsInA = await getPool().query(
    'SELECT role, status FROM family_parent_memberships WHERE account_id = ? AND family_id = ?',
    [member.accountId, familyA],
  );
  assert.equal(membershipsInA[0].length, 1, 'the original membership must survive untouched');
  assert.equal(membershipsInA[0][0].status, 'ACTIVE');
  assert.equal(membershipsInA[0][0].role, 'VIEWER', 'and its role must not be silently upgraded by the second invitation');

  // NOTHING WAS CONSUMED BY THE LOSING FAMILY. Both facts are read back from the
  // database, and both were FALSE before the fix: the invitation was ACCEPTED
  // and the family had burned a seat for a membership it never received.
  const unconsumedInvitationB = await repository.findByIdForFamily(familyB, invitationB.invitationId);
  assert.equal(unconsumedInvitationB.status, 'PENDING', 'the refused acceptance must leave the invitation PENDING, still usable once the conflict is resolved');
  assert.equal(unconsumedInvitationB.acceptedAt, null);
  assert.equal(unconsumedInvitationB.acceptedByAccountId, null);
  assert.equal(
    (await entitlementRepository.getForFamily(familyB)).parentMemberUsedCount,
    0,
    "a refused acceptance must never charge the losing family a parent-member seat",
  );
  assert.equal(
    (await entitlementRepository.getForFamily(familyA)).parentMemberUsedCount,
    1,
    'and the winning family must keep exactly the one seat its own acceptance legitimately charged',
  );
});

// PCA-DEC-036, the case the owner singled out: TWO FAMILIES CONCURRENTLY
// ACCEPTING INVITATIONS FOR THE SAME INITIALLY-UNBOUND ACCOUNT. The serial test
// above cannot reach this, because in it the account is ALREADY bound by the
// time the losing family tries -- the loser is refused by a fact that was true
// before it started. Here both transactions observe an UNBOUND account, which is
// precisely the window in which a read-before-write pre-check lets both
// families believe they may proceed.
//
// Three layers of durability doctrine are all load-bearing here:
//   INSPECTION != PROOF   -- the guarded UPDATE was already in the binder and
//                            looked conclusive; reading it proves nothing.
//   ISOLATED_PASS != CONCURRENCY_PROOF -- each acceptance succeeds on its own.
//   SERIAL_PASS != CONCURRENCY_PROOF -- the test above passes with a naive
//                            check-then-write design that this one fails.
// The property is exact: EXACTLY ONE family succeeds, and the loser's invitation
// AND seat are both untouched.
test('MySQL CONCURRENCY (PCA-DEC-036): two families accepting invitations for the SAME initially-unbound account -- exactly one wins, and the loser keeps its invitation and its seat', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { MySqlFamilyMemberAccountBinder } = await import('../../dist/familymembers/MySqlFamilyMemberAccountBinder.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const repository = new MySqlFamilyMemberInvitationRepository();
  const entitlementRepository = new MySqlEntitlementRepository();
  const authorization = { authorize: () => ({ verdict: 'ALLOW' }) };
  const memberService = new FamilyMemberInvitationService(
    repository,
    authorization,
    () => new Date(),
    undefined,
    new MySqlFamilyMemberAccountBinder(),
    entitlementRepository,
  );

  // The contended account: registered and verified for real, and deliberately
  // bound to NO family -- this is what makes the race possible at all.
  const memberEmail = uniqueEmail();
  const member = await registerAndVerifyRealAccount(service, emailSender, memberEmail, password);
  assert.equal(await readAccountFamilyId(member.accountId), null, 'precondition: the contended account is initially UNBOUND');

  // Two independent families, each with its own real entitlement ledger so both
  // seat outcomes are measurable. Different roles, so the membership row proves
  // WHICH family's invitation was the one that took effect.
  const familyA = randomUUID();
  const familyB = randomUUID();
  const ownerA = await registerAndVerifyRealAccount(service, emailSender, uniqueEmail(), password);
  const ownerB = await registerAndVerifyRealAccount(service, emailSender, uniqueEmail(), password);
  await bindAccountToFamilyForTest(ownerA.accountId, familyA);
  await bindAccountToFamilyForTest(ownerB.accountId, familyB);
  for (const familyId of [familyA, familyB]) {
    await entitlementRepository.getOrCreateForFamily(
      familyId,
      'FREE_STARTER',
      { tier: 'FREE_STARTER', parentMemberLimit: 4, managedDeviceLimit: 5, updatedAt: new Date(), updatedByAdminId: null },
      new Date(),
    );
  }

  const invitationA = await memberService.createInvitation({
    familyId: familyA, invitedEmail: memberEmail, role: 'VIEWER', invitedByAccountId: ownerA.accountId, actorDeviceId: 'dev-owner-a',
  });
  const invitationB = await memberService.createInvitation({
    familyId: familyB, invitedEmail: memberEmail, role: 'ADMINISTRATOR', invitedByAccountId: ownerB.accountId, actorDeviceId: 'dev-owner-b',
  });

  // FIRE BOTH ACCEPTANCES AT THE SAME TIME. Not `for ... await`: that is the
  // serial test again. Both transactions must be genuinely in flight together,
  // each having observed the account as unbound.
  const [settledA, settledB] = await Promise.allSettled([
    memberService.acceptInvitation(invitationA.invitationId, member.accountId),
    memberService.acceptInvitation(invitationB.invitationId, member.accountId),
  ]);

  const results = [
    { label: 'A', familyId: familyA, invitationId: invitationA.invitationId, role: 'VIEWER', settled: settledA },
    { label: 'B', familyId: familyB, invitationId: invitationB.invitationId, role: 'ADMINISTRATOR', settled: settledB },
  ];
  const winners = results.filter((r) => r.settled.status === 'fulfilled');
  const losers = results.filter((r) => r.settled.status === 'rejected');
  assert.equal(
    winners.length,
    1,
    `EXACTLY ONE family may win an account. Observed ${winners.length} fulfilled, ${losers.length} rejected; rejection reasons: ${losers.map((l) => `${l.label}=${l.settled.reason?.code ?? l.settled.reason?.message}`).join(', ')}`,
  );
  const winner = winners[0];
  const loser = losers[0];

  // The loser is refused DISTINGUISHABLY -- not with a generic error, and not by
  // being told the invitation it can plainly see is missing.
  assert.equal(
    loser.settled.reason?.code,
    'FAMILY_CONFLICT',
    `the losing family must be told the truth (FAMILY_CONFLICT), got: ${loser.settled.reason?.code ?? loser.settled.reason?.message}`,
  );

  // 1. THE ACCOUNT IS BOUND TO THE WINNER ONLY -- never both, never the loser.
  assert.equal(await readAccountFamilyId(member.accountId), winner.familyId, 'the account must be bound to the winner and ONLY the winner');
  assert.equal(await readAccountFamilyId(member.accountId) === loser.familyId, false, 'the account must not be bound to the losing family');

  // 2. THE VIEWER OF THE LOSS: the losing family's invitation is untouched --
  //    still acceptable, with no acceptance stamped on it.
  const loserInvitation = await repository.findByIdForFamily(loser.familyId, loser.invitationId);
  assert.equal(loserInvitation.status, 'PENDING', "the loser's invitation must remain unconsumed, unlike before this fix where it was silently burned");
  assert.equal(loserInvitation.acceptedAt, null, "the loser's invitation must not record an acceptance time");
  assert.equal(loserInvitation.acceptedByAccountId, null, "the loser's invitation must not record an accepting account");

  // 3. THE WINNER'S INVITATION IS CONSUMED, exactly once.
  const winnerInvitation = await repository.findByIdForFamily(winner.familyId, winner.invitationId);
  assert.equal(winnerInvitation.status, 'ACCEPTED');
  assert.equal(winnerInvitation.acceptedByAccountId, member.accountId);

  // 4. SEAT ACCOUNTING FOLLOWS THE INVITATION, NOT THE ATTEMPT: the winner pays
  //    for the member it actually gained; the loser pays nothing. Checked in
  //    BOTH directions -- a lost-update bug that charged both (or neither) is
  //    caught whichever way it failed.
  assert.equal(
    (await entitlementRepository.getForFamily(winner.familyId)).parentMemberUsedCount,
    1,
    'the winning family must be charged exactly one seat for the member it gained',
  );
  assert.equal(
    (await entitlementRepository.getForFamily(loser.familyId)).parentMemberUsedCount,
    0,
    'the losing family must be charged NOTHING for a member it does not have',
  );

  // 5. MEMBERSHIP FOLLOWS THE WINNER'S OWN INVITATION ROLE -- proving the role
  //    applied belongs to the acceptance that actually won, not to whichever
  //    invitation happened to be created last.
  const winnerMemberships = await getPool().query(
    'SELECT role, status FROM family_parent_memberships WHERE account_id = ? AND family_id = ?',
    [member.accountId, winner.familyId],
  );
  assert.equal(winnerMemberships[0].length, 1);
  assert.equal(winnerMemberships[0][0].status, 'ACTIVE');
  assert.equal(winnerMemberships[0][0].role, winner.role, "the membership role must come from the winning family's own invitation");
  const loserMemberships = await getPool().query(
    'SELECT membership_id FROM family_parent_memberships WHERE account_id = ? AND family_id = ?',
    [member.accountId, loser.familyId],
  );
  assert.equal(loserMemberships[0].length, 0, 'the losing family must have NO membership row for this account');

  // 6. And the refusal is durable, not merely reported: the losing family can
  //    still be refused a second time without consuming anything, which is what
  //    \"the invitation remains usable\" has to mean in practice.
  await assert.rejects(
    () => memberService.acceptInvitation(loser.invitationId, member.accountId),
    (err) => err?.code === 'FAMILY_CONFLICT',
  );
  assert.equal((await repository.findByIdForFamily(loser.familyId, loser.invitationId)).status, 'PENDING');
  assert.equal((await entitlementRepository.getForFamily(loser.familyId)).parentMemberUsedCount, 0);
});

// PCA-ADD-PA-023-style row-locking proof: two DIFFERENT members of the SAME
// family removed concurrently must both durably decrement
// account_entitlements.parent_member_used_count -- neither release may be
// lost to the other. Mirrors complimentaryGrants.mysql.test.mjs's own
// "concurrent writers to the same family row never lose either update"
// convention (lockForFamily's SELECT ... FOR UPDATE is what serializes the
// two competing transactions).
test('MySQL CONCURRENCY: two concurrent removals of different members in the SAME family both durably release their seat -- no lost update under the account_entitlements row lock', async () => {
  const { MySqlFamilyMemberInvitationRepository } = await import('../../dist/familymembers/MySqlFamilyMemberInvitationRepository.js');
  const { FamilyMemberInvitationService } = await import('../../dist/familymembers/FamilyMemberInvitationService.js');
  const { hashInvitedEmail } = await import('../../dist/familymembers/emailHash.js');
  const { MySqlEntitlementRepository } = await import('../../dist/entitlements/MySqlEntitlementRepository.js');
  const { service, emailSender } = buildService();
  const password = 'a genuinely long password';

  const ownerEmail = uniqueEmail();
  const memberAEmail = uniqueEmail();
  const memberBEmail = uniqueEmail();
  const owner = await registerAndVerifyRealAccount(service, emailSender, ownerEmail, password);
  const memberA = await registerAndVerifyRealAccount(service, emailSender, memberAEmail, password);
  const memberB = await registerAndVerifyRealAccount(service, emailSender, memberBEmail, password);

  const repository = new MySqlFamilyMemberInvitationRepository();
  const entitlementRepository = new MySqlEntitlementRepository();
  const familyId = randomUUID();
  const now = new Date();

  await bindAccountToFamilyForTest(owner.accountId, familyId);
  await repository.createAtomically(acceptedInvitationRow(familyId, hashInvitedEmail(memberAEmail), memberA.accountId, now), now);
  await bindAccountToFamilyForTest(memberA.accountId, familyId);
  await repository.createAtomically(acceptedInvitationRow(familyId, hashInvitedEmail(memberBEmail), memberB.accountId, now), now);
  await bindAccountToFamilyForTest(memberB.accountId, familyId);

  await entitlementRepository.getOrCreateForFamily(
    familyId,
    'FREE_STARTER',
    { tier: 'FREE_STARTER', parentMemberLimit: 3, managedDeviceLimit: 5, updatedAt: now, updatedByAdminId: null },
    now,
  );
  await runInTransaction((conn) => entitlementRepository.adjustParentMemberUsedCount(conn, familyId, 2, now)); // both members' seats already charged
  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 2);

  const authorization = { authorize: () => ({ verdict: 'ALLOW' }) };
  const removalService = new FamilyMemberInvitationService(repository, authorization, () => now, undefined, undefined, entitlementRepository);

  await Promise.all([
    removalService.removeMember(familyId, memberA.accountId, owner.accountId, 'dev-owner'),
    removalService.removeMember(familyId, memberB.accountId, owner.accountId, 'dev-owner'),
  ]);

  assert.equal((await entitlementRepository.getForFamily(familyId)).parentMemberUsedCount, 0, 'both concurrent releases must be durably reflected -- neither lost to the other');
  assert.equal(await readAccountFamilyId(memberA.accountId), null);
  assert.equal(await readAccountFamilyId(memberB.accountId), null);
});

test.after(async () => {
  await closePool();
});
