import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerEyeProtectionRoutes } from '../../dist/http/routes/eyeProtectionRoutes.js';
import { EyeProtectionSettingsService } from '../../dist/eyeprotection/EyeProtectionSettingsService.js';
import { InMemoryEyeProtectionSettingsRepository } from '../../dist/eyeprotection/EyeProtectionSettingsRepository.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';

const FAMILY = 'family-eye-protection-http-1';
const OTHER_FAMILY = 'family-eye-protection-other-1';
const CHILD_PROFILE_FAMILY_MAP = new Map([
  ['child-1', FAMILY],
  ['child-in-other-family', OTHER_FAMILY],
]);
const T0 = new Date('2026-01-07T09:00:00.000Z');

function buildService({ nowFn = () => T0, roleResolver } = {}) {
  const childProfileResolver = new StaticChildProfileMembershipResolver(CHILD_PROFILE_FAMILY_MAP);
  const authorization = new ParentActionAuthorizationService(
    roleResolver,
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    nowFn,
    childProfileResolver,
  );
  const repository = new InMemoryEyeProtectionSettingsRepository();
  const service = new EyeProtectionSettingsService(repository, authorization, nowFn);
  return { service, repository };
}

function trustedRoleResolver() {
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
  return new FamilyTrustSetRoleResolver(store);
}

function buildApp({ service, configured = true } = {}) {
  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: FAMILY }]]);
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
  ]);
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, expectedFamilyId) {
      const identity = deviceTokens.get(token);
      if (!identity || identity.familyId !== expectedFamilyId) {
        const err = new Error('unauthorized');
        err.name = 'RuntimeSyncAuthError';
        throw err;
      }
      return identity;
    },
  };

  const app = Fastify();
  registerEyeProtectionRoutes(app, {
    parentAccountService,
    deviceSessionService,
    eyeProtectionSettingsService: configured ? service : undefined,
    now: () => T0,
  });
  return { app };
}

const parentAuthHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

test('GET returns a safe all-disabled default for a child with no row yet', async () => {
  const { service } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: parentAuthHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().eyeProtection.remindersEnabled, false);
  } finally {
    await app.close();
  }
});

test('an Owner can enable eye-protection reminders: authorized and durably written', async () => {
  const { service, repository } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.eyeProtection.remindersEnabled, true);
    assert.equal(body.eyeProtection.childProfileId, 'child-1');

    const stored = await repository.get(FAMILY, 'child-1');
    assert.equal(stored.remindersEnabled, true);
  } finally {
    await app.close();
  }
});

test('a VIEWER cannot edit the eye-protection setting: DENY from the real OPERATION_MATRIX, no write', async () => {
  const { service, repository } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 403);
    const stored = await repository.get(FAMILY, 'child-1');
    assert.equal(stored.remindersEnabled, false);
  } finally {
    await app.close();
  }
});

test('cross-family target denial: a childProfileId belonging to another family is rejected, never distinguished from unknown', async () => {
  const { service } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-in-other-family/eye-protection`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('while UnavailableTrustSetRoleResolver is wired (production default), every update fails closed honestly', async () => {
  const { service } = buildService({ roleResolver: new UnavailableTrustSetRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('missing CSRF header is rejected before any authorization or write', async () => {
  const { service, repository } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: { cookie: parentAuthHeaders.cookie, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 403);
    const stored = await repository.get(FAMILY, 'child-1');
    assert.equal(stored.remindersEnabled, false);
  } finally {
    await app.close();
  }
});

test('missing actor-device-session bearer token is rejected with 401, never treated as an implicit family role', async () => {
  const { service } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: parentAuthHeaders,
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('the route fails closed with 503 when not configured, rather than a silent allow', async () => {
  const { service } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service, configured: false });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 503);
  } finally {
    await app.close();
  }
});

test('a malformed body (non-boolean remindersEnabled) is rejected with 400 before authorization runs', async () => {
  const { service } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
      headers: { ...parentAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: 'yes' },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('an unauthenticated request (no session cookie) is rejected with 401', async () => {
  const { service } = buildService({ roleResolver: trustedRoleResolver() });
  const { app } = buildApp({ service });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/children/child-1/eye-protection`,
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
