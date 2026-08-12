import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StaticChildProfileMembershipResolver,
  UnavailableChildProfileMembershipResolver,
} from '../../dist/childprofiles/ChildProfileMembershipResolver.js';

test('UnavailableChildProfileMembershipResolver always reports UNAVAILABLE, never a permissive default', () => {
  const resolver = new UnavailableChildProfileMembershipResolver();
  assert.deepEqual(resolver.resolveMembership('fam-1', 'child-1'), { status: 'UNAVAILABLE' });
  assert.deepEqual(resolver.resolveMembership('fam-2', 'anything'), { status: 'UNAVAILABLE' });
});

test('StaticChildProfileMembershipResolver: MEMBER_OF_FAMILY when the profile is mapped to the queried family', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(resolver.resolveMembership('fam-1', 'child-1'), { status: 'MEMBER_OF_FAMILY' });
});

test('StaticChildProfileMembershipResolver: NOT_MEMBER when the profile belongs to a DIFFERENT family', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(resolver.resolveMembership('fam-OTHER', 'child-1'), { status: 'NOT_MEMBER' });
});

test('StaticChildProfileMembershipResolver: NOT_FOUND for an unknown profile id', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(resolver.resolveMembership('fam-1', 'child-unknown'), { status: 'NOT_FOUND' });
});

test('StaticChildProfileMembershipResolver: NOT_FOUND for a malformed (empty) profile id, never a crash or ALLOW-shaped result', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  assert.deepEqual(resolver.resolveMembership('fam-1', ''), { status: 'NOT_FOUND' });
});

test('StaticChildProfileMembershipResolver: NOT_FOUND for an oversized profile id', () => {
  const resolver = new StaticChildProfileMembershipResolver(new Map([['child-1', 'fam-1']]));
  const oversized = 'x'.repeat(200);
  assert.deepEqual(resolver.resolveMembership('fam-1', oversized), { status: 'NOT_FOUND' });
});
