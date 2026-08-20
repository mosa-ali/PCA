import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { SafeZoneError } from '../../dist/location/SafeZoneRepository.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';

// Stub DeviceSessionService: proves the actor-identity-binding LAYER itself
// (session token -> verified deviceId/familyId, cross-checked against the
// caller's own already-authenticated family), independent of any
// TrustSetRoleResolver's own DENY-by-default posture -- see this file's
// spoofing-regression tests below, which run against a
// safeZonePolicyAuthorizer stub that ALLOWs (unlike production's
// UnavailableTrustSetRoleResolver) so a header-spoofing bypass would
// otherwise silently succeed here if the binding layer were broken.
const DEVICE_SESSIONS = new Map([
  ['devtoken-a', { deviceId: 'device-a', familyId: 'family-a' }],
  ['devtoken-b', { deviceId: 'device-b', familyId: 'family-a' }],
  ['devtoken-other-family', { deviceId: 'device-x', familyId: 'family-b' }],
]);

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
  const deviceSessionService = {
    async requireActorDeviceInFamily(rawToken, expectedFamilyId) {
      const identity = DEVICE_SESSIONS.get(rawToken);
      if (!identity) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      if (identity.familyId !== expectedFamilyId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      return identity;
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
    // Deliberately ALLOWs whatever actorDeviceId it's handed (unlike
    // production's UnavailableTrustSetRoleResolver, which denies
    // unconditionally) -- this proves the identity-binding layer itself
    // rejects spoofing, independent of the resolver's own posture.
    authorize({ operation, targetScope, actorDeviceId }) {
      this.authorizationRequests.push({ operation, targetScope, actorDeviceId });
      if (role === 'VIEWER') return { verdict: operation === 'VIEW_DASHBOARD' ? 'ALLOW_READ_ONLY' : 'DENY' };
      if (targetScope.kind === 'DEVICE' && targetScope.id !== 'device-a') return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      return { verdict: 'ALLOW' };
    },
  };
  const app = Fastify();
  registerParentAccountRoutes(app, { parentAccountService, parentPreferenceRepository, safeZoneRepository, safeZonePolicyAuthorizer, deviceSessionService });
  app.safeZoneAuthorizationRequests = safeZonePolicyAuthorizer.authorizationRequests;
  app.safeZoneZones = zones;
  return app;
}

const authHeaders = { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', authorization: 'Bearer devtoken-a' };

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
  assert.deepEqual(app.safeZoneAuthorizationRequests.at(-1), { operation: 'EDIT_CHILD_POLICY', targetScope: { kind: 'DEVICE', id: 'device-a' }, actorDeviceId: 'device-a' });
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

// SECURITY REGRESSION (actor-identity binding): proves the server derives
// actorDeviceId from a VERIFIED device session, never the raw
// x-pca-actor-device-id header alone -- against the SAME buildApp() harness
// used above, whose safeZonePolicyAuthorizer stub ALLOWs whatever
// actorDeviceId it's handed (unlike production's
// UnavailableTrustSetRoleResolver, which denies unconditionally). If the
// identity-binding layer itself were broken (i.e. still trusting the raw
// header), every spoof attempt below would otherwise reach the
// authorizer as the ATTACKER's claimed identity and be silently ALLOWed.
test('actor identity is bound to a verified device session, not a client-supplied header', async () => {
  const app = buildApp('OWNER');
  const opaquePayload = { recipientEndpointId: 'device-a', ciphertextB64: 'AQID', nonceB64: 'AAECAwQFBgcICQoL', keyEpoch: 1 };

  // No Authorization bearer token at all -- the legacy header alone must
  // never be sufficient, even though it is well-formed and matches an
  // in-trust-set-shaped device id.
  const headerOnly = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', 'x-pca-actor-device-id': 'device-a' },
  });
  assert.equal(headerOnly.statusCode, 401);
  assert.equal(headerOnly.json().error, 'actor_device_session_required');

  // A verified session for device-a, but the legacy header claims a
  // DIFFERENT device (device-b, e.g. attempting to impersonate another
  // family member's/the Owner's device). Must be rejected outright, never
  // resolved by trusting either value silently.
  const mismatchedHeader = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', authorization: 'Bearer devtoken-a', 'x-pca-actor-device-id': 'device-b' },
  });
  assert.equal(mismatchedHeader.statusCode, 403);
  assert.equal(mismatchedHeader.json().error, 'actor_device_mismatch');

  // A verified session token, but for a device that belongs to a DIFFERENT
  // family (family-b) than the caller's own already-authenticated family
  // (family-a). Must be denied even though the token is otherwise valid.
  const crossFamilySession = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', authorization: 'Bearer devtoken-other-family' },
  });
  assert.equal(crossFamilySession.statusCode, 401);
  assert.equal(crossFamilySession.json().error, 'actor_device_session_invalid');

  // An unknown/forged session token must be denied.
  const forgedToken = await app.inject({
    method: 'GET',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', authorization: 'Bearer not-a-real-token' },
  });
  assert.equal(forgedToken.statusCode, 401);
  assert.equal(forgedToken.json().error, 'actor_device_session_invalid');

  // A genuinely verified session for device-a, matching family-a, and no
  // conflicting legacy header (or a matching one) succeeds and the
  // authorizer observes the SESSION-DERIVED deviceId.
  const legitimate = await app.inject({
    method: 'POST',
    url: '/api/parent/families/family-a/safe-zones',
    headers: { cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a', authorization: 'Bearer devtoken-a', 'x-pca-csrf-token': 'csrf-a' },
    payload: opaquePayload,
  });
  assert.equal(legitimate.statusCode, 201);
  assert.equal(app.safeZoneAuthorizationRequests.at(-1).actorDeviceId, 'device-a');
});
