import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthzService, AuthzError } from '../../dist/authz/AuthzService.js';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function buildService() {
  const repository = createInMemoryAuthzRepository();
  let currentTime = BASE_TIME;
  const clock = { now: () => new Date(currentTime), advance: (ms) => { currentTime += ms; } };
  const service = new AuthzService(repository, clock.now);
  return { service, repository, clock };
}

function account() {
  return `account-${randomUUID()}`;
}
function family() {
  return `family-${randomUUID()}`;
}

test('correct account with an ACTIVE scope succeeds for a scope-only operation', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId }));
});

test('wrong account (no scope granted) fails with the generic error', async () => {
  const { service } = buildService();
  const error = await service
    .authorize({ accountId: account(), operation: 'VIEW_INVITATION_STATUS', familyId: family() })
    .catch((e) => e);
  assert.ok(error instanceof AuthzError);
  assert.equal(error.code, 'FORBIDDEN');
});

test('wrong family (account has scope for a DIFFERENT family) fails identically to no scope at all', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  repository._grantScope(accountId, family()); // scope for family A
  const wrongFamilyError = await service
    .authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId: family() }) // family B
    .catch((e) => e);
  const noScopeError = await service
    .authorize({ accountId: account(), operation: 'VIEW_INVITATION_STATUS', familyId: family() })
    .catch((e) => e);
  assert.equal(wrongFamilyError.code, noScopeError.code);
  assert.equal(wrongFamilyError.message, noScopeError.message);
});

test('a REVOKED scope fails identically to no scope at all', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId, 'REVOKED');
  const revokedError = await service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId }).catch((e) => e);
  const noScopeError = await service
    .authorize({ accountId: account(), operation: 'VIEW_INVITATION_STATUS', familyId: family() })
    .catch((e) => e);
  assert.equal(revokedError.message, noScopeError.message);
});

// INITIATE_CHECKOUT (the premium/commercial device-limit-increase path), not
// CREATE_INVITATION, is this suite's example of a license-requiring
// operation: the owner decision recorded in
// docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part M made basic/free V1
// device enrollment (CREATE_INVITATION) license-free -- see
// 'CREATE_INVITATION succeeds with a valid family scope and no license row
// at all' below for that operation's own, now-passing coverage.
test('an operation requiring a license fails without one, even with a valid family scope', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  const error = await service.authorize({ accountId, operation: 'INITIATE_CHECKOUT', familyId }).catch((e) => e);
  assert.equal(error.code, 'FORBIDDEN');
});

test('an operation requiring a license succeeds once both scope and an active license exist', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  repository._addLicense(accountId, 'ACTIVE');
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'INITIATE_CHECKOUT', familyId }));
});

test('an EXPIRED license does not satisfy the license requirement', async () => {
  const { service, repository, clock } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  repository._addLicense(accountId, 'ACTIVE', new Date(BASE_TIME + 1000));
  clock.advance(1001);
  const error = await service.authorize({ accountId, operation: 'INITIATE_CHECKOUT', familyId }).catch((e) => e);
  assert.equal(error.code, 'FORBIDDEN');
});

test('a SUSPENDED license does not satisfy the license requirement', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  repository._addLicense(accountId, 'SUSPENDED');
  const error = await service.authorize({ accountId, operation: 'INITIATE_CHECKOUT', familyId }).catch((e) => e);
  assert.equal(error.code, 'FORBIDDEN');
});

// PPR-2 owner decision (Part M): CREATE_INVITATION -- basic/free V1 device
// enrollment -- must succeed on family scope alone, with NO license row at
// all. This is the operation's own dedicated coverage, not a repurposed
// license-requirement test.
test('CREATE_INVITATION succeeds with a valid family scope and no license row at all', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'CREATE_INVITATION', familyId }));
});

test('an operation with no family-scope requirement succeeds without any scope row', async () => {
  const { service } = buildService();
  await assert.doesNotReject(() => service.authorize({ accountId: account(), operation: 'RELEASE_METADATA_LOOKUP' }));
});

test('a scope-required operation called without a familyId is rejected, not silently permitted', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  repository._grantScope(accountId, family());
  const error = await service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS' }).catch((e) => e);
  assert.equal(error.code, 'FORBIDDEN');
});

test('IDOR: a scope granted for family A cannot be used to authorize an operation on family B, even for the same account', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyA = family();
  const familyB = family();
  repository._grantScope(accountId, familyA);
  await assert.doesNotReject(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId: familyA }));
  await assert.rejects(() => service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId: familyB }));
});

test('mass assignment: an authorization context with extra, unrecognized fields is not treated specially', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  const forged = { accountId, operation: 'VIEW_INVITATION_STATUS', familyId, role: 'OWNER', isAdmin: true };
  await assert.doesNotReject(() => service.authorize(forged));
  // The forged fields have no code path that reads them -- authorize() only ever
  // consults accountId/operation/familyId, proven structurally by AuthzService.ts.
});

test('a service session/authz check can never resolve to a family role -- authorize() returns no value at all on success', async () => {
  const { service, repository } = buildService();
  const accountId = account();
  const familyId = family();
  repository._grantScope(accountId, familyId);
  const result = await service.authorize({ accountId, operation: 'VIEW_INVITATION_STATUS', familyId });
  assert.equal(result, undefined);
});

test('an operation resembling policy authorization does not exist on ServiceOperation -- structurally impossible to authorize', async () => {
  const { service } = buildService();
  // 'POLICY_UPDATE' is not a valid ServiceOperation; resolveRequirements throws for anything outside the closed matrix.
  await assert.rejects(() => service.authorize({ accountId: account(), operation: 'POLICY_UPDATE', familyId: family() }));
});
