import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService, SlotReservationError } from '../../dist/entitlements/slots/SlotReservationService.js';
import { MySqlInvitationRepository } from '../../dist/invitation/MySqlInvitationRepository.js';
import { InvitationService, InvitationError } from '../../dist/invitation/InvitationService.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const entitlementRepository = new MySqlEntitlementRepository();
const entitlementService = new EntitlementService(entitlementRepository, { listOpenForFamily: async () => [] });
const slotReservationRepository = new MySqlSlotReservationRepository(entitlementRepository);
const slotReservationService = new SlotReservationService(slotReservationRepository);
const invitationRepository = new MySqlInvitationRepository();

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
    (error) => error instanceof SlotReservationError && error.code === 'NO_AVAILABLE_SLOT',
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

test.after(async () => {
  await closePool();
});
