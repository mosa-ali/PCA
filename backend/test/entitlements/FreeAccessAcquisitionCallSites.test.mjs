import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';
import { ChangeRequestService } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { FamilyMemberInvitationError, FamilyMemberInvitationService } from '../../dist/familymembers/FamilyMemberInvitationService.js';
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

function allowingPolicy() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async assertAllowed() {
      calls += 1;
    },
  };
}

/** Minimal ALLOW-verdict ParentActionAuthorizationService stand-in -- the real one's own logic is covered by test/familymembers/service.test.mjs; this file only cares that the FREE_ACCESS gate runs after it. */
function allowingAuthorization() {
  return { authorize: () => ({ verdict: 'ALLOW' }) };
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

// ---------------------------------------------------------------------------
// Third call site: parent-member invitation. deriveFreeAccessStatus.ts's
// frozen contract names exactly three denied-after-expiry operations --
// "device enrollment, parent-member invite, new non-billing commercial
// activation" -- and this file exists to keep every one of them bound. The
// invite arm was the one the contract named but no code enforced.
// ---------------------------------------------------------------------------

const INVITE_INPUT = {
  familyId: 'family-a',
  invitedEmail: 'newmember@example.test',
  role: 'VIEWER',
  invitedByAccountId: 'acct-owner',
  actorDeviceId: 'dev-owner',
};

test('parent-member invitation enforces FREE_ACCESS before any invitation read or write', async () => {
  const policy = deniedPolicy();
  let repositoryTouches = 0;
  const repository = {
    findPendingByFamilyAndEmailHash: async () => { repositoryTouches += 1; return null; },
    listForFamily: async () => { repositoryTouches += 1; return []; },
    createAtomically: async () => { repositoryTouches += 1; return { outcome: 'CREATED' }; },
  };
  const service = new FamilyMemberInvitationService(repository, allowingAuthorization(), () => NOW, undefined, undefined, null, policy);

  await assert.rejects(() => service.createInvitation(INVITE_INPUT), (error) => {
    // Translated into this domain's own coded error (exactly as
    // InvitationService/FamilyCommercialService already do) so the HTTP
    // adapter can answer 403 + code rather than a bare 500.
    assert.ok(error instanceof FamilyMemberInvitationError);
    assert.equal(error.code, 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
    return true;
  });
  assert.equal(policy.calls, 1);
  assert.equal(repositoryTouches, 0);
});

test('the invitation FREE_ACCESS gate runs AFTER authorization, so an unauthorized caller learns nothing about free-access state', async () => {
  const policy = deniedPolicy();
  const denyingAuthorization = { authorize: () => ({ verdict: 'DENY', reason: 'NO_ROLE' }) };
  const service = new FamilyMemberInvitationService({}, denyingAuthorization, () => NOW, undefined, undefined, null, policy);

  await assert.rejects(() => service.createInvitation(INVITE_INPUT), (error) => {
    assert.ok(error instanceof FamilyMemberInvitationError);
    assert.equal(error.code, 'NOT_AUTHORIZED');
    return true;
  });
  assert.equal(policy.calls, 0);
});

test('an allowed FREE_ACCESS account still issues the invitation, consulting the gate exactly once', async () => {
  const policy = allowingPolicy();
  let created = null;
  const repository = {
    findPendingByFamilyAndEmailHash: async () => null,
    listForFamily: async () => [],
    createAtomically: async (record) => { created = record; return { outcome: 'CREATED' }; },
  };
  const service = new FamilyMemberInvitationService(repository, allowingAuthorization(), () => NOW, undefined, undefined, null, policy);

  const record = await service.createInvitation(INVITE_INPUT);
  assert.equal(policy.calls, 1);
  assert.equal(record.status, 'PENDING');
  assert.equal(record.familyId, 'family-a');
  assert.equal(created?.invitationId, record.invitationId);
});

test('expired FREE_ACCESS never blocks accepting or revoking an invitation the family already holds', async () => {
  const policy = deniedPolicy();
  const pending = {
    invitationId: 'invitation-a',
    familyId: 'family-a',
    invitedEmailHash: Buffer.alloc(32),
    role: 'VIEWER',
    status: 'PENDING',
    invitedByAccountId: 'acct-owner',
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    acceptedAt: null,
    expiredAt: null,
    revokedAt: null,
    acceptedByAccountId: null,
  };
  const service = new FamilyMemberInvitationService(
    {
      revokeForFamily: async () => ({ ...pending, status: 'REVOKED', revokedAt: NOW }),
      acceptAtomically: async () => ({ outcome: 'ACCEPTED', record: { ...pending, status: 'ACCEPTED', acceptedAt: NOW } }),
    },
    allowingAuthorization(),
    () => NOW,
    undefined,
    undefined,
    null,
    policy,
  );

  assert.equal((await service.acceptInvitation('invitation-a', 'acct-new-member')).status, 'ACCEPTED');
  assert.equal((await service.revokeInvitationForFamily('family-a', 'invitation-a', 'dev-owner')).status, 'REVOKED');
  assert.equal(policy.calls, 0, 'FREE_ACCESS is a new-capacity acquisition gate, not a continuity gate');
});

// ---------------------------------------------------------------------------
// Production wiring stays honest. A service that ACCEPTS a policy but is
// constructed without one is exactly the shape this gap had: the contract
// named three denied operations, the invitation service took no policy
// argument at all, and main.ts passed none -- so the gate silently did not
// exist in production. Static source checks, following the precedent in
// test/billing/familyCommercialAuthorityResolver.test.mjs, because main.ts
// cannot be imported without a live database.
// ---------------------------------------------------------------------------

test('PRODUCTION WIRING: main.ts passes the SAME freeAccessAcquisitionPolicy into all three acquisition call sites', async () => {
  const mainTs = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.match(mainTs, /const freeAccessAcquisitionPolicy = new FreeAccessAcquisitionPolicy\(/);
  // One construction only -- three call sites sharing one instance, never
  // three independently-constructed copies.
  assert.equal((mainTs.match(/new FreeAccessAcquisitionPolicy\(/g) ?? []).length, 1);
  assert.equal((mainTs.match(/^\s*freeAccessAcquisitionPolicy,$/gm) ?? []).length, 3, 'device enrollment, commercial activation, AND parent-member invite');
  assert.match(
    mainTs,
    /new FamilyMemberInvitationService\(\s*new MySqlFamilyMemberInvitationRepository\(\),[\s\S]*?freeAccessAcquisitionPolicy,\s*\)/,
    'the parent-member-invite arm must receive the policy as its constructor argument',
  );
});
