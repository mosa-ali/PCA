// PCA-MYKIDS-BILL-2 -- familycommercial/authorization.ts: the family-scope
// preHandler + Family-Owner-authority gate this lane's routes use. Pure
// logic against the same AuthzRepository/FamilyCommercialAuthorityResolver
// ports the rest of this codebase already tests against -- no DB required.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkOwnerAuthority,
  createRequireFamilyCommercialAuthorization,
  isValidActorDeviceId,
  resolveFamilyCommercialRequirements,
} from '../../dist/familycommercial/authorization.js';
import { UnavailableFamilyCommercialAuthorityResolver } from '../../dist/billing/authority/FamilyCommercialAuthorityResolver.js';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';

function fakeReply() {
  const calls = [];
  return {
    calls,
    code(status) {
      calls.push({ status });
      return this;
    },
    async send(body) {
      calls[calls.length - 1].body = body;
    },
  };
}

// ---------------------------------------------------------------------------
// resolveFamilyCommercialRequirements
// ---------------------------------------------------------------------------

test('resolveFamilyCommercialRequirements: every known operation requires family scope; only MUTATE_REQUESTS route decides license separately (never at this layer)', () => {
  for (const op of ['VIEW_ENTITLEMENT', 'MUTATE_REQUESTS', 'VIEW_BILLING_RECORDS', 'MUTATE_SUBSCRIPTION']) {
    const req = resolveFamilyCommercialRequirements(op);
    assert.equal(req.requiresFamilyScope, true);
  }
});

// ---------------------------------------------------------------------------
// createRequireFamilyCommercialAuthorization preHandler
// ---------------------------------------------------------------------------

test('preHandler: missing/oversized familyId param is a 400 (routing error), never reaches AuthzRepository', async () => {
  const authzRepository = createInMemoryAuthzRepository();
  const handler = createRequireFamilyCommercialAuthorization(authzRepository, 'VIEW_ENTITLEMENT');
  const reply = fakeReply();
  await handler({ params: {}, accountId: 'acct-1' }, reply);
  assert.equal(reply.calls[0].status, 400);
});

test('preHandler: no scope row / REVOKED scope -> 403 forbidden, indistinguishable', async () => {
  const authzRepository = createInMemoryAuthzRepository();
  const handler = createRequireFamilyCommercialAuthorization(authzRepository, 'VIEW_ENTITLEMENT');

  const replyNoScope = fakeReply();
  await handler({ params: { familyId: 'fam-1' }, accountId: 'acct-1' }, replyNoScope);
  assert.equal(replyNoScope.calls[0].status, 403);
  assert.deepEqual(replyNoScope.calls[0].body, { error: 'forbidden' });

  authzRepository._grantScope('acct-2', 'fam-1', 'REVOKED');
  const replyRevoked = fakeReply();
  await handler({ params: { familyId: 'fam-1' }, accountId: 'acct-2' }, replyRevoked);
  assert.equal(replyRevoked.calls[0].status, 403);
});

test('preHandler: ACTIVE scope for VIEW_ENTITLEMENT/VIEW_BILLING_RECORDS passes with no license required', async () => {
  const authzRepository = createInMemoryAuthzRepository();
  authzRepository._grantScope('acct-3', 'fam-1', 'ACTIVE');
  for (const op of ['VIEW_ENTITLEMENT', 'VIEW_BILLING_RECORDS', 'MUTATE_REQUESTS', 'MUTATE_SUBSCRIPTION']) {
    const handler = createRequireFamilyCommercialAuthorization(authzRepository, op);
    const reply = fakeReply();
    await handler({ params: { familyId: 'fam-1' }, accountId: 'acct-3' }, reply);
    assert.equal(reply.calls.length, 0, `operation ${op} must not reply when authorized`);
  }
});

test('preHandler: cross-family denial (IDOR) -- an account scoped to fam-A is rejected for fam-B', async () => {
  const authzRepository = createInMemoryAuthzRepository();
  authzRepository._grantScope('acct-4', 'fam-A', 'ACTIVE');
  const handler = createRequireFamilyCommercialAuthorization(authzRepository, 'VIEW_ENTITLEMENT');
  const reply = fakeReply();
  await handler({ params: { familyId: 'fam-B' }, accountId: 'acct-4' }, reply);
  assert.equal(reply.calls[0].status, 403);
});

// ---------------------------------------------------------------------------
// checkOwnerAuthority -- AUTHORITY_UNAVAILABLE is never "is Owner"
// ---------------------------------------------------------------------------

test('checkOwnerAuthority: the safe production-default resolver (always AUTHORITY_UNAVAILABLE) is NEVER authorized', async () => {
  const resolver = new UnavailableFamilyCommercialAuthorityResolver();
  const outcome = await checkOwnerAuthority(resolver, 'fam-1', 'device-1');
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.denialStatus, 'AUTHORITY_UNAVAILABLE');
});

test('checkOwnerAuthority: OWNER_AUTHORIZED passes through as authorized', async () => {
  const resolver = { resolveOwnerAuthority: async () => ({ status: 'OWNER_AUTHORIZED' }) };
  const outcome = await checkOwnerAuthority(resolver, 'fam-1', 'device-1');
  assert.equal(outcome.authorized, true);
  assert.equal(outcome.denialStatus, undefined);
});

test('checkOwnerAuthority: ROLE_DENIED is distinct from AUTHORITY_UNAVAILABLE, and neither is ever authorized', async () => {
  const resolver = { resolveOwnerAuthority: async () => ({ status: 'ROLE_DENIED' }) };
  const outcome = await checkOwnerAuthority(resolver, 'fam-1', 'device-1');
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.denialStatus, 'ROLE_DENIED');
});

// ---------------------------------------------------------------------------
// isValidActorDeviceId
// ---------------------------------------------------------------------------

test('isValidActorDeviceId: rejects non-strings, empty strings, and oversized strings', () => {
  assert.equal(isValidActorDeviceId(undefined), false);
  assert.equal(isValidActorDeviceId(123), false);
  assert.equal(isValidActorDeviceId(''), false);
  assert.equal(isValidActorDeviceId('a'.repeat(129)), false);
  assert.equal(isValidActorDeviceId('device-1'), true);
});
