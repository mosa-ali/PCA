import assert from 'node:assert/strict';
import test from 'node:test';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';
import { ChangeRequestService } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { FreeAccessEnforcementError } from '../../dist/parentaccount/freeaccess/types.js';

const NOW = new Date('2026-08-18T00:00:00.000Z');

function deniedPolicy() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async assertAllowed() {
      calls += 1;
      throw new FreeAccessEnforcementError('FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
    },
  };
}

test('managed-device invitation reservation enforces FREE_ACCESS before reserving a slot', async () => {
  const policy = deniedPolicy();
  let reserved = false;
  const repository = {
    findByInvitationId: async () => null,
    reserve: async () => {
      reserved = true;
      throw new Error('reserve must not be reached');
    },
  };
  const service = new SlotReservationService(repository, () => NOW, policy);
  await assert.rejects(() => service.reserveForInvitation('family-a', 'invitation-a', new Date('2026-08-19T00:00:00.000Z')), (error) => {
    assert.ok(error instanceof FreeAccessEnforcementError);
    return true;
  });
  assert.equal(policy.calls, 1);
  assert.equal(reserved, false);
});

test('an idempotent reservation retry does not re-run the new-acquisition gate', async () => {
  const policy = deniedPolicy();
  const record = { reservationId: 'reservation-a', familyId: 'family-a', invitationId: 'invitation-a', status: 'RESERVED' };
  const repository = {
    findByInvitationId: async () => record,
    reserve: async () => ({ outcome: 'ALREADY_RESERVED_FOR_INVITATION', record }),
  };
  const service = new SlotReservationService(repository, () => NOW, policy);
  assert.deepEqual(await service.reserveForInvitation('family-a', 'invitation-a', new Date('2026-08-19T00:00:00.000Z')), record);
  assert.equal(policy.calls, 0);
});

test('expired FREE_ACCESS never blocks consumption or release of an already-held reservation', async () => {
  const policy = deniedPolicy();
  let consumed = 0;
  let released = 0;
  const service = new SlotReservationService({
    consumeByInvitationId: async () => {
      consumed += 1;
      return { outcome: 'CONSUMED' };
    },
    releaseByInvitationId: async () => {
      released += 1;
      return { outcome: 'RELEASED' };
    },
  }, () => NOW, policy);

  await service.consumeForInvitation('invitation-a');
  await service.releaseForInvitation('invitation-a', 'EXPIRED');

  assert.equal(consumed, 1);
  assert.equal(released, 1);
  assert.equal(policy.calls, 0, 'FREE_ACCESS is an acquisition gate, not a protection-removal gate');
});

test('family commercial capacity requests enforce FREE_ACCESS before entitlement or quote work', async () => {
  const policy = deniedPolicy();
  let snapshotRead = false;
  const service = new ChangeRequestService(
    {},
    {},
    { getEffectiveSnapshot: async () => { snapshotRead = true; throw new Error('snapshot must not be reached'); } },
    {},
    {},
    () => NOW,
    policy,
  );
  await assert.rejects(() => service.createRequest('family-a', 'MANAGED_DEVICE_LIMIT', 2, 'YEMEN', 'YER'), (error) => {
    assert.ok(error instanceof FreeAccessEnforcementError);
    return true;
  });
  assert.equal(policy.calls, 1);
  assert.equal(snapshotRead, false);
});
