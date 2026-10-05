import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerInvitationRoutes } from '../../dist/http/routes/invitationRoutes.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { AuthError } from '../../dist/auth/AuthService.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { createInMemoryAuthzRepository } from '../support/inMemoryAuthzRepository.mjs';

const FAMILY = 'family-device-invite-authz';
const OTHER_FAMILY = 'family-device-invite-authz-other';
const NOW = new Date('2026-09-26T00:00:00.000Z');

function invitationRecord(familyId = FAMILY, overrides = {}) {
  return {
    invitationId: 'invitation-1',
    familyId,
    tokenHash: 'hash-only-never-returned',
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
    childProfileId: 'child-profile-1',
    ageUxTier: 'YOUNG_CHILD',
    initialPolicyProfile: 'BALANCED',
    status: 'CREATED',
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    openedAt: null,
    installRequiredAt: null,
    appInstalledAt: null,
    authorizationRequiredAt: null,
    redeemedAt: null,
    expiredAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function buildApp({ androidEnrollmentReady = true } = {}) {
  const scopes = createInMemoryAuthzRepository();
  scopes._grantScope('svc-admin', FAMILY, 'ACTIVE');
  scopes._grantScope('svc-viewer', FAMILY, 'ACTIVE');
  scopes._grantScope('svc-child', FAMILY, 'ACTIVE');
  scopes._grantScope('svc-no-membership', FAMILY, 'ACTIVE');
  scopes._grantScope('svc-suspended-scope', FAMILY, 'REVOKED');
  scopes._grantScope('svc-other-family', OTHER_FAMILY, 'ACTIVE');
  const authzService = new AuthzService(scopes);

  const activeRoles = new Map([
    [`${FAMILY}:svc-admin`, 'ADMINISTRATOR'],
    [`${FAMILY}:svc-viewer`, 'VIEWER'],
    [`${FAMILY}:svc-child`, 'CHILD'],
    [`${FAMILY}:svc-suspended-scope`, 'ADMINISTRATOR'],
    [`${OTHER_FAMILY}:svc-other-family`, 'ADMINISTRATOR'],
  ]);
  const familyMembershipRepository = {
    async findActiveRoleByServiceAccountId(serviceAccountId, familyId) {
      return activeRoles.get(`${familyId}:${serviceAccountId}`) ?? null;
    },
  };

  const tokens = new Map([
    ['admin-token', 'svc-admin'],
    ['viewer-token', 'svc-viewer'],
    ['child-token', 'svc-child'],
    ['no-membership-token', 'svc-no-membership'],
    ['suspended-scope-token', 'svc-suspended-scope'],
    ['other-family-token', 'svc-other-family'],
  ]);
  const authService = {
    async validateSession(token) {
      const serviceAccountId = tokens.get(token);
      if (!serviceAccountId) throw new AuthError('UNAUTHORIZED');
      return serviceAccountId;
    },
  };

  const calls = [];
  const stepUpCalls = [];
  const record = invitationRecord();
  const invitationService = {
    async createInvitation(input) {
      calls.push({ operation: 'create', input });
      return { record, rawToken: 'one-time-enrollment-token' };
    },
    async getInvitationForFamily() {
      calls.push({ operation: 'get' });
      return record;
    },
    async listInvitationsForFamily() {
      calls.push({ operation: 'list' });
      return [record];
    },
    async revokeInvitationForFamily(_familyId, _invitationId) {
      calls.push({ operation: 'revoke' });
      return invitationRecord(FAMILY, { status: 'REVOKED', revokedAt: NOW });
    },
  };

  const rateLimiter = createRateLimiter();
  const authAttemptLimiter = rateLimiter({ windowMs: 60_000, max: 1000, bucket: 'invite-auth-attempt-test' });
  const app = Fastify();
  registerInvitationRoutes(app, {
    invitationService,
    authService,
    parentAccountService: { async consumeSensitiveStepUp(_accountId, _familyId, operation, token) {
      stepUpCalls.push({ operation, token });
      return (operation === 'family.device.enrollment.revoke' && token === 'single-use-test-grant') ||
        (operation === 'family.device.enrollment.create' && token === 'single-use-create-grant');
    } },
    androidEnrollmentReady,
    authzService,
    familyMembershipRepository,
    rateLimiter,
    authAttemptLimiter,
  });
  return { app, calls, stepUpCalls };
}

const auth = (token) => ({ authorization: `Bearer ${token}` });
const createBody = {
  platform: 'ANDROID',
  requestedProtectionMode: 'ANDROID_STANDARD',
  childProfileId: 'child-profile-1',
  ageUxTier: 'YOUNG_CHILD',
  initialPolicyProfile: 'BALANCED',
  stepUpToken: 'single-use-create-grant',
};

test('active same-family Administrator can create a child-device invitation without Parent browser authority', async () => {
  const { app, calls } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations`,
      headers: auth('admin-token'),
      payload: createBody,
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().rawInvitationToken, 'one-time-enrollment-token');
    assert.deepEqual(calls.map((call) => call.operation), ['create']);
  } finally {
    await app.close();
  }
});

test('Android enrollment readiness gate rejects before consuming step-up or creating an invitation', async () => {
  const { app, calls, stepUpCalls } = buildApp({ androidEnrollmentReady: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations`,
      headers: auth('admin-token'),
      payload: createBody,
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: 'service_unavailable',
      code: 'PLATFORM_ENROLLMENT_UNAVAILABLE',
    });
    assert.equal(stepUpCalls.length, 0);
    assert.deepEqual(calls, []);
  } finally {
    await app.close();
  }
});

test('device invitation creation requires its own fresh action-bound step-up grant', async () => {
  const { app, calls } = buildApp();
  try {
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations`,
      headers: auth('admin-token'),
      payload: { ...createBody, stepUpToken: 'single-use-test-grant' },
    });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(denied.json(), { error: 'forbidden' });
    assert.equal(calls.length, 0);

    const allowed = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations`,
      headers: auth('admin-token'),
      payload: createBody,
    });
    assert.equal(allowed.statusCode, 201);
    assert.equal(calls.length, 1);
  } finally {
    await app.close();
  }
});

for (const [token, label] of [
  ['viewer-token', 'Viewer'],
  ['child-token', 'Child'],
  ['no-membership-token', 'Parent without active membership'],
]) {
  test(`${label} cannot create child-device invitations`, async () => {
    const { app, calls } = buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/families/${FAMILY}/invitations`,
        headers: auth(token),
        payload: createBody,
      });
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), { error: 'forbidden' });
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });
}

test('revoked family scope cannot create invitations even when active-role lookup says Administrator', async () => {
  const { app, calls } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations`,
      headers: auth('suspended-scope-token'),
      payload: createBody,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
  }
});

test('cross-family Admin cannot create an invitation in another family', async () => {
  const { app, calls } = buildApp();
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations`,
      headers: auth('other-family-token'),
      payload: createBody,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
  }
});

test('active Viewer can read invitations but cannot revoke them', async () => {
  const { app, calls } = buildApp();
  try {
    const list = await app.inject({ method: 'GET', url: `/v1/families/${FAMILY}/invitations`, headers: auth('viewer-token') });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().length, 1);

    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/families/${FAMILY}/invitations/invitation-1/revoke`,
      headers: auth('viewer-token'),
      payload: { stepUpToken: 'single-use-test-grant' },
    });
    assert.equal(revoke.statusCode, 403);
    assert.equal(calls.some((call) => call.operation === 'revoke'), false);
  } finally {
    await app.close();
  }
});

test('active same-family Administrator must present the exact sensitive step-up grant to revoke an invitation', async () => {
  const { app, calls } = buildApp();
  try {
    const denied = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/invitations/invitation-1/revoke`,
      headers: auth('admin-token'), payload: { stepUpToken: 'wrong-grant' },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(calls.some((call) => call.operation === 'revoke'), false);

    const allowed = await app.inject({
      method: 'POST', url: `/v1/families/${FAMILY}/invitations/invitation-1/revoke`,
      headers: auth('admin-token'), payload: { stepUpToken: 'single-use-test-grant' },
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().status, 'REVOKED');
    assert.equal(calls.filter((call) => call.operation === 'revoke').length, 1);
  } finally {
    await app.close();
  }
});

test('unauthenticated request is denied before invitation creation', async () => {
  const { app, calls } = buildApp();
  try {
    const response = await app.inject({ method: 'POST', url: `/v1/families/${FAMILY}/invitations`, payload: createBody });
    assert.equal(response.statusCode, 401);
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
  }
});
