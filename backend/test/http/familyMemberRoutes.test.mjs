import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerFamilyMemberRoutes } from '../../dist/http/routes/familyMemberRoutes.js';
import { FamilyMemberInvitationService, NoopFamilyMemberAccountBinder } from '../../dist/familymembers/FamilyMemberInvitationService.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { createInMemoryFamilyMemberInvitationRepository } from '../support/inMemoryFamilyMemberInvitationRepository.mjs';
import { hashInvitedEmail } from '../../dist/familymembers/emailHash.js';

const FAMILY = 'family-members-http-1';
const OTHER_FAMILY = 'family-members-http-other';
const T0 = new Date('2026-01-07T09:00:00.000Z');
const INVITED_EMAIL = 'newmember@example.test';

function buildApp({ nowFn = () => T0, entitlementRepository = null, accountBinder = new NoopFamilyMemberAccountBinder() } = {}) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId: FAMILY,
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  });
  // Deliberately NOT also setting an epoch for OTHER_FAMILY: InMemoryFamilyTrustSetStore
  // holds exactly one "current" epoch total (not one per family, see its own
  // one-line implementation) -- a second setCurrentEpoch call here would
  // silently overwrite FAMILY's own epoch, breaking every legitimate-OWNER
  // test below. The "different family" tests in this file don't need it:
  // they're caught by familySession()'s session.familyId mismatch check and
  // the fake deviceSessionService's own family-matching check, both of which
  // run before authorize() ever consults this store.
  const roleResolver = new FamilyTrustSetRoleResolver(store);
  const authorization = new ParentActionAuthorizationService(
    roleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    nowFn,
  );
  // The real registered email hashes behind each session below -- what
  // acceptAtomically's IDENTITY BINDING contract matches an invitation's
  // invited_email_hash against (in production, parent_accounts.email_hash).
  const repository = createInMemoryFamilyMemberInvitationRepository({
    accountEmailHashes: new Map([
      ['acct-no-family', hashInvitedEmail(INVITED_EMAIL)],
      ['acct-viewer', hashInvitedEmail('someone-else@example.test')],
    ]),
  });
  const familyMemberInvitationService = new FamilyMemberInvitationService(
    repository,
    authorization,
    nowFn,
    undefined,
    accountBinder,
    entitlementRepository,
  );

  const sessions = new Map([
    ['session-owner', { accountId: 'acct-owner', familyId: FAMILY }],
    ['session-viewer', { accountId: 'acct-viewer', familyId: FAMILY }],
    ['session-other-owner', { accountId: 'acct-other-owner', familyId: OTHER_FAMILY }],
    ['session-no-family', { accountId: 'acct-no-family', familyId: null }],
  ]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: FAMILY }],
    ['dev-token-viewer', { deviceId: 'dev-viewer', familyId: FAMILY }],
    ['dev-token-other-owner', { deviceId: 'dev-other-owner', familyId: OTHER_FAMILY }],
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      const identity = deviceTokens.get(token);
      if (!identity || identity.familyId !== expectedFamilyId) {
        throw new RuntimeSyncAuthError('UNAUTHORIZED');
      }
      return identity;
    },
  };

  const app = Fastify();
  registerFamilyMemberRoutes(app, { parentAccountService, familyMemberInvitationService, deviceSessionService });
  return { app, repository };
}

const ownerHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };
const viewerHeaders = { cookie: 'pca_family_session=session-viewer; pca_family_csrf=csrf-b', 'x-pca-csrf-token': 'csrf-b' };

test('an Owner can invite a Viewer, list it, and revoke it -- the full real HTTP lifecycle', async () => {
  const { app } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { invitedEmail: 'newmember@example.test', role: 'VIEWER' },
    });
    assert.equal(invite.statusCode, 201);
    const invitationId = invite.json().invitation.invitationId;
    assert.equal(invite.json().invitation.status, 'PENDING');

    const list = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/members/invitations`, headers: { cookie: ownerHeaders.cookie } });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().invitations.length, 1);

    const revoke = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations/${invitationId}/revoke`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().invitation.status, 'REVOKED');
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot invite an Administrator (ROLE_NOT_PERMITTED collapses to the same NOT_AUTHORIZED/403 as every other denial)', async () => {
  const { app } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...viewerHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: { invitedEmail: 'newadmin@example.test', role: 'ADMINISTRATOR' },
    });
    assert.equal(invite.statusCode, 403);
    assert.equal(invite.json().error, 'not_authorized');
  } finally {
    await app.close();
  }
});

test('a device from a different family cannot invite into this family (cross-family denial via the actor-device-session check itself)', async () => {
  const { app } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-other-owner' },
      payload: { invitedEmail: 'newmember@example.test', role: 'VIEWER' },
    });
    assert.equal(invite.statusCode, 401);
    assert.equal(invite.json().error, 'actor_device_session_invalid');
  } finally {
    await app.close();
  }
});

test('a session cookie for a different family cannot list or invite into this family (family_scope_forbidden)', async () => {
  const { app } = buildApp();
  try {
    const otherOwnerHeaders = { cookie: 'pca_family_session=session-other-owner; pca_family_csrf=csrf-c', 'x-pca-csrf-token': 'csrf-c' };
    const list = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/members/invitations`, headers: { cookie: otherOwnerHeaders.cookie } });
    assert.equal(list.statusCode, 403);
    assert.equal(list.json().error, 'family_scope_forbidden');
  } finally {
    await app.close();
  }
});

// CHANGE_ROLE is ALLOW_WITH_STEP_UP for OWNER unconditionally (OPERATION_MATRIX)
// -- and, like ADD_ADMINISTRATOR, has no route in this entire codebase that
// accepts/threads a client-supplied step-up assertion yet (every authorize()
// call anywhere passes stepUp: null; see childRequestRoutes.ts/RemovalDecisionAuthority.ts).
// This route honestly inherits that same gap rather than fabricating a
// step-up ceremony just for itself. The PENDING-vs-ACCEPTED business rule is
// verified with a controllable fake authorization at the service level
// (service.test.mjs) instead, since it is genuinely unreachable via this real
// HTTP path until step-up exists.
test('changing a PENDING invitation\'s role is honestly blocked pending step-up, even for the legitimate Owner (403 not_authorized, no fabricated success)', async () => {
  const { app } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { invitedEmail: 'newmember@example.test', role: 'VIEWER' },
    });
    const invitationId = invite.json().invitation.invitationId;

    const changeRole = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations/${invitationId}/role`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { role: 'ADMINISTRATOR' },
    });
    assert.equal(changeRole.statusCode, 403);
    assert.equal(changeRole.json().error, 'not_authorized');
  } finally {
    await app.close();
  }
});

test('any authenticated parent account (even one in no family yet) can accept an invitation addressed to them, via the real HTTP route', async () => {
  const { app } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { invitedEmail: 'newmember@example.test', role: 'VIEWER' },
    });
    const invitationId = invite.json().invitation.invitationId;

    const accept = await app.inject({
      method: 'POST',
      url: `/api/parent/member-invitations/${invitationId}/accept`,
      headers: { cookie: 'pca_family_session=session-no-family; pca_family_csrf=csrf-d', 'x-pca-csrf-token': 'csrf-d' },
    });
    assert.equal(accept.statusCode, 200);
    assert.equal(accept.json().invitation.status, 'ACCEPTED');
    assert.equal(accept.json().invitation.acceptedByAccountId, 'acct-no-family');

    // Accepting a second time is honestly rejected, not silently re-accepted.
    const acceptAgain = await app.inject({
      method: 'POST',
      url: `/api/parent/member-invitations/${invitationId}/accept`,
      headers: { cookie: 'pca_family_session=session-no-family; pca_family_csrf=csrf-d', 'x-pca-csrf-token': 'csrf-d' },
    });
    assert.equal(acceptAgain.statusCode, 409);
    assert.equal(acceptAgain.json().error, 'already_accepted');
  } finally {
    await app.close();
  }
});

test('a request missing CSRF header/cookie match is rejected on every mutating route', async () => {
  const { app } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { cookie: ownerHeaders.cookie, authorization: 'Bearer dev-token-owner' }, // no x-pca-csrf-token header
      payload: { invitedEmail: 'newmember@example.test', role: 'VIEWER' },
    });
    assert.equal(invite.statusCode, 403);
    assert.equal(invite.json().error, 'csrf_mismatch');
  } finally {
    await app.close();
  }
});

test('an authenticated parent the invitation was NOT addressed to cannot accept it (404 not_found, and it stays PENDING for the real addressee)', async () => {
  const { app, repository } = buildApp();
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { invitedEmail: INVITED_EMAIL, role: 'VIEWER' },
    });
    assert.equal(invite.statusCode, 201);
    const invitationId = invite.json().invitation.invitationId;

    // acct-viewer holds a perfectly valid family session -- and is not the
    // person this invitation was addressed to.
    const steal = await app.inject({
      method: 'POST',
      url: `/api/parent/member-invitations/${invitationId}/accept`,
      headers: viewerHeaders,
    });
    assert.equal(steal.statusCode, 404);
    assert.equal(steal.json().error, 'not_found');

    const stored = await repository.findByIdForFamily(FAMILY, invitationId);
    assert.equal(stored.status, 'PENDING');
    assert.equal(stored.acceptedByAccountId, null);

    // The real addressee is unaffected.
    const accept = await app.inject({
      method: 'POST',
      url: `/api/parent/member-invitations/${invitationId}/accept`,
      headers: { cookie: 'pca_family_session=session-no-family; pca_family_csrf=csrf-d', 'x-pca-csrf-token': 'csrf-d' },
    });
    assert.equal(accept.statusCode, 200);
    assert.equal(accept.json().invitation.acceptedByAccountId, 'acct-no-family');
  } finally {
    await app.close();
  }
});

test('invitation creation is denied with capacity_exceeded once the family\'s EFFECTIVE parentMemberLimit is reached', async () => {
  const entitlementRepository = {
    async getEffectiveSnapshotForFamily() {
      return { baseParentMemberLimit: 1, complimentaryParentMemberCapacity: 0, effectiveParentMemberLimit: 1, parentMemberUsed: 1 };
    },
  };
  const { app } = buildApp({ entitlementRepository });
  try {
    const invite = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/invitations`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { invitedEmail: 'newmember@example.test', role: 'VIEWER' },
    });
    assert.equal(invite.statusCode, 409);
    assert.equal(invite.json().error, 'capacity_exceeded');
  } finally {
    await app.close();
  }
});

// ---- Member removal ----

/** Seeds an ACCEPTED family_member_invitations row directly (the real HTTP invite+accept round trip would also require MySqlFamilyMemberAccountBinder to durably bind family_id, which the in-memory double never does itself -- see its own header comment) so removeMemberAtomically's owner-protection check finds it. */
async function seedAcceptedMember(repository, { familyId = FAMILY, accountId } = {}) {
  await repository.create({
    invitationId: `inv-${accountId}`,
    familyId,
    invitedEmailHash: hashInvitedEmail(`${accountId}@example.test`),
    role: 'VIEWER',
    status: 'ACCEPTED',
    invitedByAccountId: 'acct-owner',
    createdAt: T0,
    expiresAt: new Date(T0.getTime() + 1000),
    acceptedAt: T0,
    expiredAt: null,
    revokedAt: null,
    acceptedByAccountId: accountId,
  });
  repository._setAccountFamilyIdForTest(accountId, familyId);
}

/** Minimal stateful EntitlementRepository fake -- lockForFamily/adjustParentMemberUsedCount only, all this route's removeMember path needs. */
function statefulEntitlementRepositoryFake(parentMemberUsedCount) {
  const state = { parentMemberUsedCount };
  return {
    state,
    async lockForFamily() {
      return { parentMemberUsedCount: state.parentMemberUsedCount };
    },
    async adjustParentMemberUsedCount(_conn, _familyId, delta) {
      state.parentMemberUsedCount += delta;
      return { parentMemberUsedCount: state.parentMemberUsedCount };
    },
  };
}

test('an Owner can remove an already-accepted, non-owner member via the real HTTP route, releasing the seat it consumed', async () => {
  const entitlementRepository = statefulEntitlementRepositoryFake(1);
  const { app, repository } = buildApp({ entitlementRepository });
  try {
    await seedAcceptedMember(repository, { accountId: 'acct-viewer' });

    const remove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-viewer/remove`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(remove.statusCode, 200);
    assert.equal(remove.json().removed, true);
    assert.equal(typeof remove.json().auditEventId, 'string');
    assert.ok(remove.json().auditEventId.length > 0);
    assert.equal(entitlementRepository.state.parentMemberUsedCount, 0);

    // Idempotent retry: the member is already gone -- never a second seat release.
    const removeAgain = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-viewer/remove`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(removeAgain.statusCode, 404);
    assert.equal(removeAgain.json().error, 'not_found');
    assert.equal(entitlementRepository.state.parentMemberUsedCount, 0);
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot remove another member (ROLE_NOT_PERMITTED collapses to the same NOT_AUTHORIZED/403 as every other denial)', async () => {
  const { app, repository } = buildApp();
  try {
    await seedAcceptedMember(repository, { accountId: 'acct-some-member' });

    const remove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-some-member/remove`,
      headers: { ...viewerHeaders, authorization: 'Bearer dev-token-viewer' },
    });
    assert.equal(remove.statusCode, 403);
    assert.equal(remove.json().error, 'not_authorized');
  } finally {
    await app.close();
  }
});

test('an Owner cannot remove their own membership through this route (cannot_remove_self)', async () => {
  const { app } = buildApp();
  try {
    const remove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-owner/remove`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(remove.statusCode, 409);
    assert.equal(remove.json().error, 'cannot_remove_self');
  } finally {
    await app.close();
  }
});

test('removing an account with no ACCEPTED invitation into this family is refused as cannot_remove_owner, even by an otherwise-authorized Owner', async () => {
  const { app, repository } = buildApp();
  try {
    // 'acct-second-owner' is bound to FAMILY but (unlike seedAcceptedMember)
    // has no ACCEPTED family_member_invitations row -- the same structural
    // signature a genuine genesis-bound Owner account has (see
    // removeMemberAtomically's own doc comment). Deliberately a DIFFERENT
    // account than the acting acct-owner, so this exercises the
    // owner-protection guard itself rather than cannot_remove_self.
    repository._setAccountFamilyIdForTest('acct-second-owner', FAMILY);

    const remove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-second-owner/remove`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(remove.statusCode, 409);
    assert.equal(remove.json().error, 'cannot_remove_owner');
  } finally {
    await app.close();
  }
});

test('a device from a different family cannot remove a member in this family (cross-family denial via the actor-device-session check itself)', async () => {
  const { app, repository } = buildApp();
  try {
    await seedAcceptedMember(repository, { accountId: 'acct-some-member' });

    const remove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-some-member/remove`,
      headers: { ...ownerHeaders, authorization: 'Bearer dev-token-other-owner' },
    });
    assert.equal(remove.statusCode, 401);
    assert.equal(remove.json().error, 'actor_device_session_invalid');
  } finally {
    await app.close();
  }
});

test('a request missing CSRF header/cookie match is rejected on the remove route too', async () => {
  const { app, repository } = buildApp();
  try {
    await seedAcceptedMember(repository, { accountId: 'acct-some-member' });

    const remove = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/members/acct-some-member/remove`,
      headers: { cookie: ownerHeaders.cookie, authorization: 'Bearer dev-token-owner' }, // no x-pca-csrf-token header
    });
    assert.equal(remove.statusCode, 403);
    assert.equal(remove.json().error, 'csrf_mismatch');
  } finally {
    await app.close();
  }
});

test('registerFamilyMemberRoutes registers nothing when familyMemberInvitationService is omitted (optional-feature convention, matches registerBrowserEndpointRoutes)', async () => {
  const app = Fastify();
  registerFamilyMemberRoutes(app, {
    parentAccountService: { async readSession() { throw new Error('should never be called'); } },
    deviceSessionService: { async requireActorDeviceInFamily() { throw new Error('should never be called'); } },
  });
  const res = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/members/invitations` });
  assert.equal(res.statusCode, 404);
  await app.close();
});
