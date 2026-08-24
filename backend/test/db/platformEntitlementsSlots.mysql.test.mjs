import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, runInTransaction } from '../../dist/db/pool.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService, SlotReservationError } from '../../dist/entitlements/slots/SlotReservationService.js';
import { MySqlInvitationRepository } from '../../dist/invitation/MySqlInvitationRepository.js';
import { InvitationService, InvitationError } from '../../dist/invitation/InvitationService.js';
import { MySqlComplimentaryGrantRepository } from '../../dist/entitlements/complimentary/MySqlComplimentaryGrantRepository.js';
import { ComplimentaryEntitlementService } from '../../dist/entitlements/complimentary/ComplimentaryEntitlementService.js';
import { PlatformAdminComplimentaryGrantService } from '../../dist/platformadmin/complimentary/PlatformAdminComplimentaryGrantService.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';

if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);
if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const entitlementRepository = new MySqlEntitlementRepository();
const entitlementService = new EntitlementService(entitlementRepository, { listOpenForFamily: async () => [] });
const slotReservationRepository = new MySqlSlotReservationRepository(entitlementRepository);
const slotReservationService = new SlotReservationService(slotReservationRepository);
const invitationRepository = new MySqlInvitationRepository();

// EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
// Round6): a SEPARATE complimentary-aware wiring, kept distinct from the
// base-only `entitlementRepository`/`slotReservationRepository` above (used
// by every pre-existing test in this file, which must keep passing
// unchanged).
const grantRepository = new MySqlComplimentaryGrantRepository();
const entitlementRepositoryEffective = new MySqlEntitlementRepository(grantRepository);
const slotReservationRepositoryEffective = new MySqlSlotReservationRepository(entitlementRepositoryEffective, grantRepository);
const complimentaryService = new ComplimentaryEntitlementService(grantRepository);

const authRepository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(authRepository);
let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);
const adminComplimentaryService = new PlatformAdminComplimentaryGrantService(authService, complimentaryService, clock);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'APP_OWNER' } = {}) {
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
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret };
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

/**
 * `expiresInMs`, if given, is resolved to an absolute Date right before the
 * createGrant call itself (never before createAdmin/stepUpFor, which do
 * genuine, non-negligible wall-clock work) -- so a short-lived expiry
 * window (e.g. "expires in 1.5s, to exercise a mid-flight expiry race")
 * still lands strictly after `effectiveFrom` and never trips
 * ComplimentaryEntitlementService's `expiresAt > effectiveFrom` validation.
 */
async function grantManagedDeviceCapacity(familyId, amountOrAllowance, expiresInMs = null) {
  const admin = await createAdmin();
  const stepUpId = await stepUpFor(admin, 'COMPLIMENTARY_GRANT_MUTATION');
  const effectiveFrom = new Date();
  const expiresAt = expiresInMs === null ? null : new Date(effectiveFrom.getTime() + expiresInMs);
  return adminComplimentaryService.createGrant(actorOf(admin), {
    familyId,
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'BETA_TESTER',
    amountOrAllowance,
    effectiveFrom,
    expiresAt,
    reasonCode: 'SLOT_CONSUMPTION_TEST',
    internalNote: null,
    stepUpId,
  });
}

function uniqueFamilyId(label) {
  return `family-${label}-${randomUUID()}`;
}

async function setDeviceLimit(familyId, limit) {
  const now = new Date();
  await entitlementService.getOrCreateForFamily(familyId, now);
  await getPool().query(`UPDATE account_entitlements SET managed_device_limit = ? WHERE family_id = ?`, [limit, familyId]);
}

/** Minimal, schema-valid enrollment_invitations row -- the FK managed_device_slot_reservations needs, independent of InvitationService's own token/policy logic. */
async function insertRawInvitation(familyId, expiresAt) {
  const invitationId = randomUUID();
  await getPool().query(
    `INSERT INTO enrollment_invitations
       (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at, opened_at, redeemed_at, revoked_at)
     VALUES (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'CREATED', NOW(3), ?, NULL, NULL, NULL)`,
    [invitationId, familyId, randomUUID().replace(/-/g, '').padEnd(64, '0'), expiresAt],
  );
  return invitationId;
}

// ---------------------------------------------------------------------------
// Basic reserve / idempotent release / consume (unwired hook) / reconcile
// ---------------------------------------------------------------------------

test('slot reserve: succeeds when capacity is available, decrements availability', async () => {
  const familyId = uniqueFamilyId('reserve-basic');
  await setDeviceLimit(familyId, 2);
  const invitationId = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  const record = await slotReservationService.reserveForInvitation(familyId, invitationId, new Date(Date.now() + 60_000));
  assert.equal(record.status, 'RESERVED');
  const entitlement = await entitlementRepository.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, 1);
});

test('slot reserve: NO_AVAILABLE_SLOT when reserved+active already meets the limit', async () => {
  const familyId = uniqueFamilyId('reserve-full');
  await setDeviceLimit(familyId, 1);
  const first = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  await slotReservationService.reserveForInvitation(familyId, first, new Date(Date.now() + 60_000));
  const second = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  await assert.rejects(
    () => slotReservationService.reserveForInvitation(familyId, second, new Date(Date.now() + 60_000)),
    (error) => error instanceof SlotReservationError && error.code === 'NO_AVAILABLE_SLOT',
  );
});

test('slot release (revoke): idempotent -- releasing twice never double-decrements reserved count', async () => {
  const familyId = uniqueFamilyId('release-idempotent');
  await setDeviceLimit(familyId, 1);
  const invitationId = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  await slotReservationService.reserveForInvitation(familyId, invitationId, new Date(Date.now() + 60_000));
  await slotReservationService.releaseForInvitation(invitationId, 'REVOKED');
  await slotReservationService.releaseForInvitation(invitationId, 'REVOKED');
  const entitlement = await entitlementRepository.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, 0, 'never negative, never double-released');

  // the freed slot is immediately available to a new reservation
  const newInvitation = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  const reReserved = await slotReservationService.reserveForInvitation(familyId, newInvitation, new Date(Date.now() + 60_000));
  assert.equal(reReserved.status, 'RESERVED');
});

test('slot expiry: an expired reservation is lazily released and its slot becomes available (survives across independent calls, no cron)', async () => {
  const familyId = uniqueFamilyId('expiry-release');
  await setDeviceLimit(familyId, 1);
  const invitationId = await insertRawInvitation(familyId, new Date(Date.now() - 1000));
  await slotReservationRepository.reserve(familyId, invitationId, new Date(Date.now() - 2000), new Date(Date.now() - 1000));

  const newInvitation = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  const reserved = await slotReservationService.reserveForInvitation(familyId, newInvitation, new Date(Date.now() + 60_000));
  assert.equal(reserved.status, 'RESERVED', 'the expired reservation must be reconciled before the new one is evaluated');

  const oldReservation = await slotReservationRepository.findByInvitationId(invitationId);
  assert.equal(oldReservation.status, 'RELEASED');
  assert.equal(oldReservation.releaseReason, 'EXPIRED');
});

test('slot consumption hook: RESERVED -> CONSUMED moves reserved count to active count (defined, though not wired to any caller in this codebase -- see PCA-PA-2 final report)', async () => {
  const familyId = uniqueFamilyId('consume-hook');
  await setDeviceLimit(familyId, 2);
  const invitationId = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  await slotReservationService.reserveForInvitation(familyId, invitationId, new Date(Date.now() + 60_000));
  const outcome = await slotReservationRepository.consumeByInvitationId(invitationId, new Date());
  assert.equal(outcome.outcome, 'CONSUMED');
  const entitlement = await entitlementRepository.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, 0);
  assert.equal(entitlement.managedDeviceActiveCount, 1);

  const second = await slotReservationRepository.consumeByInvitationId(invitationId, new Date());
  assert.equal(second.outcome, 'ALREADY_CONSUMED', 'consumption is idempotent');
});

// ---------------------------------------------------------------------------
// PCA-ADD-PA-021/022: invitation integration -- reserve before a usable
// invitation exists, no orphan invitation survives a reservation failure
// ---------------------------------------------------------------------------

test('invitation integration: creating an invitation reserves a slot first; no invitation is created when no slot is available', async () => {
  const familyId = uniqueFamilyId('invite-integration');
  await setDeviceLimit(familyId, 1);
  const invitationService = new InvitationService(invitationRepository, () => new Date(), undefined, slotReservationService);

  const first = await invitationService.createInvitation({ familyId, platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
  assert.ok(first.record.invitationId);

  await assert.rejects(
    () => invitationService.createInvitation({ familyId, platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }),
    (error) => error instanceof InvitationError && error.code === 'MANAGED_DEVICE_LIMIT_REACHED',
    'InvitationService.createInvitation translates the raw SlotReservationError into an actionable InvitationError (see invitationRoutes.ts, which maps this to HTTP 403) rather than leaking the lower-level slot-reservation error type',
  );

  const invitations = await invitationRepository.listForFamily(familyId);
  assert.equal(invitations.length, 1, 'the second, capacity-rejected attempt must never persist a usable invitation');
});

test('invitation integration: revoking an invitation releases its reservation and frees the slot for a new invitation', async () => {
  const familyId = uniqueFamilyId('invite-revoke-release');
  await setDeviceLimit(familyId, 1);
  const invitationService = new InvitationService(invitationRepository, () => new Date(), undefined, slotReservationService);

  const created = await invitationService.createInvitation({ familyId, platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
  await invitationService.revokeInvitationForFamily(familyId, created.record.invitationId);

  const reservation = await slotReservationRepository.findByInvitationId(created.record.invitationId);
  assert.equal(reservation.status, 'RELEASED');
  assert.equal(reservation.releaseReason, 'REVOKED');

  const second = await invitationService.createInvitation({ familyId, platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
  assert.ok(second.record.invitationId, 'the freed slot allows a new invitation to be created');
});

test('invitation integration: InvitationService without a SlotReservationService (existing callers) is unaffected -- no reservation, no error', async () => {
  const familyId = uniqueFamilyId('invite-no-reservation-wired');
  const invitationService = new InvitationService(invitationRepository);
  const created = await invitationService.createInvitation({ familyId, platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
  assert.ok(created.record.invitationId);
});

// ---------------------------------------------------------------------------
// PCA-ADD-PA-039: release-blocking concurrency race tests
// ---------------------------------------------------------------------------

test('CONCURRENCY: last-slot atomicity -- N simultaneous reservation attempts against exactly 1 available slot, exactly 1 succeeds', async () => {
  const familyId = uniqueFamilyId('concurrency-last-slot');
  await setDeviceLimit(familyId, 3);
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 2 WHERE family_id = ?`, [familyId]);

  const N = 8;
  const invitationIds = await Promise.all(Array.from({ length: N }, () => insertRawInvitation(familyId, new Date(Date.now() + 60_000))));
  // Genuine concurrent DB work: N simultaneous calls into the repository,
  // each internally opening its own pool connection/transaction and racing
  // the same account_entitlements row lock (backend/src/db/pool.ts's pool
  // supports up to connectionLimit=10 concurrent connections) -- not
  // sequential Promise calls dressed up as "concurrent".
  const results = await Promise.all(
    invitationIds.map((invitationId) => slotReservationRepository.reserve(familyId, invitationId, new Date(), new Date(Date.now() + 60_000)).catch((error) => ({ outcome: 'ERROR', error }))),
  );
  const succeeded = results.filter((r) => r.outcome === 'RESERVED');
  const rejected = results.filter((r) => r.outcome === 'NO_AVAILABLE_SLOT');
  assert.equal(succeeded.length, 1, `expected exactly 1 success, got ${succeeded.length}: ${JSON.stringify(results.map((r) => r.outcome))}`);
  assert.equal(rejected.length, N - 1);

  const entitlement = await entitlementRepository.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, 1);
  assert.equal(entitlement.managedDeviceActiveCount + entitlement.managedDeviceReservedCount, 3);
});

test('CONCURRENCY: K-slot capacity -- N > K simultaneous attempts against K available slots, exactly K succeed', async () => {
  const familyId = uniqueFamilyId('concurrency-k-slot');
  const K = 4;
  const N = 12;
  await setDeviceLimit(familyId, K);

  const invitationIds = await Promise.all(Array.from({ length: N }, () => insertRawInvitation(familyId, new Date(Date.now() + 60_000))));
  const results = await Promise.all(
    invitationIds.map((invitationId) => slotReservationRepository.reserve(familyId, invitationId, new Date(), new Date(Date.now() + 60_000)).catch((error) => ({ outcome: 'ERROR', error }))),
  );
  const succeeded = results.filter((r) => r.outcome === 'RESERVED');
  assert.equal(succeeded.length, K, `expected exactly ${K} successes, got ${succeeded.length}`);

  const entitlement = await entitlementRepository.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, K);
});

test('CONCURRENCY: cross-family reservations never contend -- two families racing their own last slot both succeed independently', async () => {
  const familyA = uniqueFamilyId('concurrency-cross-a');
  const familyB = uniqueFamilyId('concurrency-cross-b');
  await setDeviceLimit(familyA, 1);
  await setDeviceLimit(familyB, 1);
  const invitationA = await insertRawInvitation(familyA, new Date(Date.now() + 60_000));
  const invitationB = await insertRawInvitation(familyB, new Date(Date.now() + 60_000));
  const [resultA, resultB] = await Promise.all([
    slotReservationRepository.reserve(familyA, invitationA, new Date(), new Date(Date.now() + 60_000)),
    slotReservationRepository.reserve(familyB, invitationB, new Date(), new Date(Date.now() + 60_000)),
  ]);
  assert.equal(resultA.outcome, 'RESERVED');
  assert.equal(resultB.outcome, 'RESERVED');
});

// ---------------------------------------------------------------------------
// EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
// Round6): the SAME `SELECT ... FOR UPDATE` locked-transaction arbitration
// PCA-ADD-PA-039 already proved for the base-limit case, now proven again
// for the effective (base + complimentary) case.
// ---------------------------------------------------------------------------

test('EFFECTIVE_ENTITLEMENT_V2: reserving up to the effective (base + complimentary) limit succeeds through the real SlotReservationService path', async () => {
  const familyId = uniqueFamilyId('effective-basic');
  await setDeviceLimit(familyId, 1);
  await grantManagedDeviceCapacity(familyId, 4);

  const effectiveService = new SlotReservationService(slotReservationRepositoryEffective);
  for (let i = 0; i < 5; i += 1) {
    const invitationId = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
    const record = await effectiveService.reserveForInvitation(familyId, invitationId, new Date(Date.now() + 60_000));
    assert.equal(record.status, 'RESERVED', `slot ${i + 1} of 5 (base=1 + complimentary=4) must succeed`);
  }
  const overflowInvitation = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  await assert.rejects(
    () => effectiveService.reserveForInvitation(familyId, overflowInvitation, new Date(Date.now() + 60_000)),
    (error) => error instanceof SlotReservationError && error.code === 'NO_AVAILABLE_SLOT',
    'the 6th reservation must be rejected -- effective capacity is exactly 5, never unbounded',
  );
});

test('CONCURRENCY: EFFECTIVE_ENTITLEMENT_V2 last-slot atomicity -- base=1, complimentary=4, active=4 (effective=5, 1 slot left), N=8 concurrent attempts, exactly 1 succeeds', async () => {
  const familyId = uniqueFamilyId('effective-concurrency-last-slot');
  await setDeviceLimit(familyId, 1);
  await grantManagedDeviceCapacity(familyId, 4);
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 4 WHERE family_id = ?`, [familyId]);

  const N = 8;
  const invitationIds = await Promise.all(Array.from({ length: N }, () => insertRawInvitation(familyId, new Date(Date.now() + 60_000))));
  const results = await Promise.all(
    invitationIds.map((invitationId) => slotReservationRepositoryEffective.reserve(familyId, invitationId, new Date(), new Date(Date.now() + 60_000)).catch((error) => ({ outcome: 'ERROR', error }))),
  );
  const succeeded = results.filter((r) => r.outcome === 'RESERVED');
  const rejected = results.filter((r) => r.outcome === 'NO_AVAILABLE_SLOT');
  assert.equal(succeeded.length, 1, `expected exactly 1 success (effective=5, active=4, 1 slot left), got ${succeeded.length}: ${JSON.stringify(results.map((r) => r.outcome))}`);
  assert.equal(rejected.length, N - 1);

  const entitlement = await entitlementRepositoryEffective.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, 1);
  assert.equal(entitlement.managedDeviceActiveCount + entitlement.managedDeviceReservedCount, 5);
});

test('CONCURRENCY: EFFECTIVE_ENTITLEMENT_V2 general K-of-N case -- base=1, complimentary=3 (effective K=4), N=12 concurrent attempts, exactly K succeed', async () => {
  const familyId = uniqueFamilyId('effective-concurrency-k-of-n');
  const K = 4;
  const N = 12;
  await setDeviceLimit(familyId, 1);
  await grantManagedDeviceCapacity(familyId, 3);

  const invitationIds = await Promise.all(Array.from({ length: N }, () => insertRawInvitation(familyId, new Date(Date.now() + 60_000))));
  const results = await Promise.all(
    invitationIds.map((invitationId) => slotReservationRepositoryEffective.reserve(familyId, invitationId, new Date(), new Date(Date.now() + 60_000)).catch((error) => ({ outcome: 'ERROR', error }))),
  );
  const succeeded = results.filter((r) => r.outcome === 'RESERVED');
  assert.equal(succeeded.length, K, `expected exactly ${K} successes (base=1 + complimentary=3), got ${succeeded.length}`);

  const entitlement = await entitlementRepositoryEffective.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceReservedCount, K);
});

test('EFFECTIVE_ENTITLEMENT_V2 expiry-mid-flight: base=1, complimentary=4, active=4 -> grant expires -> effective limit becomes 1 -> existing 4 devices remain enrolled, overLimitManagedDevice=true, new reservation denied', async () => {
  const familyId = uniqueFamilyId('effective-expiry-mid-flight');
  await setDeviceLimit(familyId, 1);
  await grantManagedDeviceCapacity(familyId, 4, 1500); // expires ~1.5s after creation -- mid-test, never pre-expired at grant time
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 4 WHERE family_id = ?`, [familyId]);

  // Confirm the grant is genuinely active and contributing capacity BEFORE expiry.
  const beforeExpiry = await entitlementRepositoryEffective.getEffectiveSnapshotForFamily(familyId, new Date());
  assert.equal(beforeExpiry.effectiveManagedDeviceLimit, 5);
  assert.equal(beforeExpiry.overLimitManagedDevice, false);

  await new Promise((resolve) => setTimeout(resolve, 2000));
  const now = new Date();

  // The 4 existing active devices are NEVER removed by expiry -- only the account_entitlements counters matter, and adjustManagedDeviceCounts is the only mutator of them; expiry mutates nothing there.
  const afterExpiry = await entitlementRepositoryEffective.getEffectiveSnapshotForFamily(familyId, now);
  assert.equal(afterExpiry.complimentaryManagedDeviceCapacity, 0, 'the expired grant no longer contributes capacity');
  assert.equal(afterExpiry.effectiveManagedDeviceLimit, 1, 'effective limit falls back to base once the grant expires');
  assert.equal(afterExpiry.managedDeviceActive, 4, 'the 4 existing active devices are never force-removed by expiry');
  assert.equal(afterExpiry.overLimitManagedDevice, true, 'usage (4) now exceeds the fallen-back effective limit (1)');

  // A raw account_entitlements read confirms the counters truly were never touched by expiry (only the derived, freshly-computed snapshot changed).
  const rawEntitlement = await entitlementRepositoryEffective.getForFamily(familyId);
  assert.equal(rawEntitlement.managedDeviceActiveCount, 4);

  const newInvitation = await insertRawInvitation(familyId, new Date(Date.now() + 60_000));
  const outcome = await slotReservationRepositoryEffective.reserve(familyId, newInvitation, now, new Date(Date.now() + 60_000));
  assert.equal(outcome.outcome, 'NO_AVAILABLE_SLOT', 'new consumption must be denied once the family is over the (now-lower) effective limit');
});

test('EFFECTIVE_ENTITLEMENT_V2: raiseLimit/adjustManagedDeviceCounts over-limit recomputation is complimentary-aware (over-limit clears once complimentary capacity is added)', async () => {
  const familyId = uniqueFamilyId('effective-raiselimit-overlimit');
  await setDeviceLimit(familyId, 1);
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 3 WHERE family_id = ?`, [familyId]);

  const beforeGrant = await entitlementRepositoryEffective.getEffectiveSnapshotForFamily(familyId, new Date());
  assert.equal(beforeGrant.overLimitManagedDevice, true, 'base=1 < active=3 -- over-limit before any complimentary grant');

  await grantManagedDeviceCapacity(familyId, 4);
  // adjustManagedDeviceCounts is invoked by any +0/-0 delta call too -- exercise it directly (via a real committed transaction) to prove its own over-limit recomputation is complimentary-aware, independent of raiseLimit.
  const updated = await runInTransaction(async (conn) => {
    await entitlementRepositoryEffective.lockForFamily(conn, familyId);
    return entitlementRepositoryEffective.adjustManagedDeviceCounts(conn, familyId, 0, 0, new Date());
  });
  assert.equal(updated.overLimitManagedDevice, false, 'base=1 + complimentary=4 = effective=5 >= active=3 -- over-limit clears once recomputed complimentary-aware');
});

test.after(async () => {
  await closePool();
});
