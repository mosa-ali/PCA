import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyMemberInvitationService, FamilyMemberInvitationError, NoopFamilyMemberAccountBinder } from '../../dist/familymembers/FamilyMemberInvitationService.js';
import { hashInvitedEmail } from '../../dist/familymembers/emailHash.js';
import { createInMemoryFamilyMemberInvitationRepository } from '../support/inMemoryFamilyMemberInvitationRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

/** Minimal, directly-controllable fake -- the real ParentActionAuthorizationService (cross-family denial, step-up, real trust-set resolution) is exercised at the HTTP route level (familyMemberRoutes.test.mjs), not duplicated here. This file tests FamilyMemberInvitationService's OWN logic assuming a given authorize() verdict. */
function fakeAuthorization(verdict = { verdict: 'ALLOW' }) {
  const calls = [];
  return {
    calls,
    authorize(request) {
      calls.push(request);
      return verdict;
    },
  };
}

function buildService(overrides = {}) {
  const repository = overrides.repository ?? createInMemoryFamilyMemberInvitationRepository();
  let currentTime = overrides.startTime ?? BASE_TIME;
  const clock = {
    now: () => new Date(currentTime),
    advance: (ms) => { currentTime += ms; },
  };
  const authorization = overrides.authorization ?? fakeAuthorization();
  const service = new FamilyMemberInvitationService(
    repository,
    authorization,
    clock.now,
    undefined,
    overrides.accountBinder,
    overrides.entitlementRepository ?? null,
  );
  return { service, repository, clock, authorization };
}

const baseInput = { familyId: 'fam-1', invitedEmail: 'newmember@example.test', role: 'VIEWER', invitedByAccountId: 'acct-owner', actorDeviceId: 'dev-owner' };

test('createInvitation persists a PENDING invitation with a hashed email, never the plaintext', async () => {
  const { service, repository } = buildService();
  const record = await service.createInvitation(baseInput);
  assert.equal(record.status, 'PENDING');
  assert.equal(record.role, 'VIEWER');
  assert.equal(record.familyId, 'fam-1');
  assert.deepEqual(record.invitedEmailHash, hashInvitedEmail('newmember@example.test'));

  const stored = await repository.findByIdForFamily('fam-1', record.invitationId);
  assert.ok(stored);
  assert.equal(JSON.stringify(stored).includes('newmember@example.test'), false);
});

test('createInvitation rejects a malformed email', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.createInvitation({ ...baseInput, invitedEmail: 'not-an-email' }),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'INVALID_INPUT',
  );
});

test('createInvitation rejects role OWNER (or any value outside ADMINISTRATOR/VIEWER) -- ownership is never granted by invitation', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.createInvitation({ ...baseInput, role: 'OWNER' }),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'INVALID_INPUT',
  );
});

test('createInvitation refuses a second PENDING invitation for the same family+email', async () => {
  const { service } = buildService();
  await service.createInvitation(baseInput);
  await assert.rejects(
    () => service.createInvitation(baseInput),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'DUPLICATE_PENDING_INVITATION',
  );
});

test('createInvitation allows a new invitation once the prior one is revoked', async () => {
  const { service } = buildService();
  const first = await service.createInvitation(baseInput);
  await service.revokeInvitationForFamily('fam-1', first.invitationId, 'dev-owner');
  const second = await service.createInvitation(baseInput);
  assert.equal(second.status, 'PENDING');
});

test('listInvitationsForFamily never returns another family\'s invitations (IDOR defense)', async () => {
  const { service } = buildService();
  await service.createInvitation(baseInput);
  await service.createInvitation({ ...baseInput, familyId: 'fam-OTHER', invitedEmail: 'other@example.test' });
  const listed = await service.listInvitationsForFamily('fam-1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].familyId, 'fam-1');
});

test('getInvitationForFamily on a different family\'s invitation id is NOT_FOUND, not a leak of its existence', async () => {
  const { service } = buildService();
  const record = await service.createInvitation(baseInput);
  await assert.rejects(
    () => service.getInvitationForFamily('fam-OTHER', record.invitationId),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
});

test('revokeInvitationForFamily on a different family\'s invitation id is NOT_FOUND, and does not revoke it', async () => {
  const { service, repository } = buildService();
  const record = await service.createInvitation(baseInput);
  await assert.rejects(
    () => service.revokeInvitationForFamily('fam-OTHER', record.invitationId, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
  const stillPending = await repository.findByIdForFamily('fam-1', record.invitationId);
  assert.equal(stillPending.status, 'PENDING');
});

test('acceptInvitation transitions PENDING -> ACCEPTED and records the accepting account', async () => {
  const { service } = buildService();
  const created = await service.createInvitation(baseInput);
  const accepted = await service.acceptInvitation(created.invitationId, 'acct-new-member');
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(accepted.acceptedByAccountId, 'acct-new-member');
});

test('acceptInvitation calls the injected FamilyMemberAccountBinder exactly once with the family id', async () => {
  const calls = [];
  const accountBinder = { async bindAccountToFamily(accountId, familyId, now) { calls.push({ accountId, familyId, now }); } };
  const { service } = buildService({ accountBinder });
  const created = await service.createInvitation(baseInput);
  await service.acceptInvitation(created.invitationId, 'acct-new-member');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].accountId, 'acct-new-member');
  assert.deepEqual(calls[0].familyId, 'fam-1');
});

test('the default NoopFamilyMemberAccountBinder is a real, safe no-op (never throws, never mutates anything observable)', async () => {
  const binder = new NoopFamilyMemberAccountBinder();
  await assert.doesNotReject(() => binder.bindAccountToFamily('acct-1', 'fam-1', new Date()));
});

test('acceptInvitation is idempotent-safe: accepting an already-ACCEPTED invitation fails honestly, not silently', async () => {
  const { service } = buildService();
  const created = await service.createInvitation(baseInput);
  await service.acceptInvitation(created.invitationId, 'acct-new-member');
  await assert.rejects(
    () => service.acceptInvitation(created.invitationId, 'acct-someone-else'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'ALREADY_ACCEPTED',
  );
});

test('acceptInvitation on a REVOKED invitation fails honestly', async () => {
  const { service } = buildService();
  const created = await service.createInvitation(baseInput);
  await service.revokeInvitationForFamily('fam-1', created.invitationId, 'dev-owner');
  await assert.rejects(
    () => service.acceptInvitation(created.invitationId, 'acct-new-member'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'REVOKED',
  );
});

test('acceptInvitation on an EXPIRED invitation fails honestly and never binds the account', async () => {
  const calls = [];
  const accountBinder = { async bindAccountToFamily(...args) { calls.push(args); } };
  const { service, clock } = buildService({ accountBinder });
  const created = await service.createInvitation(baseInput);
  clock.advance(8 * 24 * 60 * 60 * 1000); // past the 7-day default TTL
  await assert.rejects(
    () => service.acceptInvitation(created.invitationId, 'acct-new-member'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'EXPIRED',
  );
  assert.equal(calls.length, 0);
});

test('acceptInvitation on an unknown invitation id fails honestly', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.acceptInvitation('does-not-exist', 'acct-new-member'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
});

test('listInvitationsForFamily persists a real EXPIRED transition once past expiry, not just a computed-on-read value', async () => {
  const { service, repository, clock } = buildService();
  const created = await service.createInvitation(baseInput);
  clock.advance(8 * 24 * 60 * 60 * 1000);
  const listed = await service.listInvitationsForFamily('fam-1');
  assert.equal(listed[0].status, 'EXPIRED');
  const stored = await repository.findByIdForFamily('fam-1', created.invitationId);
  assert.equal(stored.status, 'EXPIRED'); // really persisted, not only returned transiently
});

// ---- PCA product-completion programme, Writer P0-C: authorization + capacity + role-change ----

test('createInvitation calls authorize() with the correct operation for each role, and denies honestly when the verdict is not ALLOW', async () => {
  const denied = fakeAuthorization({ verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
  const { service } = buildService({ authorization: denied });
  await assert.rejects(
    () => service.createInvitation(baseInput),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_AUTHORIZED',
  );
  assert.equal(denied.calls.length, 1);
  assert.equal(denied.calls[0].operation, 'ADD_VIEWER');
  assert.equal(denied.calls[0].targetScope.kind, 'FAMILY');
  assert.equal(denied.calls[0].targetScope.id, 'fam-1');

  const denied2 = fakeAuthorization({ verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' });
  const { service: service2 } = buildService({ authorization: denied2 });
  await assert.rejects(() => service2.createInvitation({ ...baseInput, role: 'ADMINISTRATOR' }));
  assert.equal(denied2.calls[0].operation, 'ADD_ADMINISTRATOR');
});

test('revokeInvitationForFamily and changeInvitationRole call authorize() with REMOVE_NON_OWNER_PARENT / CHANGE_ROLE respectively, and deny honestly', async () => {
  // One shared repository, two service instances pointed at it with different
  // authorization verdicts -- creation succeeds via the ALLOW-wired service,
  // then the SAME persisted invitation is targeted by a DENY-wired service to
  // prove revoke/changeInvitationRole each independently consult authorize()
  // (rather than, say, only checking it at create time).
  const repository = createInMemoryFamilyMemberInvitationRepository();
  const allowService = new FamilyMemberInvitationService(repository, fakeAuthorization({ verdict: 'ALLOW' }));
  const created = await allowService.createInvitation(baseInput);

  const deniedForRevoke = fakeAuthorization({ verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' });
  const revokeDeniedService = new FamilyMemberInvitationService(repository, deniedForRevoke);
  await assert.rejects(
    () => revokeDeniedService.revokeInvitationForFamily('fam-1', created.invitationId, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_AUTHORIZED',
  );
  assert.equal(deniedForRevoke.calls[0].operation, 'REMOVE_NON_OWNER_PARENT');
  assert.equal((await repository.findByIdForFamily('fam-1', created.invitationId)).status, 'PENDING'); // never actually revoked

  const deniedForRole = fakeAuthorization({ verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' });
  const roleChangeDeniedService = new FamilyMemberInvitationService(repository, deniedForRole);
  await assert.rejects(
    () => roleChangeDeniedService.changeInvitationRole('fam-1', created.invitationId, 'ADMINISTRATOR', 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_AUTHORIZED',
  );
  assert.equal(deniedForRole.calls[0].operation, 'CHANGE_ROLE');
  assert.equal((await repository.findByIdForFamily('fam-1', created.invitationId)).role, 'VIEWER'); // never actually changed
});

test('changeInvitationRole revises a still-PENDING invitation\'s role', async () => {
  const { service, repository } = buildService();
  const created = await service.createInvitation(baseInput);
  assert.equal(created.role, 'VIEWER');
  const updated = await service.changeInvitationRole('fam-1', created.invitationId, 'ADMINISTRATOR', 'dev-owner');
  assert.equal(updated.role, 'ADMINISTRATOR');
  const stored = await repository.findByIdForFamily('fam-1', created.invitationId);
  assert.equal(stored.role, 'ADMINISTRATOR'); // really persisted
});

test('changeInvitationRole refuses to change an already-ACCEPTED invitation\'s role (NOT_PENDING) -- once accepted, role comes from TrustSetRoleResolver, not this table', async () => {
  const { service } = buildService();
  const created = await service.createInvitation(baseInput);
  await service.acceptInvitation(created.invitationId, 'acct-new-member');
  await assert.rejects(
    () => service.changeInvitationRole('fam-1', created.invitationId, 'ADMINISTRATOR', 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_PENDING',
  );
});

test('changeInvitationRole rejects an invalid role value', async () => {
  const { service } = buildService();
  const created = await service.createInvitation(baseInput);
  await assert.rejects(
    () => service.changeInvitationRole('fam-1', created.invitationId, 'OWNER', 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'INVALID_INPUT',
  );
});

test('createInvitation denies with CAPACITY_EXCEEDED once used + pending invitations reach the family\'s parentMemberLimit, and never persists the invitation', async () => {
  const entitlementRepository = {
    async getForFamily(familyId) {
      return { familyId, parentMemberLimit: 2, parentMemberUsedCount: 1 };
    },
  };
  const { service, repository } = buildService({ entitlementRepository });
  // 1 used + this 1 new pending would reach the limit of 2 -- allowed exactly at the boundary.
  const first = await service.createInvitation(baseInput);
  assert.equal(first.status, 'PENDING');
  // A second invitation would push used(1) + pending(1 existing + 1 new) = 3 > limit(2) -- denied.
  await assert.rejects(
    () => service.createInvitation({ ...baseInput, invitedEmail: 'second@example.test' }),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'CAPACITY_EXCEEDED',
  );
  const listed = await repository.listForFamily('fam-1');
  assert.equal(listed.length, 1); // the denied invitation was never persisted
});

test('createInvitation skips the capacity check entirely when no entitlementRepository is supplied (backward compatible with pre-P0-C callers)', async () => {
  const { service } = buildService({ entitlementRepository: null });
  await assert.doesNotReject(() => service.createInvitation(baseInput));
});
