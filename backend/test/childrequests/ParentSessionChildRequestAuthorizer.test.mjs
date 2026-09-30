import assert from 'node:assert/strict';
import test from 'node:test';
import { createParentSessionChildRequestAuthorizer } from '../../dist/childrequests/ParentSessionChildRequestAuthorizer.js';

const FAMILY = '00000000-0000-4000-8000-000000000001';
const CHILD = '00000000-0000-4000-8000-000000000002';
const baseInput = {
  parentAccountId: '00000000-0000-4000-8000-000000000003',
  familyId: FAMILY,
  requestType: 'BONUS_TIME',
  operation: 'GRANT_BONUS_TIME',
  targetScope: { kind: 'CHILD_PROFILE', id: CHILD },
  action: 'DIRECT_GRANT',
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
};

function buildAuthorizer({ role = 'ADMINISTRATOR', membership = { status: 'MEMBER_OF_FAMILY' }, roleError, membershipError } = {}) {
  const calls = { role: 0, membership: 0 };
  const authorizer = createParentSessionChildRequestAuthorizer({
    parentAccountService: {
      async activeFamilyRole() {
        calls.role += 1;
        if (roleError) throw roleError;
        return role;
      },
    },
    childProfileMembershipResolver: {
      async resolveMembership() {
        calls.membership += 1;
        if (membershipError) throw membershipError;
        return membership;
      },
    },
  });
  return { authorizer, calls };
}

test('Parent session child-profile action allows only an active Administrator and resolved family member', async () => {
  const { authorizer, calls } = buildAuthorizer();
  assert.deepEqual(await authorizer.authorize(baseInput), { verdict: 'ALLOW' });
  assert.deepEqual(calls, { role: 1, membership: 1 });
});

test('non-member, missing, and unavailable membership outcomes all deny', async () => {
  for (const membership of [{ status: 'NOT_MEMBER' }, { status: 'NOT_FOUND' }, { status: 'UNAVAILABLE' }]) {
    const { authorizer } = buildAuthorizer({ membership });
    assert.deepEqual(await authorizer.authorize(baseInput), { verdict: 'DENY' });
  }
  const { authorizer } = buildAuthorizer({ membershipError: new Error('registry unavailable') });
  assert.deepEqual(await authorizer.authorize(baseInput), { verdict: 'DENY' });
});

test('non-Administrator role denies before membership lookup', async () => {
  const { authorizer, calls } = buildAuthorizer({ role: 'VIEWER' });
  assert.deepEqual(await authorizer.authorize(baseInput), { verdict: 'DENY' });
  assert.deepEqual(calls, { role: 1, membership: 0 });
});

test('family target must match the session family; unsupported target kinds deny', async () => {
  const { authorizer } = buildAuthorizer();
  assert.deepEqual(await authorizer.authorize({ ...baseInput, targetScope: { kind: 'FAMILY', id: FAMILY } }), { verdict: 'ALLOW' });
  assert.deepEqual(await authorizer.authorize({ ...baseInput, targetScope: { kind: 'FAMILY', id: CHILD } }), { verdict: 'DENY' });
  assert.deepEqual(await authorizer.authorize({ ...baseInput, targetScope: { kind: 'DEVICE', id: CHILD } }), { verdict: 'DENY' });
});
