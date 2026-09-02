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

// The invited person's real, registered account: acceptAtomically's IDENTITY
// BINDING contract means only the account whose OWN email hash matches an
// invitation's invited_email_hash can ever accept it.
const INVITED_EMAIL = 'newmember@example.test';
const INVITED_ACCOUNT = 'acct-new-member';

function seededAccountEmailHashes(extra = []) {
  return new Map([[INVITED_ACCOUNT, hashInvitedEmail(INVITED_EMAIL)], ...extra]);
}

function buildService(overrides = {}) {
  const repository =
    overrides.repository ?? createInMemoryFamilyMemberInvitationRepository({ accountEmailHashes: seededAccountEmailHashes() });
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

const baseInput = { familyId: 'fam-1', invitedEmail: INVITED_EMAIL, role: 'VIEWER', invitedByAccountId: 'acct-owner', actorDeviceId: 'dev-owner' };

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
  await service.acceptInvitation(created.invitationId, INVITED_ACCOUNT);
  await assert.rejects(
    () => service.acceptInvitation(created.invitationId, INVITED_ACCOUNT),
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
    async getEffectiveSnapshotForFamily() {
      return { effectiveParentMemberLimit: 2, baseParentMemberLimit: 2, complimentaryParentMemberCapacity: 0, parentMemberUsed: 1 };
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

// ---- Invitation acceptance is bound to the invited identity ----

test('acceptInvitation refuses an authenticated account the invitation was NOT addressed to, and reports it as NOT_FOUND (never a distinguishable "exists but not yours")', async () => {
  const repository = createInMemoryFamilyMemberInvitationRepository({
    accountEmailHashes: seededAccountEmailHashes([['acct-stranger', hashInvitedEmail('stranger@example.test')]]),
  });
  const { service } = buildService({ repository });
  const created = await service.createInvitation(baseInput);

  await assert.rejects(
    () => service.acceptInvitation(created.invitationId, 'acct-stranger'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
  // The invitation is untouched -- the stranger gained no role in this family.
  const stored = await repository.findByIdForFamily('fam-1', created.invitationId);
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.acceptedByAccountId, null);
});

test('acceptInvitation never binds a non-addressee to the family, and the real addressee can still accept afterwards', async () => {
  const bindCalls = [];
  const accountBinder = { async bindAccountToFamily(accountId, familyId) { bindCalls.push({ accountId, familyId }); } };
  const repository = createInMemoryFamilyMemberInvitationRepository({
    accountEmailHashes: seededAccountEmailHashes([['acct-stranger', hashInvitedEmail('stranger@example.test')]]),
  });
  const { service } = buildService({ repository, accountBinder });
  const created = await service.createInvitation(baseInput);

  await assert.rejects(() => service.acceptInvitation(created.invitationId, 'acct-stranger'));
  assert.equal(bindCalls.length, 0);

  const accepted = await service.acceptInvitation(created.invitationId, INVITED_ACCOUNT);
  assert.equal(accepted.status, 'ACCEPTED');
  assert.deepEqual(bindCalls, [{ accountId: INVITED_ACCOUNT, familyId: 'fam-1' }]);
});

test('acceptInvitation refuses an accepting account with no registered email hash at all (fails closed, NOT_FOUND)', async () => {
  const { service } = buildService();
  const created = await service.createInvitation(baseInput);
  await assert.rejects(
    () => service.acceptInvitation(created.invitationId, 'acct-never-registered'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
});

// ---- Effective (complimentary-inclusive) capacity ----

test('createInvitation counts COMPLIMENTARY parent-member capacity, not just the base entitlement column', async () => {
  // Base limit 1, already fully used -- but an ACTIVE complimentary grant of
  // 2 raises the EFFECTIVE limit to 3, so this invitation genuinely fits.
  const entitlementRepository = {
    async getForFamily() {
      return { parentMemberLimit: 1, parentMemberUsedCount: 1 };
    },
    async getEffectiveSnapshotForFamily() {
      return { baseParentMemberLimit: 1, complimentaryParentMemberCapacity: 2, effectiveParentMemberLimit: 3, parentMemberUsed: 1 };
    },
  };
  const { service } = buildService({ entitlementRepository });
  const created = await service.createInvitation(baseInput);
  assert.equal(created.status, 'PENDING');
});

test('createInvitation passes the decision time through to getEffectiveSnapshotForFamily, so an EXPIRED complimentary grant is not counted', async () => {
  const asOfCalls = [];
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily(familyId, now) {
      asOfCalls.push({ familyId, now });
      return { baseParentMemberLimit: 4, complimentaryParentMemberCapacity: 0, effectiveParentMemberLimit: 4, parentMemberUsed: 0 };
    },
  };
  const { service } = buildService({ entitlementRepository });
  await service.createInvitation(baseInput);
  assert.equal(asOfCalls.length, 1);
  assert.equal(asOfCalls[0].familyId, 'fam-1');
  assert.equal(asOfCalls[0].now.getTime(), BASE_TIME);
});

// ---- Parent-member seat consumption ----

test('acceptInvitation consumes exactly one parent-member seat, inside the same transaction that flips the invitation row', async () => {
  const adjustments = [];
  const locks = [];
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily() {
      return { baseParentMemberLimit: 4, complimentaryParentMemberCapacity: 0, effectiveParentMemberLimit: 4, parentMemberUsed: 0 };
    },
    async lockForFamily(_conn, familyId) {
      locks.push(familyId);
      return { familyId, parentMemberUsedCount: 0 };
    },
    async adjustParentMemberUsedCount(_conn, familyId, delta, now) {
      adjustments.push({ familyId, delta, now });
      return { familyId, parentMemberUsedCount: delta };
    },
  };
  const { service } = buildService({ entitlementRepository });
  const created = await service.createInvitation(baseInput);
  await service.acceptInvitation(created.invitationId, INVITED_ACCOUNT);

  assert.deepEqual(locks, ['fam-1'], 'the family entitlement row must be locked before it is adjusted');
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].familyId, 'fam-1');
  assert.equal(adjustments[0].delta, 1);
});

test('re-inviting someone who is already a member charges no second seat (seat is per member, not per acceptance)', async () => {
  // createInvitation's only duplicate guard is "no PENDING invitation for
  // this address", so re-inviting an existing member is allowed -- and is in
  // fact the only way to offer them a different role, since
  // changeInvitationRole refuses anything not PENDING. Without a
  // prior-acceptance check the second acceptance charged a second seat while
  // accountBinder (idempotent) changed no membership at all, permanently
  // burning a seat the family had paid for and eventually producing a false
  // CAPACITY_EXCEEDED on an invitation the family was entitled to.
  const adjustments = [];
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily() {
      return { baseParentMemberLimit: 4, complimentaryParentMemberCapacity: 0, effectiveParentMemberLimit: 4, parentMemberUsed: 0 };
    },
    async lockForFamily(_conn, familyId) {
      return { familyId, parentMemberUsedCount: 0 };
    },
    async adjustParentMemberUsedCount(_conn, familyId, delta, now) {
      adjustments.push({ familyId, delta, now });
      return { familyId, parentMemberUsedCount: delta };
    },
  };
  const { service } = buildService({ entitlementRepository });

  const first = await service.createInvitation(baseInput);
  await service.acceptInvitation(first.invitationId, INVITED_ACCOUNT);
  assert.equal(adjustments.length, 1, 'the first acceptance charges the seat');

  // Same person, invited again (nothing PENDING, so this is allowed) and
  // accepting again.
  const second = await service.createInvitation(baseInput);
  await service.acceptInvitation(second.invitationId, INVITED_ACCOUNT);

  assert.equal(adjustments.length, 1, 'the same account accepting twice must never charge two seats');
});

test('a refused acceptance consumes no seat at all', async () => {
  const adjustments = [];
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily() {
      return { baseParentMemberLimit: 4, complimentaryParentMemberCapacity: 0, effectiveParentMemberLimit: 4, parentMemberUsed: 0 };
    },
    async lockForFamily(_conn, familyId) { return { familyId, parentMemberUsedCount: 0 }; },
    async adjustParentMemberUsedCount(_conn, familyId, delta) { adjustments.push({ familyId, delta }); return { familyId }; },
  };
  const repository = createInMemoryFamilyMemberInvitationRepository({
    accountEmailHashes: seededAccountEmailHashes([['acct-stranger', hashInvitedEmail('stranger@example.test')]]),
  });
  const { service } = buildService({ repository, entitlementRepository });
  const created = await service.createInvitation(baseInput);

  await assert.rejects(() => service.acceptInvitation(created.invitationId, 'acct-stranger'));
  await service.acceptInvitation(created.invitationId, INVITED_ACCOUNT);
  await assert.rejects(() => service.acceptInvitation(created.invitationId, INVITED_ACCOUNT)); // ALREADY_ACCEPTED

  assert.equal(adjustments.length, 1, 'only the one genuine acceptance may ever charge a seat');
});

test('a seat adjustment that fails rolls the whole acceptance back -- the invitation is never left ACCEPTED with an uncharged seat', async () => {
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily() {
      return { baseParentMemberLimit: 4, complimentaryParentMemberCapacity: 0, effectiveParentMemberLimit: 4, parentMemberUsed: 0 };
    },
    async lockForFamily(_conn, familyId) { return { familyId, parentMemberUsedCount: 0 }; },
    async adjustParentMemberUsedCount() { throw new Error('entitlement ledger unavailable'); },
  };
  const { service, repository } = buildService({ entitlementRepository });
  const created = await service.createInvitation(baseInput);

  await assert.rejects(() => service.acceptInvitation(created.invitationId, INVITED_ACCOUNT), /entitlement ledger unavailable/);
  const stored = await repository.findByIdForFamily('fam-1', created.invitationId);
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.acceptedByAccountId, null);
});

test('acceptInvitation charges no seat when the family has no account_entitlements row yet (nothing to charge, never a fabricated row)', async () => {
  const adjustments = [];
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily() { return null; },
    async lockForFamily() { return null; },
    async adjustParentMemberUsedCount(_conn, familyId, delta) { adjustments.push({ familyId, delta }); return { familyId }; },
  };
  const { service } = buildService({ entitlementRepository });
  const created = await service.createInvitation(baseInput);
  const accepted = await service.acceptInvitation(created.invitationId, INVITED_ACCOUNT);
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(adjustments.length, 0);
});

// ---- Member removal ----

const OWNER_ACCOUNT = 'acct-owner-1';
const MEMBER_ACCOUNT = 'acct-member-1';

/** `accountFamilyIds` seeds OWNER_ACCOUNT and MEMBER_ACCOUNT as both currently bound to fam-1 -- see the double's own header comment on why this map (not acceptInvitation) is what removeMemberAtomically reads/clears. */
function buildRemovableRepository(overrides = {}) {
  return createInMemoryFamilyMemberInvitationRepository({
    accountEmailHashes: seededAccountEmailHashes(),
    accountFamilyIds: overrides.accountFamilyIds ?? new Map([
      [OWNER_ACCOUNT, 'fam-1'],
      [MEMBER_ACCOUNT, 'fam-1'],
    ]),
  });
}

/** Seeds an ACCEPTED family_member_invitations row for accountId directly (bypassing acceptInvitation, since that path does not itself populate accountFamilyIds in this double -- see the double's own header comment) so removeMemberAtomically's owner-protection NOT EXISTS check finds it, exactly like a real prior acceptance would. */
async function seedAcceptedMember(repository, { familyId = 'fam-1', accountId = MEMBER_ACCOUNT } = {}) {
  await repository.create({
    invitationId: `inv-${accountId}`,
    familyId,
    invitedEmailHash: hashInvitedEmail(`${accountId}@example.test`),
    role: 'VIEWER',
    status: 'ACCEPTED',
    invitedByAccountId: OWNER_ACCOUNT,
    createdAt: new Date(BASE_TIME),
    expiresAt: new Date(BASE_TIME + 1000),
    acceptedAt: new Date(BASE_TIME),
    expiredAt: null,
    revokedAt: null,
    acceptedByAccountId: accountId,
  });
}

/** Minimal stateful EntitlementRepository fake used only by the round-trip test below -- unlike the shared support/inMemoryEntitlementRepository.mjs fixture, this implements getEffectiveSnapshotForFamily (createInvitation's capacity-check dependency), so one object can honestly drive create -> accept -> remove -> create through real capacity accounting. */
function statefulEntitlementRepositoryFake({ parentMemberLimit, parentMemberUsedCount }) {
  const state = { parentMemberLimit, parentMemberUsedCount };
  return {
    state,
    async getEffectiveSnapshotForFamily() {
      return {
        baseParentMemberLimit: state.parentMemberLimit,
        complimentaryParentMemberCapacity: 0,
        effectiveParentMemberLimit: state.parentMemberLimit,
        parentMemberUsed: state.parentMemberUsedCount,
      };
    },
    async lockForFamily() {
      return { parentMemberUsedCount: state.parentMemberUsedCount };
    },
    async adjustParentMemberUsedCount(_conn, _familyId, delta) {
      state.parentMemberUsedCount += delta;
      return { parentMemberUsedCount: state.parentMemberUsedCount };
    },
  };
}

test('removeMember releases exactly one parent-member seat, inside the same transaction that clears the member\'s family binding', async () => {
  const adjustments = [];
  const locks = [];
  const entitlementRepository = {
    async lockForFamily(_conn, familyId) { locks.push(familyId); return { familyId, parentMemberUsedCount: 2 }; },
    async adjustParentMemberUsedCount(_conn, familyId, delta, now) { adjustments.push({ familyId, delta, now }); return { familyId, parentMemberUsedCount: 2 + delta }; },
  };
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const { service } = buildService({ repository, entitlementRepository });

  await service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner');
  assert.deepEqual(locks, ['fam-1'], 'the family entitlement row must be locked before it is adjusted');
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].familyId, 'fam-1');
  assert.equal(adjustments[0].delta, -1);
});

test('removeMember is idempotent/double-free safe: retrying an already-completed removal is a safe no-op, never a second seat release', async () => {
  const adjustments = [];
  const entitlementRepository = {
    async lockForFamily() { return { parentMemberUsedCount: 2 }; },
    async adjustParentMemberUsedCount(_conn, familyId, delta) { adjustments.push(delta); return { parentMemberUsedCount: 2 + delta }; },
  };
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const { service } = buildService({ repository, entitlementRepository });

  await service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner');
  assert.equal(adjustments.length, 1);

  await assert.rejects(
    () => service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
  assert.equal(adjustments.length, 1, 'a retried removal must never release a second seat');
});

test('removeMember calls authorize() with REMOVE_NON_OWNER_PARENT against a FAMILY target, and denies honestly, releasing no seat', async () => {
  const denied = fakeAuthorization({ verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' });
  const adjustments = [];
  const entitlementRepository = {
    async lockForFamily() { return { parentMemberUsedCount: 1 }; },
    async adjustParentMemberUsedCount(_conn, _familyId, delta) { adjustments.push(delta); return {}; },
  };
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const { service } = buildService({ repository, authorization: denied, entitlementRepository });

  await assert.rejects(
    () => service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_AUTHORIZED',
  );
  assert.equal(denied.calls.length, 1);
  assert.equal(denied.calls[0].operation, 'REMOVE_NON_OWNER_PARENT');
  assert.equal(denied.calls[0].targetScope.kind, 'FAMILY');
  assert.equal(denied.calls[0].targetScope.id, 'fam-1');
  assert.equal(adjustments.length, 0);
});

test('removeMember refuses self-removal before ever consulting authorize() (never a "leave this family" flow)', async () => {
  const authorization = fakeAuthorization();
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const { service } = buildService({ repository, authorization });

  await assert.rejects(
    () => service.removeMember('fam-1', MEMBER_ACCOUNT, MEMBER_ACCOUNT, 'dev-member'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'CANNOT_REMOVE_SELF',
  );
  assert.equal(authorization.calls.length, 0, 'self-removal must be refused before authorize() is ever called');
});

test('removeMember refuses to remove the family owner -- the account bound to this family with no ACCEPTED invitation into it', async () => {
  const repository = buildRemovableRepository(); // OWNER_ACCOUNT is bound to fam-1 but has no seeded ACCEPTED invitation
  const { service } = buildService({ repository });

  await assert.rejects(
    () => service.removeMember('fam-1', OWNER_ACCOUNT, 'acct-admin-1', 'dev-admin'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'CANNOT_REMOVE_OWNER',
  );
});

test('removeMember on an unknown account, or one bound to a different family, is honestly NOT_FOUND (never a distinguishable "exists elsewhere")', async () => {
  const repository = buildRemovableRepository();
  const { service } = buildService({ repository });

  await assert.rejects(
    () => service.removeMember('fam-1', 'acct-does-not-exist', OWNER_ACCOUNT, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );

  repository._setAccountFamilyIdForTest('acct-elsewhere', 'fam-OTHER');
  await assert.rejects(
    () => service.removeMember('fam-1', 'acct-elsewhere', OWNER_ACCOUNT, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  );
});

test('a seat-release failure rolls the whole removal back -- retrying afterwards still finds (and can remove) the same member', async () => {
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const failingEntitlementRepository = {
    async lockForFamily() { return { parentMemberUsedCount: 2 }; },
    async adjustParentMemberUsedCount() { throw new Error('entitlement ledger unavailable'); },
  };
  const { service: failingService } = buildService({ repository, entitlementRepository: failingEntitlementRepository });
  await assert.rejects(
    () => failingService.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner'),
    /entitlement ledger unavailable/,
  );

  const adjustments = [];
  const workingEntitlementRepository = {
    async lockForFamily() { return { parentMemberUsedCount: 2 }; },
    async adjustParentMemberUsedCount(_conn, _familyId, delta) { adjustments.push(delta); return {}; },
  };
  const { service: workingService } = buildService({ repository, entitlementRepository: workingEntitlementRepository });
  // If the failed attempt had wrongly persisted the family_id clear despite
  // the hook throwing, this would fail with NOT_FOUND instead of succeeding.
  await workingService.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner');
  assert.deepEqual(adjustments, [-1]);
});

test('removeMember releases no seat when no entitlementRepository is supplied, and still genuinely removes the member', async () => {
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const { service } = buildService({ repository, entitlementRepository: null });

  await service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner');
  await assert.rejects(
    () => service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner'),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'NOT_FOUND',
  ); // confirms it really was removed the first time
});

test('removeMember releases no seat when the family has no account_entitlements row yet (nothing to release, never a fabricated adjustment)', async () => {
  const adjustments = [];
  const entitlementRepository = {
    async lockForFamily() { return null; },
    async adjustParentMemberUsedCount(_conn, _familyId, delta) { adjustments.push(delta); return {}; },
  };
  const repository = buildRemovableRepository();
  await seedAcceptedMember(repository);
  const { service } = buildService({ repository, entitlementRepository });

  await service.removeMember('fam-1', MEMBER_ACCOUNT, OWNER_ACCOUNT, 'dev-owner');
  assert.equal(adjustments.length, 0);
});

test('round trip: accepting consumes a seat, removing releases it, and a new invitation can then reuse the freed capacity', async () => {
  const entitlementRepository = statefulEntitlementRepositoryFake({ parentMemberLimit: 1, parentMemberUsedCount: 0 });
  const repository = createInMemoryFamilyMemberInvitationRepository({ accountEmailHashes: seededAccountEmailHashes() });
  const { service } = buildService({ repository, entitlementRepository });

  const first = await service.createInvitation(baseInput);
  await service.acceptInvitation(first.invitationId, INVITED_ACCOUNT);
  assert.equal(entitlementRepository.state.parentMemberUsedCount, 1);

  await assert.rejects(
    () => service.createInvitation({ ...baseInput, invitedEmail: 'second@example.test' }),
    (err) => err instanceof FamilyMemberInvitationError && err.code === 'CAPACITY_EXCEEDED',
  );

  // The real MySqlFamilyMemberAccountBinder durably wrote
  // parent_accounts.family_id after acceptInvitation resolved -- this
  // double doesn't do that itself (see its own header comment), so seed it
  // to reflect that same post-commit state before removing.
  repository._setAccountFamilyIdForTest(INVITED_ACCOUNT, 'fam-1');
  await service.removeMember('fam-1', INVITED_ACCOUNT, 'acct-owner', 'dev-owner');
  assert.equal(entitlementRepository.state.parentMemberUsedCount, 0);

  const second = await service.createInvitation({ ...baseInput, invitedEmail: 'second@example.test' });
  assert.equal(second.status, 'PENDING');
});
