import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StaticChildProfileMembershipResolver,
  UnavailableChildProfileMembershipResolver,
} from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { RegistryBackedChildProfileMembershipResolver } from '../../dist/childprofiles/RegistryBackedChildProfileMembershipResolver.js';

test('UnavailableChildProfileMembershipResolver always reports UNAVAILABLE, never a permissive default', async () => {
  const resolver = new UnavailableChildProfileMembershipResolver();
  assert.deepEqual(await resolver.resolveMembership('fam-1', 'child-1'), { status: 'UNAVAILABLE' });
  assert.deepEqual(await resolver.resolveMembership('fam-2', 'anything'), { status: 'UNAVAILABLE' });
});

test('StaticChildProfileMembershipResolver: MEMBER_OF_FAMILY when the profile is mapped to the queried family', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(await resolver.resolveMembership('fam-1', 'child-1'), { status: 'MEMBER_OF_FAMILY' });
});

test('StaticChildProfileMembershipResolver: NOT_MEMBER when the profile is not a member of the queried family', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(await resolver.resolveMembership('fam-OTHER', 'child-1'), { status: 'NOT_MEMBER' });
});

test('StaticChildProfileMembershipResolver: NOT_FOUND for an unknown profile id', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(await resolver.resolveMembership('fam-1', 'child-unknown'), { status: 'NOT_FOUND' });
});

test('StaticChildProfileMembershipResolver: NOT_FOUND for a malformed (empty) profile id, never a crash or ALLOW-shaped result', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(await resolver.resolveMembership('fam-1', ''), { status: 'NOT_FOUND' });
});

test('StaticChildProfileMembershipResolver: NOT_FOUND for an oversized profile id', async () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  const oversized = 'x'.repeat(200);
  assert.deepEqual(await resolver.resolveMembership('fam-1', oversized), { status: 'NOT_FOUND' });
});

test('registry adapter maps MEMBER and collapses cross-family/unknown outcomes without returning child content', async () => {
  const calls = [];
  const resolver = new RegistryBackedChildProfileMembershipResolver({
    registry: {
      async resolveMembership(familyId, childProfileId) {
        calls.push([familyId, childProfileId]);
        return childProfileId === 'child-member' ? 'MEMBER' : 'NOT_MEMBER_OR_NOT_FOUND';
      },
    },
  });

  assert.deepEqual(await resolver.resolveMembership('fam-1', 'child-member'), { status: 'MEMBER_OF_FAMILY' });
  const crossFamily = await resolver.resolveMembership('fam-1', 'child-other');
  const unknown = await resolver.resolveMembership('fam-1', 'child-unknown');
  assert.deepEqual(crossFamily, { status: 'NOT_MEMBER' });
  assert.deepEqual(unknown, crossFamily);
  assert.deepEqual(calls, [['fam-1', 'child-member'], ['fam-1', 'child-other'], ['fam-1', 'child-unknown']]);
  assert.deepEqual(Object.keys(unknown), ['status']);
});

test('registry adapter maps malformed ids to NOT_FOUND without querying the registry and source errors to UNAVAILABLE', async () => {
  let calls = 0;
  const resolver = new RegistryBackedChildProfileMembershipResolver({
    registry: {
      async resolveMembership() {
        calls += 1;
        throw new Error('private backing-store detail');
      },
    },
  });

  assert.deepEqual(await resolver.resolveMembership('fam-1', ''), { status: 'NOT_FOUND' });
  assert.equal(calls, 0);
  assert.deepEqual(await resolver.resolveMembership('fam-1', 'child-1'), { status: 'UNAVAILABLE' });
  assert.equal(calls, 1);
});
