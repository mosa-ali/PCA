// PCA-COMPLIMENTARY-ENTITLEMENTS-1: real-MySQL tests for the complimentary
// entitlement grant domain (PCA-ADD-COMP-001..025). Covers: effective-
// entitlement summation, idempotent create/revoke/renew, the five required
// concurrency scenarios (PCA-ADD-COMP-021), RBAC/step-up/redaction, and an
// HTTP smoke test through the real route module -- mirroring
// test/db/platformEntitlementsCore.mysql.test.mjs's structure/helpers.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'cd'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool, runInTransaction } from '../../dist/db/pool.js';
import { MySqlComplimentaryGrantRepository } from '../../dist/entitlements/complimentary/MySqlComplimentaryGrantRepository.js';
import { ComplimentaryEntitlementService, ComplimentaryGrantError } from '../../dist/entitlements/complimentary/ComplimentaryEntitlementService.js';
import { buildMyKidsComplimentaryReadModel, buildEffectiveEntitlementDto } from '../../dist/entitlements/complimentary/MyKidsComplimentaryReadModel.js';
import { PlatformAdminComplimentaryGrantService, PlatformAdminComplimentaryError } from '../../dist/platformadmin/complimentary/PlatformAdminComplimentaryGrantService.js';
import { registerComplimentaryGrantRoutes } from '../../dist/http/routes/platformadmin/complimentaryGrantRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(authRepository);
const grantRepository = new MySqlComplimentaryGrantRepository();
const entitlementRepository = new MySqlEntitlementRepository();
const complimentaryService = new ComplimentaryEntitlementService(grantRepository);

// EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
// Round6): separate, EXPLICITLY complimentary-aware instances -- kept
// distinct from `entitlementRepository`/`entitlementService` used by the
// pre-existing tests above (which intentionally stay wired base-only) so
// this extension never changes any already-passing test's behavior.
const entitlementRepositoryEffective = new MySqlEntitlementRepository(grantRepository);
const changeRequestRepositoryStub = { listOpenForFamily: async () => [] };
const entitlementServiceEffective = new EntitlementService(entitlementRepositoryEffective, changeRequestRepositoryStub);
const slotReservationRepositoryEffective = new MySqlSlotReservationRepository(entitlementRepositoryEffective, grantRepository);
const slotReservationServiceEffective = new SlotReservationService(slotReservationRepositoryEffective);

async function insertRawInvitationForComplimentaryTests(familyId, expiresAt) {
  const invitationId = randomUUID();
  await getPool().query(
    `INSERT INTO enrollment_invitations
       (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at, opened_at, redeemed_at, revoked_at)
     VALUES (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'CREATED', NOW(3), ?, NULL, NULL, NULL)`,
    [invitationId, familyId, randomUUID().replace(/-/g, '').padEnd(64, '0'), expiresAt],
  );
  return invitationId;
}

let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);
const adminComplimentaryService = new PlatformAdminComplimentaryGrantService(authService, complimentaryService, clock);

function uniqueFamilyId(label) {
  return `family-${label}-${randomUUID()}`;
}

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'PLATFORM_ADMIN' } = {}) {
  const email = uniqueEmail('admin');
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const code = computeTotp(secret, clock().getTime());
  const { rawToken } = await authService.login(email, password, code);
  const identity = await authService.validateSession(rawToken);
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret, rawToken };
}

async function stepUpFor(admin, scope) {
  clockOffsetMs += 31_000;
  const code = computeTotp(admin.secret, clock().getTime());
  const result = await authService.assertStepUp(admin.adminId, admin.sessionId, scope, code, admin.roles[0]);
  return result.stepUpId;
}

function actorOf(admin) {
  return { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
}

async function countAuditEvents(eventType, targetRef) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM platform_admin_audit_events WHERE event_type = ? AND target_ref = ?`, [eventType, targetRef]);
  return rows[0].n;
}

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-005: effective entitlement = base + sum(ACTIVE grants)
// ---------------------------------------------------------------------------

test('effective capacity: base + one active grant sums correctly, base row never mutated', async () => {
  const familyId = uniqueFamilyId('sum');
  const now = new Date();
  await entitlementRepository.getOrCreateForFamily(familyId, 'FREE_STARTER', { tier: 'FREE_STARTER', parentMemberLimit: 1, managedDeviceLimit: 1, updatedAt: now, updatedByAdminId: null }, now);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'BETA_TESTER',
    amountOrAllowance: 4,
    effectiveFrom: now,
    expiresAt: null,
    reasonCode: 'BETA_PROGRAM',
    internalNote: null,
    stepUpId,
  });

  const capacity = await complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', 1, new Date());
  assert.equal(capacity.baseAmount, 1);
  assert.equal(capacity.complimentaryAmount, 4);
  assert.equal(capacity.effectiveTotal, 5);

  const base = await entitlementRepository.getForFamily(familyId);
  assert.equal(base.managedDeviceLimit, 1, 'base account_entitlements row must never be mutated by a grant');
});

test('COMMERCIAL_ACCESS grant rejects a non-marker amount', async () => {
  await assert.rejects(
    () =>
      complimentaryService.createGrant(
        {
          familyId: uniqueFamilyId('bad-amount'),
          entitlementType: 'COMMERCIAL_ACCESS',
          category: 'PARTNER',
          amountOrAllowance: 3,
          effectiveFrom: new Date(),
          expiresAt: null,
          reasonCode: 'X',
          internalNote: null,
          grantedByAdminId: 'irrelevant',
        },
        new Date(),
      ),
    (err) => err instanceof ComplimentaryGrantError && err.code === 'INVALID_AMOUNT',
  );
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-006/021: duplicate grant activation
// ---------------------------------------------------------------------------

test('CONCURRENCY: duplicate grant activation -- two concurrent creates sharing the SAME stepUpId apply exactly once', async () => {
  const familyId = uniqueFamilyId('dup-activate');
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  const request = {
    familyId,
    entitlementType: 'PARENT_MEMBER_CAPACITY',
    category: 'PROMOTION',
    amountOrAllowance: 2,
    effectiveFrom: new Date(),
    // Non-null expiresAt deliberately: this test exercises PLATFORM_ADMIN,
    // which is forbidden from issuing a PERMANENT (expiresAt=null) grant
    // (PCA-ADD-COMP-014) -- that is a separate, already-covered RBAC test
    // below, not what this duplicate-activation race is testing.
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    reasonCode: 'PROMO',
    internalNote: null,
    stepUpId,
  };

  const results = await Promise.allSettled([
    adminComplimentaryService.createGrant(actorOf(admin), request),
    adminComplimentaryService.createGrant(actorOf(admin), request),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(succeeded.length, 1, 'single-use stepUpId must let exactly one concurrent create succeed');
  assert.equal(failed.length, 1);

  const capacity = await complimentaryService.computeEffectiveCapacity(familyId, 'PARENT_MEMBER_CAPACITY', 0, new Date());
  assert.equal(capacity.complimentaryAmount, 2, 'no double-counted capacity from the duplicate activation attempt');
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-021: concurrent grant + revoke on the same grant
// ---------------------------------------------------------------------------

test('CONCURRENCY: concurrent revoke attempts on the same grant apply exactly once, idempotent, one audit event', async () => {
  const familyId = uniqueFamilyId('concurrent-revoke');
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const createStepUp = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  const created = await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'STAFF',
    amountOrAllowance: 3,
    effectiveFrom: new Date(),
    expiresAt: null,
    reasonCode: 'STAFF_GRANT',
    internalNote: 'internal',
    stepUpId: createStepUp,
  });

  const stepUp1 = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  const stepUp2 = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');

  const results = await Promise.allSettled([
    adminComplimentaryService.revokeGrant(actorOf(admin), created.grantId, 'DUPLICATE_ATTEMPT_1', stepUp1),
    adminComplimentaryService.revokeGrant(actorOf(admin), created.grantId, 'DUPLICATE_ATTEMPT_2', stepUp2),
  ]);

  for (const r of results) assert.equal(r.status, 'fulfilled', 'revoke is idempotent -- an already-revoked grant returns its current state, not an error');
  for (const r of results) assert.equal(r.value.status, 'REVOKED');

  const auditCount = await countAuditEvents('COMPLIMENTARY_GRANT_REVOKED', `complimentary-grant:${created.grantId}`);
  assert.equal(auditCount, 1, 'exactly one REVOKED audit event, never a duplicate from the race');

  const capacity = await complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', 0, new Date());
  assert.equal(capacity.complimentaryAmount, 0, 'a revoked grant no longer contributes capacity');
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-021: concurrent effective-limit recalculation
// ---------------------------------------------------------------------------

test('CONCURRENCY: concurrent effective-capacity reads while a grant is being created never observe a torn/double-counted sum', async () => {
  const familyId = uniqueFamilyId('concurrent-recalc');
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');

  const [, ...reads] = await Promise.all([
    adminComplimentaryService.createGrant(actorOf(admin), {
      familyId,
      entitlementType: 'MANAGED_DEVICE_CAPACITY',
      category: 'OTHER',
      amountOrAllowance: 7,
      effectiveFrom: new Date(),
      expiresAt: null,
      reasonCode: 'RECALC_TEST',
      internalNote: null,
      stepUpId,
    }),
    complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', 1, new Date()),
    complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', 1, new Date()),
    complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', 1, new Date()),
  ]);
  // Every concurrent read must observe EITHER the pre-create total (1) OR
  // the post-create total (8) -- never anything else (a torn read, a
  // negative, or a value implying the +7 grant was counted more than once).
  for (const r of reads) assert.ok(r.effectiveTotal === 1 || r.effectiveTotal === 8, `unexpected effective total: ${r.effectiveTotal}`);

  const final = await complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', 1, new Date());
  assert.equal(final.effectiveTotal, 8, 'after the create settles, the total must reflect the grant exactly once');
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-011/021: expiry race
// ---------------------------------------------------------------------------

test('CONCURRENCY: expiry race -- a grant expiring mid-flight never double-counts and expires exactly once', async () => {
  const familyId = uniqueFamilyId('expiry-race');
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  const almostNow = new Date(Date.now() + 150);
  const created = await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'PARENT_MEMBER_CAPACITY',
    category: 'TEMPORARY_COMPLIMENTARY',
    amountOrAllowance: 2,
    effectiveFrom: new Date(),
    expiresAt: almostNow,
    reasonCode: 'TEMP_TRIAL',
    internalNote: null,
    stepUpId,
  });
  assert.equal(created.status, 'ACTIVE');

  // Wait until strictly past expiry, then race several concurrent reads
  // against the lazy expiry sweep.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterExpiry = new Date();
  const reads = await Promise.all([
    complimentaryService.computeEffectiveCapacity(familyId, 'PARENT_MEMBER_CAPACITY', 0, afterExpiry),
    complimentaryService.computeEffectiveCapacity(familyId, 'PARENT_MEMBER_CAPACITY', 0, afterExpiry),
    complimentaryService.computeEffectiveCapacity(familyId, 'PARENT_MEMBER_CAPACITY', 0, afterExpiry),
  ]);
  for (const r of reads) assert.equal(r.complimentaryAmount, 0, 'an expired grant must never still contribute capacity to a concurrent read');

  const auditCount = await countAuditEvents('COMPLIMENTARY_GRANT_EXPIRED', `complimentary-grant:${created.grantId}`);
  assert.equal(auditCount, 1, 'exactly one EXPIRED audit event even though multiple concurrent reads raced the sweep');

  const list = await complimentaryService.listForFamily(familyId, new Date());
  const record = list.find((g) => g.grantId === created.grantId);
  assert.equal(record.status, 'EXPIRED');
});

test('expiry NEVER force-removes existing occupants -- account_entitlements counts are untouched by expiry', async () => {
  const familyId = uniqueFamilyId('expiry-no-force-remove');
  const now = new Date();
  await entitlementRepository.getOrCreateForFamily(familyId, 'FREE_STARTER', { tier: 'FREE_STARTER', parentMemberLimit: 1, managedDeviceLimit: 1, updatedAt: now, updatedByAdminId: null }, now);
  await runInTransaction(async (conn) => {
    await entitlementRepository.lockForFamily(conn, familyId);
    await entitlementRepository.adjustManagedDeviceCounts(conn, familyId, 0, 3, now);
  });

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'TEMPORARY_COMPLIMENTARY',
    amountOrAllowance: 3,
    effectiveFrom: now,
    expiresAt: new Date(Date.now() + 150),
    reasonCode: 'TEMP_DEVICE_GRANT',
    internalNote: null,
    stepUpId,
  });

  await new Promise((resolve) => setTimeout(resolve, 250));
  await complimentaryService.listForFamily(familyId, new Date()); // triggers the lazy sweep

  const base = await entitlementRepository.getForFamily(familyId);
  assert.equal(base.managedDeviceActiveCount, 3, 'expiry must never force-remove/decrement an existing occupant count');
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-021: grant mutation racing a paid entitlement change
// ---------------------------------------------------------------------------

test('CONCURRENCY: a complimentary grant create racing a base-entitlement (paid) limit change never loses either update', async () => {
  const familyId = uniqueFamilyId('grant-vs-paid-race');
  const now = new Date();
  await entitlementRepository.getOrCreateForFamily(familyId, 'FREE_STARTER', { tier: 'FREE_STARTER', parentMemberLimit: 1, managedDeviceLimit: 1, updatedAt: now, updatedByAdminId: null }, now);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');

  await Promise.all([
    runInTransaction(async (conn) => {
      await entitlementRepository.lockForFamily(conn, familyId);
      await entitlementRepository.raiseLimit(conn, familyId, 'MANAGED_DEVICE_LIMIT', 10, new Date());
    }),
    adminComplimentaryService.createGrant(actorOf(admin), {
      familyId,
      entitlementType: 'MANAGED_DEVICE_CAPACITY',
      category: 'FOUNDER',
      amountOrAllowance: 5,
      effectiveFrom: now,
      expiresAt: null,
      reasonCode: 'FOUNDER_GRANT',
      internalNote: null,
      stepUpId,
    }),
  ]);

  const base = await entitlementRepository.getForFamily(familyId);
  assert.equal(base.managedDeviceLimit, 10, 'the paid base-limit change must not be lost');
  const capacity = await complimentaryService.computeEffectiveCapacity(familyId, 'MANAGED_DEVICE_CAPACITY', base.managedDeviceLimit, new Date());
  assert.equal(capacity.complimentaryAmount, 5, 'the complimentary grant must not be lost');
  assert.equal(capacity.effectiveTotal, 15, 'both updates combine correctly with no lost update');
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-014: RBAC matrix
// ---------------------------------------------------------------------------

test('RBAC: FINANCE_ADMIN/SUPPORT_ADMIN/AUDITOR_READ_ONLY can read but never mutate', async () => {
  const familyId = uniqueFamilyId('rbac-read-only');
  for (const role of ['FINANCE_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR_READ_ONLY']) {
    const admin = await createAdmin({ role });
    await assert.doesNotReject(() => adminComplimentaryService.listForFamily(actorOf(admin), familyId));
    await assert.rejects(
      () =>
        adminComplimentaryService.createGrant(actorOf(admin), {
          familyId,
          entitlementType: 'MANAGED_DEVICE_CAPACITY',
          category: 'OTHER',
          amountOrAllowance: 1,
          effectiveFrom: new Date(),
          expiresAt: null,
          reasonCode: 'SHOULD_FAIL',
          internalNote: null,
          stepUpId: 'irrelevant',
        }),
      (err) => err instanceof PlatformAdminComplimentaryError && err.code === 'FORBIDDEN',
      `${role} must never be able to create a grant`,
    );
  }
});

test('RBAC: SUPPORT_ADMIN read redacts category and internalNote; other roles see them', async () => {
  const familyId = uniqueFamilyId('rbac-redaction');
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(owner, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(owner), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'STAFF',
    amountOrAllowance: 1,
    effectiveFrom: new Date(),
    expiresAt: null,
    reasonCode: 'STAFF_GRANT',
    internalNote: 'employee record detail -- never for support/family surfaces',
    stepUpId,
  });

  const support = await createAdmin({ role: 'SUPPORT_ADMIN' });
  const supportView = await adminComplimentaryService.listForFamily(actorOf(support), familyId);
  assert.equal(supportView[0].category, null, 'SUPPORT_ADMIN must never see category');
  assert.equal(supportView[0].internalNote, null, 'SUPPORT_ADMIN must never see internalNote');
  assert.equal(supportView[0].status, 'ACTIVE', 'support-safe status IS visible');

  const auditorView = await adminComplimentaryService.listForFamily(actorOf(await createAdmin({ role: 'AUDITOR_READ_ONLY' })), familyId);
  assert.equal(auditorView[0].category, 'STAFF');
  assert.equal(auditorView[0].internalNote, 'employee record detail -- never for support/family surfaces');
});

test('RBAC: permanent/lifetime grants are APP_OWNER-only by default -- PLATFORM_ADMIN is forbidden', async () => {
  const familyId = uniqueFamilyId('rbac-permanent');
  const platformAdmin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const stepUpId = await stepUpFor(platformAdmin, 'COMPLIMENTARY_GRANT_MUTATION');
  await assert.rejects(
    () =>
      adminComplimentaryService.createGrant(actorOf(platformAdmin), {
        familyId,
        entitlementType: 'COMMERCIAL_ACCESS',
        category: 'LIFETIME_COMPLIMENTARY',
        amountOrAllowance: 1,
        effectiveFrom: new Date(),
        expiresAt: null,
        reasonCode: 'LIFETIME_TEST',
        internalNote: null,
        stepUpId,
      }),
    (err) => err instanceof PlatformAdminComplimentaryError && err.code === 'FORBIDDEN',
    'PLATFORM_ADMIN must be forbidden from issuing a permanent (expiresAt=null) grant',
  );

  const owner = await createAdmin({ role: 'APP_OWNER' });
  const ownerStepUp = await stepUpFor(owner, 'COMPLIMENTARY_GRANT_MUTATION');
  const created = await adminComplimentaryService.createGrant(actorOf(owner), {
    familyId,
    entitlementType: 'COMMERCIAL_ACCESS',
    category: 'LIFETIME_COMPLIMENTARY',
    amountOrAllowance: 1,
    effectiveFrom: new Date(),
    expiresAt: null,
    reasonCode: 'LIFETIME_TEST',
    internalNote: null,
    stepUpId: ownerStepUp,
  });
  assert.equal(created.expiresAt, null);
});

test('mutation without a valid step-up is rejected before any grant is created', async () => {
  const familyId = uniqueFamilyId('missing-stepup');
  const admin = await createAdmin({ role: 'APP_OWNER' });
  await assert.rejects(() =>
    adminComplimentaryService.createGrant(actorOf(admin), {
      familyId,
      entitlementType: 'MANAGED_DEVICE_CAPACITY',
      category: 'OTHER',
      amountOrAllowance: 1,
      effectiveFrom: new Date(),
      expiresAt: null,
      reasonCode: 'NO_STEPUP',
      internalNote: null,
      stepUpId: 'not-a-real-step-up-id',
    }),
  );
  const list = await complimentaryService.listForFamily(familyId, new Date());
  assert.equal(list.length, 0, 'no grant may exist without a valid step-up having been consumed');
});

// ---------------------------------------------------------------------------
// PCA-ADD-COMP-018: MyKids read model never leaks internal fields
// ---------------------------------------------------------------------------

test('MyKids read model exposes only safe additive fields', async () => {
  const familyId = uniqueFamilyId('mykids-readmodel');
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'COMMERCIAL_ACCESS',
    category: 'STAFF_FAMILY',
    amountOrAllowance: 1,
    effectiveFrom: new Date(),
    expiresAt: null,
    reasonCode: 'STAFF_FAMILY_ACCESS',
    internalNote: 'secret staff detail',
    stepUpId,
  });
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'STAFF_FAMILY',
    amountOrAllowance: 4,
    effectiveFrom: new Date(),
    expiresAt: null,
    reasonCode: 'STAFF_FAMILY_DEVICES',
    internalNote: null,
    stepUpId: await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION'),
  });

  const model = await buildMyKidsComplimentaryReadModel(complimentaryService, familyId, 1, 1, new Date());
  assert.equal(model.complimentaryCapacity.managedDevice, 4);
  assert.equal(model.complimentaryCapacity.parentMember, 0);
  assert.equal(model.effectiveTotal.managedDeviceLimit, 5);
  assert.equal(model.effectiveTotal.parentMemberLimit, 1);
  assert.equal(model.freeAccess.mode, 'PERPETUAL');
  assert.equal(model.freeAccess.expiresAt, null);
  const serialized = JSON.stringify(model);
  assert.ok(!serialized.includes('secret staff detail'), 'MyKids read model must never leak internalNote');
  assert.ok(!serialized.includes(admin.adminId), 'MyKids read model must never leak grantedByAdminId');
});

// ---------------------------------------------------------------------------
// HTTP smoke test through the real route module
// ---------------------------------------------------------------------------

function server() {
  const app = Fastify({ logger: false });
  const rateLimiter = createRateLimiter();
  registerComplimentaryGrantRoutes(app, {
    platformAdminAuthService: authService,
    platformAdminComplimentaryGrantService: adminComplimentaryService,
    rateLimiter,
  });
  return app;
}

test('HTTP: create -> list -> revoke round trip, and RBAC/step-up enforced at the route layer', async () => {
  const app = server();
  await app.ready();
  try {
    const familyId = uniqueFamilyId('http-roundtrip');
    const owner = await createAdmin({ role: 'APP_OWNER' });
    const financeAdmin = await createAdmin({ role: 'FINANCE_ADMIN' });
    const stepUpId = await stepUpFor(owner, 'COMPLIMENTARY_GRANT_MUTATION');

    const createResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/families/${familyId}/complimentary-grants`,
      headers: { authorization: `Bearer ${owner.rawToken}` },
      payload: {
        entitlementType: 'MANAGED_DEVICE_CAPACITY',
        category: 'BETA_TESTER',
        amountOrAllowance: 2,
        effectiveFrom: new Date().toISOString(),
        expiresAt: null,
        reasonCode: 'HTTP_TEST',
        internalNote: null,
        stepUpId,
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.amountOrAllowance, 2);

    // FINANCE_ADMIN can read...
    const listResponse = await app.inject({
      method: 'GET',
      url: `/platform-admin/families/${familyId}/complimentary-grants`,
      headers: { authorization: `Bearer ${financeAdmin.rawToken}` },
    });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().items.length, 1);

    // ...but never mutate, even with a well-formed body (server RBAC, not merely a hidden UI control).
    const financeCreateAttempt = await app.inject({
      method: 'POST',
      url: `/platform-admin/families/${familyId}/complimentary-grants`,
      headers: { authorization: `Bearer ${financeAdmin.rawToken}` },
      payload: {
        entitlementType: 'MANAGED_DEVICE_CAPACITY',
        category: 'OTHER',
        amountOrAllowance: 1,
        effectiveFrom: new Date().toISOString(),
        expiresAt: null,
        reasonCode: 'SHOULD_BE_FORBIDDEN',
        internalNote: null,
        stepUpId: 'irrelevant',
      },
    });
    assert.equal(financeCreateAttempt.statusCode, 403);

    // Revoke without a stepUpId is rejected before any mutation.
    const revokeNoStepUp = await app.inject({
      method: 'POST',
      url: `/platform-admin/complimentary-grants/${created.grantId}/revoke`,
      headers: { authorization: `Bearer ${owner.rawToken}` },
      payload: { reasonCode: 'MISSING_STEPUP' },
    });
    assert.equal(revokeNoStepUp.statusCode, 403);

    const revokeStepUp = await stepUpFor(owner, 'COMPLIMENTARY_GRANT_MUTATION');
    const revokeResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/complimentary-grants/${created.grantId}/revoke`,
      headers: { authorization: `Bearer ${owner.rawToken}` },
      payload: { reasonCode: 'HTTP_TEST_REVOKE', stepUpId: revokeStepUp },
    });
    assert.equal(revokeResponse.statusCode, 200);
    assert.equal(revokeResponse.json().status, 'REVOKED');
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
// Round6): the consumption-side SSOT wiring -- EntitlementService
// .getEffectiveSnapshot, the MyKids DTO, cross-family isolation, no fake
// billing, and grant category having zero authority/consumption-path
// effect.
// ---------------------------------------------------------------------------

test('EFFECTIVE_ENTITLEMENT_V2 SSOT: base=1, complimentary=4 -> effective=5 via EntitlementService.getEffectiveSnapshot', async () => {
  const familyId = uniqueFamilyId('ssot-effective-5');
  const now = new Date();
  await entitlementServiceEffective.getOrCreateForFamily(familyId, now);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'BETA_TESTER',
    amountOrAllowance: 4,
    effectiveFrom: now,
    expiresAt: null,
    reasonCode: 'BETA_PROGRAM',
    internalNote: null,
    stepUpId,
  });

  const snapshot = await entitlementServiceEffective.getEffectiveSnapshot(familyId, new Date());
  assert.equal(snapshot.baseManagedDeviceLimit, 1);
  assert.equal(snapshot.complimentaryManagedDeviceCapacity, 4);
  assert.equal(snapshot.effectiveManagedDeviceLimit, 5);
  assert.equal(snapshot.overLimitManagedDevice, false);
});

test('EFFECTIVE_ENTITLEMENT_V2: cross-family isolation -- complimentary capacity for family A never leaks into family B', async () => {
  const familyA = uniqueFamilyId('effective-isolation-a');
  const familyB = uniqueFamilyId('effective-isolation-b');
  const now = new Date();
  await entitlementServiceEffective.getOrCreateForFamily(familyA, now);
  await entitlementServiceEffective.getOrCreateForFamily(familyB, now);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId: familyA,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'PARTNER',
    amountOrAllowance: 7,
    effectiveFrom: now,
    expiresAt: null,
    reasonCode: 'ISOLATION_TEST',
    internalNote: null,
    stepUpId,
  });

  const snapshotA = await entitlementServiceEffective.getEffectiveSnapshot(familyA, new Date());
  const snapshotB = await entitlementServiceEffective.getEffectiveSnapshot(familyB, new Date());
  assert.equal(snapshotA.effectiveManagedDeviceLimit, 8);
  assert.equal(snapshotB.effectiveManagedDeviceLimit, 1, "family B's effective limit must never see family A's grant");
  assert.equal(snapshotB.complimentaryManagedDeviceCapacity, 0);
});

test('EFFECTIVE_ENTITLEMENT_V2: MyKids DTO exposes base/complimentary/effective/active/reserved/available/expiry, never internalNote/grantedByAdminId', async () => {
  const familyId = uniqueFamilyId('effective-dto');
  const now = new Date();
  await entitlementRepository.getOrCreateForFamily(familyId, 'FREE_STARTER', { tier: 'FREE_STARTER', parentMemberLimit: 1, managedDeviceLimit: 1, updatedAt: now, updatedByAdminId: null }, now);
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 1 WHERE family_id = ?`, [familyId]);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'TEMPORARY_COMPLIMENTARY',
    amountOrAllowance: 3,
    effectiveFrom: now,
    expiresAt,
    reasonCode: 'TEMP_DEVICE_CAPACITY',
    internalNote: 'never leak this to MyKids',
    stepUpId,
  });

  const dto = await buildEffectiveEntitlementDto(complimentaryService, familyId, { parentMemberLimit: 1, managedDeviceLimit: 1, parentMemberUsed: 0, managedDeviceActive: 1, managedDeviceReserved: 0 }, new Date());
  assert.deepEqual(dto.managedDevice, { base: 1, complimentary: 3, effective: 4, active: 1, reserved: 0, available: 3 });
  assert.deepEqual(dto.parentMember, { base: 1, complimentary: 0, effective: 1, used: 0 });
  assert.equal(dto.complimentaryExpiresAt, expiresAt.toISOString());
  const serialized = JSON.stringify(dto);
  assert.ok(!serialized.includes('never leak this to MyKids'), 'MyKids DTO must never leak internalNote');
  assert.ok(!serialized.includes(admin.adminId), 'MyKids DTO must never leak grantedByAdminId');
});

test('EFFECTIVE_ENTITLEMENT_V2: no fake billing -- reserving a managed-device slot using only complimentary capacity creates zero Invoice/PaymentAttempt/PaymentTransaction/ProviderEvent rows', async () => {
  const familyId = uniqueFamilyId('no-fake-billing');
  const now = new Date();
  await entitlementServiceEffective.getOrCreateForFamily(familyId, now);
  // base=1, already at capacity -- only the complimentary grant makes room.
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 1 WHERE family_id = ?`, [familyId]);

  const [beforeInvoices] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_invoices`);
  const [beforeAttempts] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_attempts`);
  const [beforeTransactions] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_transactions`);
  const [beforeEvents] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_provider_events`);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  await adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'SUPPORT_EXCEPTION',
    amountOrAllowance: 1,
    effectiveFrom: now,
    expiresAt: null,
    reasonCode: 'NO_FAKE_BILLING_TEST',
    internalNote: null,
    stepUpId,
  });

  const invitationId = await insertRawInvitationForComplimentaryTests(familyId, new Date(Date.now() + 60_000));
  const record = await slotReservationServiceEffective.reserveForInvitation(familyId, invitationId, new Date(Date.now() + 60_000));
  assert.equal(record.status, 'RESERVED', 'the complimentary grant must make the slot reservable even though base capacity was already full');

  const [afterInvoices] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_invoices`);
  const [afterAttempts] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_attempts`);
  const [afterTransactions] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_transactions`);
  const [afterEvents] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_provider_events`);
  assert.equal(Number(afterInvoices[0].n), Number(beforeInvoices[0].n), 'zero new Invoice rows');
  assert.equal(Number(afterAttempts[0].n), Number(beforeAttempts[0].n), 'zero new PaymentAttempt rows');
  assert.equal(Number(afterTransactions[0].n), Number(beforeTransactions[0].n), 'zero new PaymentTransaction rows');
  assert.equal(Number(afterEvents[0].n), Number(beforeEvents[0].n), 'zero new ProviderEvent rows');
});

test('EFFECTIVE_ENTITLEMENT_V2: grant category carries zero authority/consumption-path effect -- FOUNDER and OTHER of equal amount yield identical effective totals', async () => {
  const familyFounder = uniqueFamilyId('category-founder');
  const familyOther = uniqueFamilyId('category-other');
  const now = new Date();
  await entitlementServiceEffective.getOrCreateForFamily(familyFounder, now);
  await entitlementServiceEffective.getOrCreateForFamily(familyOther, now);

  const admin = await createAdmin({ role: 'APP_OWNER' });
  for (const [familyId, category] of [[familyFounder, 'FOUNDER'], [familyOther, 'OTHER']]) {
    const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
    await adminComplimentaryService.createGrant(actorOf(admin), {
      familyId,
      entitlementType: 'MANAGED_DEVICE_CAPACITY',
      category,
      amountOrAllowance: 2,
      effectiveFrom: now,
      expiresAt: null,
      reasonCode: 'CATEGORY_NEUTRALITY_TEST',
      internalNote: null,
      stepUpId,
    });
  }

  const founderSnapshot = await entitlementServiceEffective.getEffectiveSnapshot(familyFounder, new Date());
  const otherSnapshot = await entitlementServiceEffective.getEffectiveSnapshot(familyOther, new Date());
  assert.equal(founderSnapshot.effectiveManagedDeviceLimit, otherSnapshot.effectiveManagedDeviceLimit, 'category never changes the effective-capacity arithmetic');
  assert.equal(founderSnapshot.effectiveManagedDeviceLimit, 3);
});

test.after(async () => {
  await closePool();
});
