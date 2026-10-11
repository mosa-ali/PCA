import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { SafeZoneError } from '../../dist/location/SafeZoneRepository.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

const PREFERENCES_ROUTE = '/api/parent/preferences';
const SAFE_ZONES_ROUTE = '/api/parent/families/:familyId/safe-zones';
const SAFE_ZONE_DETAIL_ROUTE = '/api/parent/families/:familyId/safe-zones/:zoneId';

after(async () => {
  await writeParentRouteScenarioReport();
});

function buildApp(role = 'OWNER', authorizationVerdict = 'ALLOW', safeZoneRepositoryOverrides = {}, {
  withPreferenceRepository = true,
  withSafeZoneRepository = true,
  withDeviceSessionService = true,
  withSafeZonePolicyAuthorizer = true,
  withTrustSetRoleResolver = true,
  deviceDskKeyId = 'device-a-key',
  safeZonePolicyAuthorizerOverride,
  trustSetRoleResolverOverride,
  deviceChildBindingRepositoryOverride,
  childProfileRegistryRepositoryOverride,
  onActiveFamilyRole,
} = {}) {
  const sessions = new Map([
    ['session-a', { accountId: 'account-a', familyId: 'family-a', emailVerified: true }],
    ['session-b', { accountId: 'account-b', familyId: 'family-a', emailVerified: true }],
  ]);
  const preferences = new Map();
  const zones = new Map();
  const authorizationRequests = [];
  const childBindingCalls = [];
  let currentParentRole = role;
  let roleReadCount = 0;
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole(accountId, familyId) {
      if (familyId !== 'family-a') return null;
      const readIndex = roleReadCount++;
      const selectedRole = Array.isArray(currentParentRole)
        ? currentParentRole[Math.min(readIndex, currentParentRole.length - 1)]
        : currentParentRole;
      if (onActiveFamilyRole) await onActiveFamilyRole(readIndex, selectedRole);
      return selectedRole === 'OWNER' ? 'ADMINISTRATOR' : selectedRole;
    },
  };
  const parentPreferenceRepository = {
    async get(accountId) {
      return preferences.get(accountId) ?? { accountId, language: 'en', emailAlertsEnabled: true, pushRequestsEnabled: true, emailDestination: null, emailDestinationState: 'UNVERIFIED', updatedAtUtc: new Date(0).toISOString() };
    },
    async update(accountId, patch) {
      const next = { ...(await this.get(accountId)), ...patch, updatedAtUtc: new Date().toISOString() };
      preferences.set(accountId, next);
      return next;
    },
  };
  const safeZoneRepository = {
    async list(familyId) {
      return [...zones.values()].filter((zone) => zone.familyId === familyId);
    },
    async create(input) {
      const zone = { zoneId: 'zone-a', ...input, revision: 1, deliveryState: 'PENDING_OFFLINE', createdAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString() };
      zones.set(zone.zoneId, zone);
      return zone;
    },
    async update(familyId, zoneId, patch) {
      const zone = zones.get(zoneId);
      if (!zone || zone.familyId !== familyId) throw new SafeZoneError('NOT_FOUND');
      const next = { ...zone, ...patch, revision: zone.revision + 1, deliveryState: 'PENDING_OFFLINE' };
      zones.set(zoneId, next);
      return next;
    },
    async remove(familyId, zoneId) {
      const zone = zones.get(zoneId);
      if (!zone || zone.familyId !== familyId) return false;
      zones.delete(zoneId);
      return true;
    },
  };
  Object.assign(safeZoneRepository, safeZoneRepositoryOverrides);
  const deviceRepository = {
    async findDeviceForFamily(familyId, deviceId) {
      return familyId === 'family-a' && ['device-a', 'child-device'].includes(deviceId) ? { deviceId, familyId } : null;
    },
  };
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, familyId) {
      if (token !== 'devtoken-a' || familyId !== 'family-a') throw new Error('unauthorized');
      return { deviceId: 'device-a', familyId, dskKeyId: deviceDskKeyId };
    },
  };
  const defaultTrustSetRoleResolver = {
    resolveActor(familyId, deviceId, dskKeyId) {
      if (familyId !== 'family-a') {
        return 'DEVICE_NOT_ACTIVE';
      }
      if (dskKeyId !== undefined) {
        return deviceId === 'device-a' && dskKeyId === 'device-a-key'
          ? { deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 }
          : 'DEVICE_NOT_ACTIVE';
      }
      if (deviceId === 'child-device') return { deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      if (deviceId === 'device-a') return { deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 };
      return 'DEVICE_NOT_ACTIVE';
    },
  };
  const trustSetRoleResolver = trustSetRoleResolverOverride ?? defaultTrustSetRoleResolver;
  const deviceChildBindingRepository = deviceChildBindingRepositoryOverride ?? {
    async resolveBinding(familyId, deviceId) {
      childBindingCalls.push({ familyId, deviceId });
      return familyId === 'family-a' && deviceId === 'child-device'
        ? { outcome: 'BOUND', childProfileId: 'child-profile-a' }
        : { outcome: 'UNBOUND' };
    },
  };
  const childProfileRegistryRepository = childProfileRegistryRepositoryOverride === null
    ? undefined
    : childProfileRegistryRepositoryOverride ?? {
        async resolveMembership(familyId, childProfileId) {
          return familyId === 'family-a' && childProfileId === 'child-profile-a'
            ? 'MEMBER'
            : 'NOT_MEMBER_OR_NOT_FOUND';
        },
      };
  const defaultSafeZonePolicyAuthorizer = {
    async authorize(request) {
      authorizationRequests.push(request);
      return { verdict: authorizationVerdict };
    },
  };
  const safeZonePolicyAuthorizer = safeZonePolicyAuthorizerOverride ?? defaultSafeZonePolicyAuthorizer;
  const app = Fastify();
  registerParentAccountRoutes(app, {
    parentAccountService,
    parentPreferenceRepository: withPreferenceRepository ? parentPreferenceRepository : undefined,
    safeZoneRepository: withSafeZoneRepository ? safeZoneRepository : undefined,
    deviceRepository,
    deviceSessionService: withDeviceSessionService ? deviceSessionService : undefined,
    safeZonePolicyAuthorizer: withSafeZonePolicyAuthorizer ? safeZonePolicyAuthorizer : undefined,
    trustSetRoleResolver: withTrustSetRoleResolver ? trustSetRoleResolver : undefined,
    deviceChildBindingRepository,
    childProfileRegistryRepository,
  });
  app.safeZoneZones = zones;
  app.safeZoneRepository = safeZoneRepository;
  app.safeZoneAuthorizationRequests = authorizationRequests;
  app.safeZoneChildBindingCalls = childBindingCalls;
  app.setParentFamilyRole = (nextRole) => { currentParentRole = nextRole; };
  return app;
}

const authHeaders = { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', authorization: 'Bearer devtoken-a' };

test('preferences are account-scoped and mutations require matching CSRF', async () => {
  const app = buildApp();
  const initial = await app.inject({ method: 'GET', url: '/api/parent/preferences', headers: authHeaders });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.headers['cache-control'], 'private, no-store');
  recordParentRouteScenario({ method: 'GET', route: PREFERENCES_ROUTE, scenarioId: 'preferences_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: initial });
  assert.equal(initial.json().preferences.language, 'en');

  const blocked = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: authHeaders, payload: { language: 'ar' } });
  assert.equal(blocked.statusCode, 403);
  recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'preferences_patch_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: blocked });

  const changed = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { language: 'ar', emailAlertsEnabled: false } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.headers['cache-control'], 'private, no-store');
  recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'preferences_patch_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: changed });
  assert.equal(changed.json().preferences.language, 'ar');

  const other = await app.inject({ method: 'GET', url: '/api/parent/preferences', headers: { cookie: 'pca_family_session=session-b; pca_family_csrf=csrf-b' } });
  assert.equal(other.statusCode, 200);
  assert.equal(other.json().preferences.language, 'en');
  assert.equal(other.json().preferences.emailAlertsEnabled, true);

  const invalidDestination = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { emailDestination: 'not-an-email' } });
  assert.equal(invalidDestination.statusCode, 400);
  recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'preferences_patch_invalid_destination', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: invalidDestination });

  const destination = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { emailDestination: 'parent@example.test' } });
  assert.equal(destination.statusCode, 200);
  assert.equal(destination.json().preferences.emailDestination, 'parent@example.test');
  assert.equal(destination.json().preferences.emailDestinationState, 'UNVERIFIED');
});

test('unconfigured Parent preferences preserve session and CSRF checks before 503', async () => {
  const app = buildApp('OWNER', 'ALLOW', {}, { withPreferenceRepository: false });
  try {
    const noSessionRead = await app.inject({ method: 'GET', url: '/api/parent/preferences' });
    assert.equal(noSessionRead.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: PREFERENCES_ROUTE, scenarioId: 'preferences_unconfigured_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: noSessionRead });

    const authorizedRead = await app.inject({ method: 'GET', url: '/api/parent/preferences', headers: authHeaders });
    assert.equal(authorizedRead.statusCode, 503);
    assert.deepEqual(authorizedRead.json(), { error: 'not_configured' });
    recordParentRouteScenario({ method: 'GET', route: PREFERENCES_ROUTE, scenarioId: 'preferences_unconfigured_authorized_503', classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response: authorizedRead });

    const noSessionWrite = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', payload: { language: 'ar' } });
    assert.equal(noSessionWrite.statusCode, 401);
    recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'preferences_unconfigured_patch_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: noSessionWrite });

    const noCsrf = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: authHeaders, payload: { language: 'ar' } });
    assert.equal(noCsrf.statusCode, 403);
    assert.deepEqual(noCsrf.json(), { error: 'csrf_mismatch' });
    recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'preferences_unconfigured_patch_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf });

    const invalidPayload = await app.inject({
      method: 'PATCH', url: '/api/parent/preferences',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
      payload: { unknownPreference: 'must-not-be-processed' },
    });
    assert.equal(invalidPayload.statusCode, 503);
    assert.deepEqual(invalidPayload.json(), { error: 'not_configured' });
    assert.equal(invalidPayload.body.includes('must-not-be-processed'), false);
    recordParentRouteScenario({ method: 'PATCH', route: PREFERENCES_ROUTE, scenarioId: 'preferences_unconfigured_patch_authorized_503', classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response: invalidPayload });
  } finally {
    await app.close();
  }
});

test('safe zones accept only opaque encrypted policy envelopes and preserve offline delivery state', async () => {
  const app = buildApp();
  const wrongFamily = await app.inject({ method: 'GET', url: '/api/parent/families/family-b/safe-zones', headers: authHeaders });
  assert.equal(wrongFamily.statusCode, 403);
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: wrongFamily });

  const opaquePayload = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const noCsrf = await app.inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders, payload: opaquePayload });
  assert.equal(noCsrf.statusCode, 403);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_requires_csrf', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: noCsrf });

  const plaintext = await app.inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { childProfileId: 'child-a', label: 'Home', latitude: 1, longitude: 2, radiusMeters: 100 } });
  assert.equal(plaintext.statusCode, 400);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_plaintext_rejected', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: plaintext });

  const created = await app.inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: opaquePayload });
  assert.equal(created.statusCode, 201);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 201, response: created });
  assert.equal(created.json().safeZone.deliveryState, 'PENDING_OFFLINE');
  assert.equal(created.json().safeZone.ciphertextB64, 'AQID');
  assert.equal(app.safeZoneAuthorizationRequests.length, 1);
  assert.equal(app.safeZoneAuthorizationRequests[0].familyId, 'family-a');
  assert.equal(app.safeZoneAuthorizationRequests[0].actorDeviceId, 'device-a');
  assert.equal(app.safeZoneAuthorizationRequests[0].actorDskKeyId, 'device-a-key');
  assert.equal(app.safeZoneAuthorizationRequests[0].operation, 'EDIT_CHILD_POLICY');
  assert.deepEqual(app.safeZoneAuthorizationRequests[0].targetScope, { kind: 'DEVICE', id: 'child-device' });
  assert.deepEqual(app.safeZoneChildBindingCalls, [
    { familyId: 'family-a', deviceId: 'child-device' },
    { familyId: 'family-a', deviceId: 'child-device' },
  ], 'recipient profile binding is checked before authorization completes and again at persistence');

  const list = await app.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['cache-control'], 'private, no-store');
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: list });
  assert.equal(list.json().safeZones.length, 1);
});

test('Safe Zone writes reject non-CHILD or unbound recipients before persistence', async () => {
  const cases = [
    {
      name: 'active Parent recipient',
      resolver: { resolveActor: (_familyId, deviceId) => ({ deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: 1 }) },
      binding: { async resolveBinding() { return { outcome: 'BOUND', childProfileId: 'child-profile-a' }; } },
    },
    {
      name: 'active Viewer recipient',
      resolver: { resolveActor: (_familyId, deviceId) => ({ deviceId, role: 'VIEWER', trustSetEpoch: 1, keyEpoch: 1 }) },
      binding: { async resolveBinding() { return { outcome: 'BOUND', childProfileId: 'child-profile-a' }; } },
    },
    {
      name: 'paired recipient absent from accepted active Trust Set',
      expectedStatus: 403,
      resolver: { resolveActor: () => 'DEVICE_NOT_ACTIVE' },
      binding: { async resolveBinding() { return { outcome: 'BOUND', childProfileId: 'child-profile-a' }; } },
    },
    {
      name: 'unbound legacy recipient',
      resolver: { resolveActor: (_familyId, deviceId) => ({ deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 }) },
      binding: { async resolveBinding() { return { outcome: 'UNBOUND' }; } },
    },
    {
      name: 'ambiguous enrollment recipient',
      resolver: { resolveActor: (_familyId, deviceId) => ({ deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 }) },
      binding: { async resolveBinding() { return { outcome: 'AMBIGUOUS' }; } },
    },
  ];

  for (const scenario of cases) {
    const app = buildApp('OWNER', 'ALLOW', {}, {
      trustSetRoleResolverOverride: scenario.resolver,
      deviceChildBindingRepositoryOverride: scenario.binding,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/parent/families/family-a/safe-zones',
        headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
        payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
      });
      const expectedStatus = scenario.expectedStatus ?? 400;
      assert.equal(response.statusCode, expectedStatus, scenario.name);
      assert.deepEqual(response.json(), { error: expectedStatus === 400 ? 'invalid_recipient' : 'forbidden' }, scenario.name);
      assert.equal(app.safeZoneZones.size, 0, scenario.name);
    } finally {
      await app.close();
    }
  }

  const unavailable = buildApp('OWNER', 'ALLOW', {}, {
    deviceChildBindingRepositoryOverride: { async resolveBinding() { throw new Error('binding store sentinel'); } },
  });
  try {
    const response = await unavailable.inject({
      method: 'POST',
      url: '/api/parent/families/family-a/safe-zones',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
      payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'family_authority_unavailable' });
    assert.equal(response.body.includes('binding store sentinel'), false);
    assert.equal(unavailable.safeZoneZones.size, 0);
  } finally {
    await unavailable.close();
  }
});

test('Safe Zone mutations require the bound child profile to be a current family registry member', async () => {
  for (const scenario of [
    { name: 'profile is absent or belongs to another family', registry: { async resolveMembership() { return 'NOT_MEMBER_OR_NOT_FOUND'; } }, expectedStatus: 400, expectedError: 'invalid_recipient' },
    { name: 'registry dependency is missing', registry: null, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { name: 'registry lookup failed', registry: { async resolveMembership() { throw new Error('registry store sentinel'); } }, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { name: 'registry returned an unknown outcome', registry: { async resolveMembership() { return 'UNKNOWN'; } }, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
  ]) {
    const app = buildApp('OWNER', 'ALLOW', {}, {
      childProfileRegistryRepositoryOverride: scenario.registry,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/parent/families/family-a/safe-zones',
        headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
        payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
      });
      assert.equal(response.statusCode, scenario.expectedStatus, scenario.name);
      assert.deepEqual(response.json(), { error: scenario.expectedError }, scenario.name);
      assert.equal(app.safeZoneZones.size, 0, scenario.name);
    } finally {
      await app.close();
    }
  }
});

test('Safe Zone final persistence authorization rejects a changed child-profile binding', async () => {
  let bindingReads = 0;
  const app = buildApp('OWNER', 'ALLOW', {}, {
    deviceChildBindingRepositoryOverride: {
      async resolveBinding(familyId, deviceId) {
        assert.equal(familyId, 'family-a');
        assert.equal(deviceId, 'child-device');
        bindingReads += 1;
        return { outcome: 'BOUND', childProfileId: bindingReads === 1 ? 'child-profile-a' : 'child-profile-b' };
      },
    },
    childProfileRegistryRepositoryOverride: {
      async resolveMembership(familyId, childProfileId) {
        return familyId === 'family-a' && ['child-profile-a', 'child-profile-b'].includes(childProfileId)
          ? 'MEMBER'
          : 'NOT_MEMBER_OR_NOT_FOUND';
      },
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/families/family-a/safe-zones',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
      payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
    });
    assert.equal(bindingReads, 2);
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'authority_changed' });
    assert.equal(app.safeZoneZones.size, 0);
  } finally {
    await app.close();
  }
});

test('Safe Zone authorization rechecks the exact session DSK after a Trust Set key rotation', async () => {
  const resolverCalls = [];
  let acceptedKeyId = 'device-a-key';
  const trustSetRoleResolver = {
    resolveActor(familyId, deviceId, dskKeyId) {
      if (familyId !== 'family-a') return 'DEVICE_NOT_IN_TRUST_SET';
      if (deviceId === 'child-device') return { deviceId, role: 'CHILD', trustSetEpoch: 2, keyEpoch: 1 };
      if (deviceId !== 'device-a') return 'DEVICE_NOT_IN_TRUST_SET';
      if (dskKeyId !== undefined) resolverCalls.push(dskKeyId);
      // The legacy unbound lookup resolves the current member, while a
      // session-bound lookup must match its exact accepted key.
      if (dskKeyId !== undefined && dskKeyId !== acceptedKeyId) return 'DEVICE_NOT_ACTIVE';
      return { deviceId, role: 'OWNER', trustSetEpoch: 2, keyEpoch: 1 };
    },
  };
  const authorizationRequests = [];
  const safeZonePolicyAuthorizerOverride = {
    async authorize(request) {
      authorizationRequests.push(request);
      acceptedKeyId = 'rotated-key';
      const actor = trustSetRoleResolver.resolveActor(
        request.familyId,
        request.actorDeviceId,
        request.actorDskKeyId,
      );
      return typeof actor === 'string' ? { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' } : { verdict: 'ALLOW' };
    },
  };
  const app = buildApp('OWNER', 'ALLOW', {}, { trustSetRoleResolverOverride: trustSetRoleResolver, safeZonePolicyAuthorizerOverride });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/families/family-a/safe-zones',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
      payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(authorizationRequests.map((request) => request.actorDskKeyId), ['device-a-key']);
    assert.deepEqual(resolverCalls, ['device-a-key', 'device-a-key']);
    assert.equal(app.safeZoneZones.size, 0);
  } finally {
    await app.close();
  }
});

test('unconfigured Safe Zone routes preserve session, role, CSRF, and device-session checks before 503', async () => {
  const noSessionApp = buildApp('OWNER', 'ALLOW', {}, { withSafeZoneRepository: false });
  try {
    const response = await noSessionApp.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones' });
    assert.equal(response.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_unconfigured_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response });
  } finally { await noSessionApp.close(); }

  const crossFamilyApp = buildApp('OWNER', 'ALLOW', {}, { withSafeZoneRepository: false });
  try {
    const response = await crossFamilyApp.inject({ method: 'GET', url: '/api/parent/families/family-b/safe-zones', headers: authHeaders });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_unconfigured_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
  } finally { await crossFamilyApp.close(); }

  const wrongRoleApp = buildApp('CHILD', 'ALLOW', {}, { withSafeZoneRepository: false });
  try {
    const response = await wrongRoleApp.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_unconfigured_wrong_role_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
  } finally { await wrongRoleApp.close(); }

  const viewerApp = buildApp('VIEWER', 'ALLOW', {}, { withSafeZoneRepository: false });
  try {
    const response = await viewerApp.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'not_configured' });
    recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_unconfigured_viewer_503', classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response });
  } finally { await viewerApp.close(); }

  const mutations = [
    { method: 'POST', route: SAFE_ZONES_ROUTE, url: '/api/parent/families/family-a/safe-zones' },
    { method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, url: '/api/parent/families/family-a/safe-zones/zone-a' },
    { method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, url: '/api/parent/families/family-a/safe-zones/zone-a' },
  ];
  const validBody = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  for (const endpoint of mutations) {
    const noCsrfApp = buildApp('OWNER', 'ALLOW', {}, { withSafeZoneRepository: false });
    try {
      const response = await noCsrfApp.inject({ method: endpoint.method, url: endpoint.url, headers: authHeaders, ...(endpoint.method === 'DELETE' ? {} : { payload: validBody }) });
      assert.equal(response.statusCode, 403, `${endpoint.method} checks CSRF before repository availability`);
      recordParentRouteScenario({ method: endpoint.method, route: endpoint.route, scenarioId: `safe_zones_unconfigured_csrf_denied_${endpoint.method.toLowerCase()}`, classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    } finally { await noCsrfApp.close(); }

    const nonAdminApp = buildApp('VIEWER', 'ALLOW', {}, { withSafeZoneRepository: false });
    try {
      const response = await nonAdminApp.inject({ method: endpoint.method, url: endpoint.url, headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, ...(endpoint.method === 'DELETE' ? {} : { payload: validBody }) });
      assert.equal(response.statusCode, 403, `${endpoint.method} checks Administrator role before repository availability`);
      recordParentRouteScenario({ method: endpoint.method, route: endpoint.route, scenarioId: `safe_zones_unconfigured_non_admin_denied_${endpoint.method.toLowerCase()}`, classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    } finally { await nonAdminApp.close(); }

    const noActorApp = buildApp('OWNER', 'ALLOW', {}, { withSafeZoneRepository: false });
    try {
      const response = await noActorApp.inject({ method: endpoint.method, url: endpoint.url, headers: { cookie: authHeaders.cookie, 'x-pca-csrf-token': 'csrf-a' }, ...(endpoint.method === 'DELETE' ? {} : { payload: validBody }) });
      assert.equal(response.statusCode, 401, `${endpoint.method} requires an actor-device session before repository availability`);
      recordParentRouteScenario({ method: endpoint.method, route: endpoint.route, scenarioId: `safe_zones_unconfigured_actor_denied_${endpoint.method.toLowerCase()}`, classification: 'EXPECTED_DENIAL', expectedStatus: 401, response });
    } finally { await noActorApp.close(); }

    const authorizedApp = buildApp('OWNER', 'ALLOW', {}, { withSafeZoneRepository: false });
    try {
      const response = await authorizedApp.inject({
        method: endpoint.method, url: endpoint.url,
        headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
        ...(endpoint.method === 'DELETE' ? {} : { payload: { ...validBody, domain: 'unavailable-never-echo.invalid' } }),
      });
      assert.equal(response.statusCode, 503, `${endpoint.method} retains not_configured for an authenticated Administrator`);
      assert.deepEqual(response.json(), { error: 'not_configured' });
      assert.equal(response.body.includes('unavailable-never-echo.invalid'), false);
      assert.equal(authorizedApp.safeZoneZones.size, 0);
      recordParentRouteScenario({ method: endpoint.method, route: endpoint.route, scenarioId: `safe_zones_unconfigured_authorized_503_${endpoint.method.toLowerCase()}`, classification: 'SERVICE_NOT_CONFIGURED', expectedStatus: 503, response });
    } finally { await authorizedApp.close(); }
  }
});

test('Safe Zone mutation checks the actor bearer before reporting unavailable edit authority', async () => {
  const app = buildApp('OWNER', 'ALLOW', {}, { withSafeZonePolicyAuthorizer: false });
  const payload = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  try {
    const missingActor = await app.inject({
      method: 'POST', url: '/api/parent/families/family-a/safe-zones',
      headers: { cookie: authHeaders.cookie, 'x-pca-csrf-token': 'csrf-a' }, payload,
    });
    assert.equal(missingActor.statusCode, 401);
    assert.deepEqual(missingActor.json(), { error: 'actor_device_session_required' });
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_missing_authorizer_requires_actor', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response: missingActor });

    const validActor = await app.inject({
      method: 'POST', url: '/api/parent/families/family-a/safe-zones',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload,
    });
    assert.equal(validActor.statusCode, 503);
    assert.deepEqual(validActor.json(), { error: 'family_authority_unavailable' });
    assert.equal(app.safeZoneZones.size, 0);
    assert.equal(app.safeZoneAuthorizationRequests.length, 0);
    recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_missing_authorizer_valid_actor_503', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 503, response: validActor });
  } finally { await app.close(); }
});

test('safe-zone HTTP validation enforces canonical bytes, repository epoch bounds, and opaque-only fields', async () => {
  const app = buildApp();
  const headers = { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' };
  const valid = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const invalidCreates = [
    { ...valid, ciphertextB64: 'AB' }, // Valid alphabet/length, but non-canonical unused bits.
    { ...valid, nonceB64: 'AAECAwQFBgcICQ' }, // Decodes below the repository's 12-byte minimum.
    { ...valid, keyEpoch: 0x1_0000_0000 },
    { ...valid, keyEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, label: 'Home' },
  ];

  for (const payload of invalidCreates) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/parent/families/family-a/safe-zones',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(app.safeZoneAuthorizationRequests.length, 0);
  assert.equal(app.safeZoneZones.size, 0);

  const existing = {
    zoneId: 'zone-a',
    familyId: 'family-a',
    ...valid,
    revision: 2,
    deliveryState: 'PENDING_OFFLINE',
  };
  app.safeZoneZones.set(existing.zoneId, existing);
  const invalidUpdates = [
    { ciphertextB64: 'AB' },
    { nonceB64: 'AAECAwQFBgcICQ' },
    { ciphertextB64: 'BAUG' },
    { nonceB64: 'AAECAwQFBgcICQoL' },
    { keyEpoch: 4 },
    { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 0x1_0000_0000 },
    { label: 'Home' },
  ];
  for (const payload of invalidUpdates) {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/parent/families/family-a/safe-zones/zone-a',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(app.safeZoneAuthorizationRequests.length, 0);
  assert.deepEqual(app.safeZoneZones.get('zone-a'), existing);
});

test('Safe Zone ciphertext keyEpoch must match the actor current accepted Trust Set key epoch', async () => {
  const headers = { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' };
  const actorResolver = (keyEpoch) => ({
    resolveActor(_familyId, deviceId) {
      return { deviceId, role: deviceId === 'child-device' ? 'CHILD' : 'OWNER', trustSetEpoch: 1, keyEpoch };
    },
  });
  const payloadFor = (keyEpoch) => ({
    recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch,
  });

  for (const { actorKeyEpoch, payloadKeyEpoch } of [
    { actorKeyEpoch: 2, payloadKeyEpoch: 1 }, // Stale envelope.
    { actorKeyEpoch: 1, payloadKeyEpoch: 2 }, // Future/unaccepted envelope.
  ]) {
    let createWrites = 0;
    const app = buildApp('OWNER', 'ALLOW', {
      async create() { createWrites += 1; throw new Error('unexpected create'); },
    }, { trustSetRoleResolverOverride: actorResolver(actorKeyEpoch) });
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers,
        payload: payloadFor(payloadKeyEpoch),
      });
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' });
      assert.equal(createWrites, 0);
      assert.equal(app.safeZoneZones.size, 0);
    } finally { await app.close(); }
  }

  const matchingCreate = buildApp('OWNER', 'ALLOW', {}, { trustSetRoleResolverOverride: actorResolver(2) });
  try {
    const created = await matchingCreate.inject({
      method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers, payload: payloadFor(2),
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().safeZone.keyEpoch, 2);
  } finally { await matchingCreate.close(); }

  let acceptedKeyEpoch = 1;
  let resolverCalls = 0;
  let rotationRaceWrites = 0;
  const rotatingResolver = {
    resolveActor(_familyId, deviceId) {
      resolverCalls += 1;
      return { deviceId, role: deviceId === 'child-device' ? 'CHILD' : 'OWNER', trustSetEpoch: resolverCalls, keyEpoch: acceptedKeyEpoch };
    },
  };
  const rotationRace = buildApp('OWNER', 'ALLOW', {
    async create() { rotationRaceWrites += 1; throw new Error('stale epoch must not be persisted'); },
  }, {
    trustSetRoleResolverOverride: rotatingResolver,
    safeZonePolicyAuthorizerOverride: {
      async authorize() {
        acceptedKeyEpoch = 2;
        return { verdict: 'ALLOW' };
      },
    },
  });
  try {
    const response = await rotationRace.inject({
      method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers, payload: payloadFor(1),
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' });
    assert.equal(resolverCalls, 2, 'the current accepted actor epoch is re-resolved after policy authorization');
    assert.equal(rotationRaceWrites, 0);
    assert.equal(rotationRace.safeZoneZones.size, 0);
  } finally { await rotationRace.close(); }

  for (const { actorKeyEpoch, storedKeyEpoch, patchKeyEpoch } of [
    { actorKeyEpoch: 1, storedKeyEpoch: 2, patchKeyEpoch: undefined }, // Stored envelope became stale after rotation.
    { actorKeyEpoch: 1, storedKeyEpoch: 1, patchKeyEpoch: 2 }, // Future replacement envelope.
    { actorKeyEpoch: 2, storedKeyEpoch: 1, patchKeyEpoch: 1 }, // Stale replacement envelope.
  ]) {
    let updateWrites = 0;
    const app = buildApp('OWNER', 'ALLOW', {
      async update() { updateWrites += 1; throw new Error('unexpected update'); },
    }, { trustSetRoleResolverOverride: actorResolver(actorKeyEpoch) });
    app.safeZoneZones.set('zone-a', {
      zoneId: 'zone-a', familyId: 'family-a', ...payloadFor(storedKeyEpoch),
      revision: 1, deliveryState: 'PENDING_OFFLINE',
    });
    const original = structuredClone(app.safeZoneZones.get('zone-a'));
    const patch = patchKeyEpoch === undefined
      ? { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' }
      : { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: patchKeyEpoch };
    try {
      const response = await app.inject({
        method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers, payload: patch,
      });
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' });
      assert.equal(updateWrites, 0);
      assert.deepEqual(app.safeZoneZones.get('zone-a'), original);
    } finally { await app.close(); }
  }

  let matchingUpdateWrites = 0;
  const matchingUpdate = buildApp('OWNER', 'ALLOW', {
    async update(familyId, zoneId, patch) {
      matchingUpdateWrites += 1;
      return { zoneId, familyId, ...patch };
    },
  }, { trustSetRoleResolverOverride: actorResolver(2) });
  matchingUpdate.safeZoneZones.set('zone-a', {
    zoneId: 'zone-a', familyId: 'family-a', ...payloadFor(1),
    revision: 1, deliveryState: 'PENDING_OFFLINE',
  });
  try {
    const updated = await matchingUpdate.inject({
      method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers,
      payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 2 },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(matchingUpdateWrites, 1);
  } finally { await matchingUpdate.close(); }
});

test('safe-zone repository validation errors are returned as client errors', async () => {
  const createApp = buildApp('OWNER', 'ALLOW', {
    async create() { throw new SafeZoneError('INVALID_INPUT'); },
  });
  const payload = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const create = await createApp.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    payload,
  });
  assert.equal(create.statusCode, 400);

  const updateApp = buildApp('OWNER', 'ALLOW', {
    async update() { throw new SafeZoneError('INVALID_INPUT'); },
  });
  updateApp.safeZoneZones.set('zone-a', {
    zoneId: 'zone-a',
    familyId: 'family-a',
    recipientEndpointId: 'child-device',
    ...payload,
    revision: 1,
    deliveryState: 'PENDING_OFFLINE',
  });
  const update = await updateApp.inject({
    method: 'PATCH',
    url: '/api/parent/families/family-a/safe-zones/zone-a',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' },
  });
  assert.equal(update.statusCode, 400);
});

test('safe-zone update and delete re-authorize the stored recipient endpoint', async () => {
  const app = buildApp();
  app.safeZoneZones.set('zone-a', { zoneId: 'zone-a', familyId: 'family-a', recipientEndpointId: 'device-b' });

  const update = await app.inject({ method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } });
  assert.equal(update.statusCode, 404);
  recordParentRouteScenario({ method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'safe_zones_update_wrong_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: update });

  const remove = await app.inject({ method: 'DELETE', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' } });
  assert.equal(remove.statusCode, 404);
  recordParentRouteScenario({ method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'safe_zones_delete_wrong_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: remove });

  app.safeZoneZones.set('zone-a', { zoneId: 'zone-a', familyId: 'family-a', recipientEndpointId: 'child-device', keyEpoch: 1 });
  const allowedUpdate = await app.inject({ method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } });
  assert.equal(allowedUpdate.statusCode, 200);
  recordParentRouteScenario({ method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'safe_zones_update_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: allowedUpdate });

  const allowedRemove = await app.inject({ method: 'DELETE', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' } });
  assert.equal(allowedRemove.statusCode, 204);
  recordParentRouteScenario({ method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'safe_zones_delete_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 204, response: allowedRemove });
});

test('safe-zone update and delete deny inactive roles before looking up zone existence', async () => {
  for (const role of ['VIEWER', null]) {
    for (const zoneId of ['zone-a', 'zone-missing']) {
      for (const method of ['PATCH', 'DELETE']) {
        const app = buildApp(role);
        if (zoneId === 'zone-a') {
          app.safeZoneZones.set(zoneId, {
            zoneId,
            familyId: 'family-a',
            recipientEndpointId: 'child-device',
            ciphertextB64: 'AQID',
            nonceB64: 'AAECAwQFBgcICQoL',
            keyEpoch: 1,
            revision: 1,
            deliveryState: 'PENDING_OFFLINE',
          });
        }
        let listReads = 0;
        const listZones = app.safeZoneRepository.list.bind(app.safeZoneRepository);
        app.safeZoneRepository.list = async (...args) => {
          listReads += 1;
          return listZones(...args);
        };
        const response = await app.inject({
          method,
          url: `/api/parent/families/family-a/safe-zones/${zoneId}`,
          headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
          ...(method === 'PATCH' ? { payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } } : {}),
        });
        assert.equal(response.statusCode, 403, `${role ?? 'revoked'} ${method} ${zoneId}`);
        assert.equal(listReads, 0, `${role ?? 'revoked'} ${method} ${zoneId} must not read family zones`);
        assert.equal(app.safeZoneAuthorizationRequests.length, 0, `${role ?? 'revoked'} ${method} ${zoneId} must not reach device policy authorization`);
        recordParentRouteScenario({
          method,
          route: SAFE_ZONE_DETAIL_ROUTE,
          scenarioId: `safe_zones_${method.toLowerCase()}_${role ? 'viewer' : 'revoked'}_${zoneId === 'zone-a' ? 'existing' : 'absent'}_denied_before_lookup`,
          classification: 'EXPECTED_DENIAL',
          expectedStatus: 403,
          response,
        });
      }
    }
  }
});

test('safe-zone update and delete return the same denial if membership is revoked during lookup', async () => {
  for (const zoneId of ['zone-a', 'zone-missing']) {
    for (const method of ['PATCH', 'DELETE']) {
      const app = buildApp(['OWNER', null]);
      if (zoneId === 'zone-a') {
        app.safeZoneZones.set(zoneId, {
          zoneId,
          familyId: 'family-a',
          recipientEndpointId: 'child-device',
          ciphertextB64: 'AQID',
          nonceB64: 'AAECAwQFBgcICQoL',
          keyEpoch: 1,
          revision: 1,
          deliveryState: 'PENDING_OFFLINE',
        });
      }
      let listReads = 0;
      const listZones = app.safeZoneRepository.list.bind(app.safeZoneRepository);
      app.safeZoneRepository.list = async (...args) => {
        listReads += 1;
        return listZones(...args);
      };
      const response = await app.inject({
        method,
        url: `/api/parent/families/family-a/safe-zones/${zoneId}`,
        headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
        ...(method === 'PATCH' ? { payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } } : {}),
      });
      assert.equal(response.statusCode, 403, `${method} ${zoneId} after in-flight membership revocation`);
      assert.equal(listReads, 1);
      assert.equal(app.safeZoneAuthorizationRequests.length, 0);
    }
  }
});

test('Safe Zone mutations recheck active Parent Administrator membership after authority lookups', async () => {
  const headers = { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' };
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    let app;
    let bindingReads = 0;
    const writes = { create: 0, update: 0, remove: 0 };
    const expectedBindingReads = 1;
    const bindingRepository = {
      async resolveBinding(familyId, deviceId) {
        assert.equal(familyId, 'family-a');
        assert.equal(deviceId, 'child-device');
        bindingReads += 1;
        if (bindingReads === expectedBindingReads) {
          // Simulate an Administrator revocation during the initial recipient
          // binding lookup, after the route's earlier role checks. The final
          // Parent-role check must reject before enqueue.
          app.setParentFamilyRole('VIEWER');
        }
        return { outcome: 'BOUND', childProfileId: 'child-profile-a' };
      },
    };
    app = buildApp('OWNER', 'ALLOW', {
      async create(input) {
        writes.create += 1;
        return { zoneId: 'zone-new', ...input };
      },
      async update(familyId, zoneId, patch) {
        writes.update += 1;
        return { zoneId, familyId, ...patch };
      },
      async remove() {
        writes.remove += 1;
        return true;
      },
    }, { deviceChildBindingRepositoryOverride: bindingRepository });
    app.safeZoneZones.set('zone-a', {
      zoneId: 'zone-a',
      familyId: 'family-a',
      recipientEndpointId: 'child-device',
      ciphertextB64: 'AQID',
      nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 1,
      revision: 1,
      deliveryState: 'PENDING_OFFLINE',
    });

    try {
      const response = await app.inject({
        method,
        url: method === 'POST'
          ? '/api/parent/families/family-a/safe-zones'
          : `/api/parent/families/family-a/safe-zones/zone-a`,
        headers,
        ...(method === 'POST'
          ? { payload: { recipientEndpointId: 'child-device', ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } }
          : method === 'PATCH'
            ? { payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } }
            : {}),
      });
      assert.equal(response.statusCode, 403, `${method} must reject the revoked Parent role`);
      assert.deepEqual(response.json(), { error: 'forbidden' });
      assert.equal(bindingReads, expectedBindingReads);
      assert.deepEqual(writes, { create: 0, update: 0, remove: 0 });
      assert.equal(app.safeZoneZones.has('zone-a'), true);
    } finally {
      await app.close();
    }
  }
});

test('Safe Zone POST and PATCH recheck actor and recipient binding after the final Parent-role await', async () => {
  const headers = { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' };
  for (const method of ['POST', 'PATCH']) {
    for (const changedAuthority of ['actor-key-epoch', 'recipient-binding']) {
      let actorRotated = false;
      let bindingChanged = false;
      let writes = 0;
      const finalRoleReadIndex = method === 'POST' ? 1 : 2;
      const app = buildApp('OWNER', 'ALLOW', {
        async create(input) {
          writes += 1;
          return { zoneId: 'zone-new', ...input };
        },
        async update(familyId, zoneId, patch) {
          writes += 1;
          return { zoneId, familyId, ...patch };
        },
      }, {
        onActiveFamilyRole: async (readIndex) => {
          if (readIndex !== finalRoleReadIndex) return;
          if (changedAuthority === 'actor-key-epoch') actorRotated = true;
          else bindingChanged = true;
        },
        trustSetRoleResolverOverride: {
          resolveActor(familyId, deviceId, dskKeyId) {
            if (familyId !== 'family-a') return 'DEVICE_NOT_ACTIVE';
            if (dskKeyId !== undefined) {
              return { deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: actorRotated ? 2 : 1 };
            }
            return { deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
          },
        },
        deviceChildBindingRepositoryOverride: {
          async resolveBinding(familyId, deviceId) {
            assert.equal(familyId, 'family-a');
            assert.equal(deviceId, 'child-device');
            return {
              outcome: 'BOUND',
              childProfileId: bindingChanged ? 'child-profile-b' : 'child-profile-a',
            };
          },
        },
        childProfileRegistryRepositoryOverride: {
          async resolveMembership(familyId, childProfileId) {
            return familyId === 'family-a' && ['child-profile-a', 'child-profile-b'].includes(childProfileId)
              ? 'MEMBER'
              : 'NOT_MEMBER_OR_NOT_FOUND';
          },
        },
      });
      const existingZone = {
        zoneId: 'zone-a',
        familyId: 'family-a',
        recipientEndpointId: 'child-device',
        ciphertextB64: 'AQID',
        nonceB64: 'AAECAwQFBgcICQoL',
        keyEpoch: 1,
        revision: 1,
        deliveryState: 'PENDING_OFFLINE',
      };
      app.safeZoneZones.set(existingZone.zoneId, existingZone);

      try {
        const response = await app.inject({
          method,
          url: method === 'POST'
            ? '/api/parent/families/family-a/safe-zones'
            : '/api/parent/families/family-a/safe-zones/zone-a',
          headers,
          ...(method === 'POST'
            ? { payload: { recipientEndpointId: 'child-device', ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } }
            : { payload: { ciphertextB64: 'BAUG', nonceB64: 'AAECAwQFBgcICQoL' } }),
        });
        assert.equal(response.statusCode, 409, `${method} ${changedAuthority}`);
        assert.deepEqual(response.json(), {
          error: changedAuthority === 'actor-key-epoch' ? 'key_epoch_mismatch' : 'authority_changed',
        });
        assert.equal(writes, 0, `${method} must not write after authority changes during the final role lookup`);
        assert.equal(app.safeZoneZones.get('zone-a'), existingZone);
      } finally {
        await app.close();
      }
    }
  }
});

test('Safe Zone DELETE rechecks actor DSK and accepted epochs after child-binding authority lookup', async () => {
  let bindingResolved = false;
  let removeCalls = 0;
  const app = buildApp('OWNER', 'ALLOW', {
    async remove() {
      removeCalls += 1;
      return true;
    },
  }, {
    trustSetRoleResolverOverride: {
      resolveActor(familyId, deviceId, dskKeyId) {
        if (familyId !== 'family-a') return 'DEVICE_NOT_ACTIVE';
        if (dskKeyId !== undefined) {
          return {
            deviceId,
            role: 'OWNER',
            trustSetEpoch: 1,
            // Simulate accepted-head key rotation while the earlier recipient
            // binding lookup is in flight. The final actor read must see it.
            keyEpoch: bindingResolved ? 2 : 1,
          };
        }
        return { deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      },
    },
    deviceChildBindingRepositoryOverride: {
      async resolveBinding(familyId, deviceId) {
        assert.equal(familyId, 'family-a');
        assert.equal(deviceId, 'child-device');
        bindingResolved = true;
        return { outcome: 'BOUND', childProfileId: 'child-profile-a' };
      },
    },
  });
  app.safeZoneZones.set('zone-a', {
    zoneId: 'zone-a',
    familyId: 'family-a',
    recipientEndpointId: 'child-device',
    ciphertextB64: 'AQID',
    nonceB64: 'AAECAwQFBgcICQoL',
    keyEpoch: 1,
    revision: 1,
    deliveryState: 'PENDING_OFFLINE',
  });

  try {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/parent/families/family-a/safe-zones/zone-a',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' });
    assert.equal(bindingResolved, true);
    assert.equal(removeCalls, 0);
    assert.equal(app.safeZoneZones.has('zone-a'), true);
  } finally {
    await app.close();
  }
});

test('Safe Zone DELETE re-resolves actor authority after the final Parent-role await', async () => {
  let actorRotated = false;
  let removeCalls = 0;
  const app = buildApp('OWNER', 'ALLOW', {
    async remove() {
      removeCalls += 1;
      return true;
    },
  }, {
    onActiveFamilyRole: async (readIndex) => {
      if (readIndex === 2) actorRotated = true;
    },
    trustSetRoleResolverOverride: {
      resolveActor(familyId, deviceId, dskKeyId) {
        if (familyId !== 'family-a') return 'DEVICE_NOT_ACTIVE';
        if (dskKeyId !== undefined) {
          return { deviceId, role: 'OWNER', trustSetEpoch: 1, keyEpoch: actorRotated ? 2 : 1 };
        }
        return { deviceId, role: 'CHILD', trustSetEpoch: 1, keyEpoch: 1 };
      },
    },
  });
  app.safeZoneZones.set('zone-a', {
    zoneId: 'zone-a',
    familyId: 'family-a',
    recipientEndpointId: 'child-device',
    ciphertextB64: 'AQID',
    nonceB64: 'AAECAwQFBgcICQoL',
    keyEpoch: 1,
    revision: 1,
    deliveryState: 'PENDING_OFFLINE',
  });

  try {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/parent/families/family-a/safe-zones/zone-a',
      headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' });
    assert.equal(actorRotated, true);
    assert.equal(removeCalls, 0);
    assert.equal(app.safeZoneZones.has('zone-a'), true);
  } finally {
    await app.close();
  }
});

test('safe-zone Parent membership allows reads for Viewer and mutations only for Administrator', async () => {
  const owner = await buildApp('OWNER').inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(owner.statusCode, 200);

  const administrator = await buildApp('ADMINISTRATOR').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(administrator.statusCode, 201);

  const viewerRead = await buildApp('VIEWER').inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(viewerRead.statusCode, 200);
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_viewer_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: viewerRead });
  const viewerMutation = await buildApp('VIEWER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(viewerMutation.statusCode, 403);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_viewer_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: viewerMutation });

  const crossFamilyRecipient = await buildApp('OWNER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'device-b', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(crossFamilyRecipient.statusCode, 404);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_cross_family_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: crossFamilyRecipient });

  const unknownRecipient = await buildApp('OWNER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'unknown-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(unknownRecipient.statusCode, 404);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_unknown_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: unknownRecipient });

  const malformedRecipient = await buildApp('OWNER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'not valid', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(malformedRecipient.statusCode, 400);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_malformed_recipient', classification: 'VALIDATION_OR_PROTOCOL', expectedStatus: 400, response: malformedRecipient });

  const noAuthority = Fastify();
  const noAuthorityService = { async readSession() { return { accountId: 'account-a', familyId: 'family-a', emailVerified: true }; } };
  const noAuthorityRepository = { async list() { return []; }, async create() { throw new Error('unexpected'); }, async update() { throw new Error('unexpected'); }, async remove() { return false; } };
  registerParentAccountRoutes(noAuthority, { parentAccountService: noAuthorityService, safeZoneRepository: noAuthorityRepository });
  const unavailable = await noAuthority.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(unavailable.statusCode, 503);
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_authority_unavailable', classification: 'AUTHORITY_UNAVAILABLE', expectedStatus: 503, response: unavailable });
});

test('safe-zone mutation fails closed when the Trust Set-backed policy authorizer denies', async () => {
  const app = buildApp('OWNER', 'DENY');
  const denied = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(app.safeZoneZones.size, 0);
  assert.equal(app.safeZoneAuthorizationRequests.length, 1);
});

test('safe-zone mutation requires a verified device bearer and rejects a mismatched legacy actor header', async () => {
  const app = buildApp('OWNER');
  const payload = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const missingBearer = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { cookie: authHeaders.cookie, 'x-pca-csrf-token': 'csrf-a' },
    payload,
  });
  assert.equal(missingBearer.statusCode, 401);
  assert.equal(missingBearer.json().error, 'actor_device_session_required');

  const mismatchedActor = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a', 'x-pca-actor-device-id': 'device-b' },
    payload,
  });
  assert.equal(mismatchedActor.statusCode, 401);
  assert.equal(mismatchedActor.json().error, 'actor_device_session_invalid');
  assert.equal(app.safeZoneZones.size, 0);
  assert.equal(app.safeZoneAuthorizationRequests.length, 0);
});

test('safe-zone mutation rejects a stale device-session DSK before authorization or storage', async () => {
  const app = buildApp('OWNER', 'ALLOW', {}, { deviceDskKeyId: 'retired-device-key' });
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, 'forbidden');
  assert.equal(app.safeZoneZones.size, 0);
  assert.equal(app.safeZoneAuthorizationRequests.length, 0);
});

test('safe-zone mutation fails closed before authorization when accepted Trust Set resolution is unavailable', async () => {
  const app = buildApp('OWNER', 'ALLOW', {}, { withTrustSetRoleResolver: false });
  const response = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    payload: { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'family_authority_unavailable');
  assert.equal(app.safeZoneZones.size, 0);
  assert.equal(app.safeZoneAuthorizationRequests.length, 0);
});

test('client-supplied device identity cannot grant Parent membership authority', async () => {
  const app = buildApp('VIEWER');
  const opaquePayload = { recipientEndpointId: 'child-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const legitimate = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a', 'x-pca-actor-device-id': 'administrator-device' },
    payload: opaquePayload,
  });
  assert.equal(legitimate.statusCode, 403);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_client_device_identity_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: legitimate });
});
