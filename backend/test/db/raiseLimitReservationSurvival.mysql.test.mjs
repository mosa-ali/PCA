// PCA-ADD-BILL-047: real-MySQL proof of the specific invariant this
// requirement names -- a slot reservation created BEFORE a ceiling
// increase remains valid and untouched by the later limit change. Prior
// tests exercised raiseLimit generically (concurrency races against
// complimentary grants) but never this exact "existing reservation
// survives a later raiseLimit call" sequence (confirmed by a full-repo
// audit this session).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, runInTransaction } from '../../dist/db/pool.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const entitlementRepository = new MySqlEntitlementRepository();
const entitlementService = new EntitlementService(entitlementRepository, { listOpenForFamily: async () => [] });
const slotReservationRepository = new MySqlSlotReservationRepository(entitlementRepository);
const slotReservationService = new SlotReservationService(slotReservationRepository);

test('MySQL: a slot reservation made under the OLD (lower) limit survives untouched after raiseLimit increases the ceiling', async () => {
  const familyId = `family-${randomUUID()}`;
  const now = new Date();
  await entitlementService.getOrCreateForFamily(familyId, now);

  // Pin a known, low starting ceiling regardless of the current
  // entitlement_defaults seed value, so this test's own math is exact.
  await runInTransaction((conn) => entitlementRepository.raiseLimit(conn, familyId, 'MANAGED_DEVICE_LIMIT', 1, now));

  const invitationId = randomUUID();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const reservation = await slotReservationService.reserveForInvitation(familyId, invitationId, expiresAt);
  assert.equal(reservation.invitationId, invitationId);

  // A second, distinct reservation attempt must be rejected -- the family
  // is now genuinely at its limit (1 slot, 1 reserved).
  await assert.rejects(
    () => slotReservationService.reserveForInvitation(familyId, randomUUID(), expiresAt),
    { code: 'NO_AVAILABLE_SLOT' },
  );

  // Raise the ceiling.
  const raised = await runInTransaction((conn) => entitlementRepository.raiseLimit(conn, familyId, 'MANAGED_DEVICE_LIMIT', 5, new Date()));
  assert.equal(raised.managedDeviceLimit, 5);

  // The ORIGINAL reservation must be untouched -- same invitationId, same
  // family, still present -- raiseLimit must never have deleted, altered,
  // or re-keyed it.
  const survived = await slotReservationRepository.findByInvitationId(invitationId);
  assert.ok(survived, 'the pre-existing reservation must still exist after the limit increase');
  assert.equal(survived.familyId, familyId);
  assert.equal(survived.invitationId, invitationId);

  // A NEW reservation attempt must now see the raised ceiling and succeed.
  const secondInvitationId = randomUUID();
  const secondReservation = await slotReservationService.reserveForInvitation(familyId, secondInvitationId, expiresAt);
  assert.equal(secondReservation.invitationId, secondInvitationId);

  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM managed_device_slot_reservations WHERE family_id = ? AND released_at IS NULL`,
    [familyId],
  );
  assert.equal(Number(rows[0].n), 2, 'both the original and the new reservation must be simultaneously active');
});

test.after(async () => {
  await closePool();
});
