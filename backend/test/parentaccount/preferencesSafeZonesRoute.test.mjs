import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { SafeZoneError } from '../../dist/location/SafeZoneRepository.js';

function buildApp(role = 'OWNER') {
  const sessions = new Map([
    ['session-a', { accountId: 'account-a', familyId: 'family-a', emailVerified: true }],
    ['session-b', { accountId: 'account-b', familyId: 'family-a', emailVerified: true }],
  ]);
  const preferences = new Map();
  const zones = new Map();
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
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
  const safeZonePolicyAuthorizer = {
    authorizationRequests: [],
    authorize({ operation, targetScope }) {
      this.authorizationRequests.push({ operation, targetScope });
      if (role === 'VIEWER') return { verdict: operation === 'VIEW_DASHBOARD' ? 'ALLOW_READ_ONLY' : 'DENY' };
      if (targetScope.kind === 'DEVICE' && targetScope.id !== 'device-a') return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      return { verdict: 'ALLOW' };
    },
  };
  const app = Fastify();
  registerParentAccountRoutes(app, { parentAccountService, parentPreferenceRepository, safeZoneRepository, safeZonePolicyAuthorizer });
  app.safeZoneAuthorizationRequests = safeZonePolicyAuthorizer.authorizationRequests;
  app.safeZoneZones = zones;
  return app;
}

const authHeaders = { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', 'x-pca-actor-device-id': 'device-a' };

test('preferences are account-scoped and mutations require matching CSRF', async () => {
  const app = buildApp();
  const initial = await app.inject({ method: 'GET', url: '/api/parent/preferences', headers: authHeaders });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().preferences.language, 'en');

  const blocked = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: authHeaders, payload: { language: 'ar' } });
  assert.equal(blocked.statusCode, 403);

  const changed = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { language: 'ar', emailAlertsEnabled: false } });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().preferences.language, 'ar');

  const other = await app.inject({ method: 'GET', url: '/api/parent/preferences', headers: { cookie: 'pca_family_session=session-b; pca_family_csrf=csrf-b' } });
  assert.equal(other.statusCode, 200);
  assert.equal(other.json().preferences.language, 'en');
  assert.equal(other.json().preferences.emailAlertsEnabled, true);

  const invalidDestination = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { emailDestination: 'not-an-email' } });
  assert.equal(invalidDestination.statusCode, 400);

  const destination = await app.inject({ method: 'PATCH', url: '/api/parent/preferences', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { emailDestination: 'parent@example.test' } });
  assert.equal(destination.statusCode, 200);
  assert.equal(destination.json().preferences.emailDestination, 'parent@example.test');
  assert.equal(destination.json().preferences.emailDestinationState, 'UNVERIFIED');
});

test('safe zones accept only opaque encrypted policy envelopes and preserve offline delivery state', async () => {
  const app = buildApp();
  const wrongFamily = await app.inject({ method: 'GET', url: '/api/parent/families/family-b/safe-zones', headers: authHeaders });
  assert.equal(wrongFamily.statusCode, 403);

  const opaquePayload = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };
  const noCsrf = await app.inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders, payload: opaquePayload });
  assert.equal(noCsrf.statusCode, 403);

  const plaintext = await app.inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { childProfileId: 'child-a', label: 'Home', latitude: 1, longitude: 2, radiusMeters: 100 } });
  assert.equal(plaintext.statusCode, 400);

  const created = await app.inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: opaquePayload });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(app.safeZoneAuthorizationRequests.at(-1), { operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'DEVICE', id: 'device-a' } });
  assert.equal(created.json().safeZone.deliveryState, 'PENDING_OFFLINE');
  assert.equal(created.json().safeZone.ciphertextB64, 'AQID');

  const list = await app.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().safeZones.length, 1);
});

test('safe-zone update and delete re-authorize the stored recipient endpoint', async () => {
  const app = buildApp();
  app.safeZoneZones.set('zone-a', { zoneId: 'zone-a', familyId: 'family-a', recipientEndpointId: 'device-b' });

  const update = await app.inject({ method: 'PATCH', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { ciphertextB64: 'BAUG' } });
  assert.equal(update.statusCode, 403);

  const remove = await app.inject({ method: 'DELETE', url: '/api/parent/families/family-a/safe-zones/zone-a', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' } });
  assert.equal(remove.statusCode, 403);
});

test('safe-zone family policy authorization allows Owner and Administrator, denies Viewer mutations', async () => {
  const owner = await buildApp('OWNER').inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(owner.statusCode, 200);

  const administrator = await buildApp('ADMINISTRATOR').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(administrator.statusCode, 201);

  const viewerRead = await buildApp('VIEWER').inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(viewerRead.statusCode, 200);
  const viewerMutation = await buildApp('VIEWER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(viewerMutation.statusCode, 403);

  const crossFamilyRecipient = await buildApp('OWNER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'device-b', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(crossFamilyRecipient.statusCode, 403);

  const unknownRecipient = await buildApp('OWNER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'unknown-device', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(unknownRecipient.statusCode, 403);

  const malformedRecipient = await buildApp('OWNER').inject({ method: 'POST', url: '/api/parent/families/family-a/safe-zones', headers: { ...authHeaders, 'x-pca-csrf-token': 'csrf-a' }, payload: { recipientEndpointId: 'not valid', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 } });
  assert.equal(malformedRecipient.statusCode, 400);

  const noAuthority = Fastify();
  const noAuthorityService = { async readSession() { return { accountId: 'account-a', familyId: 'family-a', emailVerified: true }; } };
  const noAuthorityRepository = { async list() { return []; }, async create() { throw new Error('unexpected'); }, async update() { throw new Error('unexpected'); }, async remove() { return false; } };
  registerParentAccountRoutes(noAuthority, { parentAccountService: noAuthorityService, safeZoneRepository: noAuthorityRepository });
  const unavailable = await noAuthority.inject({ method: 'GET', url: '/api/parent/families/family-a/safe-zones', headers: authHeaders });
  assert.equal(unavailable.statusCode, 503);
});
