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

function buildApp(role = 'OWNER', authorizationVerdict = 'ALLOW', safeZoneRepositoryOverrides = {}) {
  const sessions = new Map([
    ['session-a', { accountId: 'account-a', familyId: 'family-a', emailVerified: true }],
    ['session-b', { accountId: 'account-b', familyId: 'family-a', emailVerified: true }],
  ]);
  const preferences = new Map();
  const zones = new Map();
  const authorizationRequests = [];
  let roleReadCount = 0;
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole(accountId, familyId) {
      if (familyId !== 'family-a') return null;
      const selectedRole = Array.isArray(role) ? role[Math.min(roleReadCount++, role.length - 1)] : role;
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
      return familyId === 'family-a' && deviceId === 'device-a' ? { deviceId, familyId } : null;
    },
  };
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, familyId) {
      if (token !== 'devtoken-a' || familyId !== 'family-a') throw new Error('unauthorized');
      return { deviceId: 'device-a', familyId };
    },
  };
  const safeZonePolicyAuthorizer = {
    async authorize(request) {
      authorizationRequests.push(request);
      return { verdict: authorizationVerdict };
    },
  };
  const app = Fastify();
  registerParentAccountRoutes(app, {
    parentAccountService,
    parentPreferenceRepository,
    safeZoneRepository,
    deviceRepository,
    deviceSessionService,
    safeZonePolicyAuthorizer,
  });
  app.safeZoneZones = zones;
  app.safeZoneRepository = safeZoneRepository;
  app.safeZoneAuthorizationRequests = authorizationRequests;
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

test('safe zones accept only opaque encrypted policy envelopes and preserve offline delivery state', async () => {
  const app = buildApp();
  const wrongFamily = await app.inject({ method: 'GET', url: '/api/parent/families/family-b/safe-zones', headers: authHeaders });
  assert.equal(wrongFamily.statusCode, 403);
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: wrongFamily });

  const opaquePayload = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
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
  assert.equal(app.safeZoneAuthorizationRequests[0].operation, 'EDIT_CHILD_POLICY');
  assert.deepEqual(app.safeZoneAuthorizationRequests[0].targetScope, { kind: 'DEVICE', id: 'device-a' });

  const list = await app.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['cache-control'], 'private, no-store');
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: list });
  assert.equal(list.json().safeZones.length, 1);
});

test('safe-zone HTTP validation enforces canonical bytes, repository epoch bounds, and opaque-only fields', async () => {
  const app = buildApp();
  const headers = { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' };
  const valid = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
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
    { keyEpoch: 0x1_0000_0000 },
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

test('safe-zone repository validation errors are returned as client errors', async () => {
  const createApp = buildApp('OWNER', 'ALLOW', {
    async create() { throw new SafeZoneError('INVALID_INPUT'); },
  });
  const payload = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
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
    recipientEndpointId: 'device-a',
    ...payload,
    revision: 1,
    deliveryState: 'PENDING_OFFLINE',
  });
  const update = await updateApp.inject({
    method: 'PATCH',
    url: '/api/parent/families/family-a/safe-zones/zone-a',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' },
    payload: { ciphertextB64: 'BAUG' },
  });
  assert.equal(update.statusCode, 400);
});

test('safe-zone update and delete re-authorize the stored recipient endpoint', async () => {
  const app = buildApp();
  app.safeZoneZones.set('zone-a', { zoneId: 'zone-a', familyId: 'family-a', recipientEndpointId: 'device-b' });

  const update = await app.inject({ method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { ciphertextB64: 'BAUG' } });
  assert.equal(update.statusCode, 404);
  recordParentRouteScenario({ method: 'PATCH', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'safe_zones_update_wrong_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: update });

  const remove = await app.inject({ method: 'DELETE', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' } });
  assert.equal(remove.statusCode, 404);
  recordParentRouteScenario({ method: 'DELETE', route: SAFE_ZONE_DETAIL_ROUTE, scenarioId: 'safe_zones_delete_wrong_recipient_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 404, response: remove });

  app.safeZoneZones.set('zone-a', { zoneId: 'zone-a', familyId: 'family-a', recipientEndpointId: 'device-a' });
  const allowedUpdate = await app.inject({ method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { ciphertextB64: 'BAUG' } });
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
            recipientEndpointId: 'device-a',
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
          ...(method === 'PATCH' ? { payload: { ciphertextB64: 'BAUG' } } : {}),
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
          recipientEndpointId: 'device-a',
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
        ...(method === 'PATCH' ? { payload: { ciphertextB64: 'BAUG' } } : {}),
      });
      assert.equal(response.statusCode, 403, `${method} ${zoneId} after in-flight membership revocation`);
      assert.equal(listReads, 1);
      assert.equal(app.safeZoneAuthorizationRequests.length, 0);
    }
  }
});

test('safe-zone Parent membership allows reads for Viewer and mutations only for Administrator', async () => {
  const owner = await buildApp('OWNER').inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(owner.statusCode, 200);

  const administrator = await buildApp('ADMINISTRATOR').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(administrator.statusCode, 201);

  const viewerRead = await buildApp('VIEWER').inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(viewerRead.statusCode, 200);
  recordParentRouteScenario({ method: 'GET', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_read_viewer_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response: viewerRead });
  const viewerMutation = await buildApp('VIEWER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
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
    payload: { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(app.safeZoneZones.size, 0);
  assert.equal(app.safeZoneAuthorizationRequests.length, 1);
});

test('safe-zone mutation requires a verified device bearer and rejects a mismatched legacy actor header', async () => {
  const app = buildApp('OWNER');
  const payload = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
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

test('client-supplied device identity cannot grant Parent membership authority', async () => {
  const app = buildApp('VIEWER');
  const opaquePayload = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const legitimate = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a', 'x-pca-actor-device-id': 'administrator-device' },
    payload: opaquePayload,
  });
  assert.equal(legitimate.statusCode, 403);
  recordParentRouteScenario({ method: 'POST', route: SAFE_ZONES_ROUTE, scenarioId: 'safe_zones_create_client_device_identity_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response: legitimate });
});
