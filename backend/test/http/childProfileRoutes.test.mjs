import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerChildProfileRoutes } from '../../dist/http/routes/childProfileRoutes.js';
import { ChildProfileService } from '../../dist/childprofiles/ChildProfileService.js';
import { InMemoryChildProfileRegistryRepository } from '../../dist/childprofiles/ChildProfileRegistryRepository.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';
import { AuthError } from '../../dist/auth/AuthService.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';

const FAMILY = 'family-child-profile-http-1';
const OTHER_FAMILY = 'family-child-profile-http-other';
const T0 = new Date('2026-01-07T09:00:00.000Z');

function buildApp({ mintId } = {}) {
  const repository = new InMemoryChildProfileRegistryRepository(mintId);
  const childProfileService = new ChildProfileService(repository, () => T0);

  const authzRepository = createInMemoryAuthzRepository();
  authzRepository._grantScope('acct-owner', FAMILY, 'ACTIVE');
  authzRepository._grantScope('acct-owner-other', OTHER_FAMILY, 'ACTIVE');
  const authzService = new AuthzService(authzRepository);

  // Minimal fake AuthService -- Bearer-token transport only, so the test
  // harness need not construct CSRF cookies. Two valid tokens: one scoped
  // to FAMILY, one scoped to OTHER_FAMILY, plus a Platform Admin token
  // that resolves to an account with NO family scope at all (mirrors how
  // a real platform-admin bearer token can never carry a family scope --
  // see requireFamilyAuthorization.ts's own doc comment).
  const sessions = new Map([
    ['token-owner', 'acct-owner'],
    ['token-owner-other-family', 'acct-owner-other'],
    ['token-platform-admin', 'acct-platform-admin-no-family-scope'],
  ]);
  const authService = {
    async validateSession(token) {
      const accountId = sessions.get(token);
      if (!accountId) throw new AuthError('UNAUTHORIZED');
      return accountId;
    },
  };

  const rateLimiter = createRateLimiter();
  const authAttemptLimiter = rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'auth-attempt-test' });

  const app = Fastify();
  registerChildProfileRoutes(app, { childProfileService, authService, authzService, rateLimiter, authAttemptLimiter });
  return { app, repository };
}

function authed(token) {
  return { authorization: `Bearer ${token}` };
}

test('POST creates an opaque child profile and returns only childProfileId + createdAt', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner'),
    payload: {},
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(typeof body.childProfileId, 'string');
  assert.equal(body.createdAt, T0.toISOString());
  assert.deepEqual(Object.keys(body).sort(), ['childProfileId', 'createdAt']);
});

test('POST rejects a displayName field outright -- never silently drops it', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner'),
    payload: { displayName: 'Ahmed' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'READABLE_CHILD_FIELD_NOT_ALLOWED');
});

for (const field of ['childName', 'nickname', 'firstName', 'lastName', 'dob', 'dateOfBirth', 'school', 'gender', 'avatar']) {
  test(`POST rejects the readable field "${field}" the same way`, async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/children`,
      headers: authed('token-owner'),
      payload: { [field]: 'x' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'READABLE_CHILD_FIELD_NOT_ALLOWED');
  });
}

test('POST without a session is denied', async () => {
  const { app } = buildApp();
  const res = await app.inject({ method: 'POST', url: `/v1/families/${FAMILY}/children`, payload: {} });
  assert.equal(res.statusCode, 401);
});

test('POST from an account with no scope on this family is denied, generically', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner-other-family'),
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'forbidden' });
});

test('a Platform Admin bearer token cannot authorize this route -- no family scope exists for it', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-platform-admin'),
    payload: {},
  });
  assert.equal(res.statusCode, 403);
});

test('LIST returns only the authorized family\'s own opaque entries, never another family\'s', async () => {
  const { app } = buildApp();
  await app.inject({ method: 'POST', url: `/v1/families/${FAMILY}/children`, headers: authed('token-owner'), payload: {} });
  await app.inject({
    method: 'POST',
    url: `/v1/families/${OTHER_FAMILY}/children`,
    headers: authed('token-owner-other-family'),
    payload: {},
  });

  const res = await app.inject({ method: 'GET', url: `/v1/families/${FAMILY}/children`, headers: authed('token-owner') });
  assert.equal(res.statusCode, 200);
  const { items } = res.json();
  assert.equal(items.length, 1);

  // The account scoped to FAMILY can never even ASK for OTHER_FAMILY's list --
  // authorization runs before any data access, so this is a 403, not a
  // 200 with someone else's rows and not a 200 with an empty array either
  // (an empty-vs-forbidden distinction would itself be a family-existence
  // oracle).
  const crossFamily = await app.inject({
    method: 'GET',
    url: `/v1/families/${OTHER_FAMILY}/children`,
    headers: authed('token-owner'),
  });
  assert.equal(crossFamily.statusCode, 403);
});

test('an idempotency key replayed for the same family returns the SAME child, not a second one', async () => {
  const { app } = buildApp();
  const first = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner'),
    payload: { idempotencyKey: 'retry-key-1' },
  });
  const second = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner'),
    payload: { idempotencyKey: 'retry-key-1' },
  });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.json().childProfileId, second.json().childProfileId);

  const list = await app.inject({ method: 'GET', url: `/v1/families/${FAMILY}/children`, headers: authed('token-owner') });
  assert.equal(list.json().items.length, 1);
});

test('two DIFFERENT families reusing the identical idempotency key create two DIFFERENT children -- the key is scoped, not global', async () => {
  const { app } = buildApp();
  const a = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner'),
    payload: { idempotencyKey: 'shared-key' },
  });
  const b = await app.inject({
    method: 'POST',
    url: `/v1/families/${OTHER_FAMILY}/children`,
    headers: authed('token-owner-other-family'),
    payload: { idempotencyKey: 'shared-key' },
  });
  assert.equal(a.statusCode, 201);
  assert.equal(b.statusCode, 201);
  assert.notEqual(a.json().childProfileId, b.json().childProfileId);
});

test('a caller-supplied childProfileId in the body is rejected -- ids are exclusively server-minted', async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/children`,
    headers: authed('token-owner'),
    payload: { childProfileId: 'attacker-chosen-id' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'READABLE_CHILD_FIELD_NOT_ALLOWED');
});

test('repeated CREATE calls with no idempotency key each create a genuinely new child', async () => {
  const { app } = buildApp();
  await app.inject({ method: 'POST', url: `/v1/families/${FAMILY}/children`, headers: authed('token-owner'), payload: {} });
  await app.inject({ method: 'POST', url: `/v1/families/${FAMILY}/children`, headers: authed('token-owner'), payload: {} });
  const list = await app.inject({ method: 'GET', url: `/v1/families/${FAMILY}/children`, headers: authed('token-owner') });
  assert.equal(list.json().items.length, 2);
});
