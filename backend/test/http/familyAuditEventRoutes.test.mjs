import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerFamilyAuditEventRoutes } from '../../dist/http/routes/familyAuditEventRoutes.js';
import { InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';
import { RuntimeSyncAuthError } from '../../dist/runtime-sync/DeviceSessionService.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-01-01T00:00:00.000Z');

const FAMILY = 'family-audit-http-1';
const OTHER_FAMILY = 'family-audit-http-other';
const OWNER_DEVICE = 'dev-owner';
const OTHER_DEVICE = 'dev-other';
const OWNER_DEVICE_TOKEN = 'device-session-owner';
const OTHER_FAMILY_DEVICE_TOKEN = 'device-session-other-family';

const deviceIdentities = new Map([
  [OWNER_DEVICE_TOKEN, { familyId: FAMILY, deviceId: OWNER_DEVICE }],
  [OTHER_FAMILY_DEVICE_TOKEN, { familyId: OTHER_FAMILY, deviceId: 'dev-other-family' }],
]);

function buildApp({
  ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW),
  role = 'ADMINISTRATOR',
  withDeviceSessionService = true,
} = {}) {
  const sessions = new Map([
    ['session-owner', { accountId: 'acct-owner', familyId: FAMILY }],
    ['session-other-owner', { accountId: 'acct-other-owner', familyId: OTHER_FAMILY }],
    ['session-no-family', { accountId: 'acct-no-family', familyId: null }],
  ]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
    async activeFamilyRole() { return role; },
  };
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, familyId) {
      const identity = deviceIdentities.get(token);
      if (!identity || identity.familyId !== familyId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      return identity;
    },
  };

  const app = Fastify();
  registerFamilyAuditEventRoutes(app, {
    parentAccountService,
    familyAuditEventLedger: ledger,
    ...(withDeviceSessionService ? { deviceSessionService } : {}),
  });
  return { app, ledger };
}

const ownerHeaders = { cookie: 'pca_family_session=session-owner' };
const ownerDeviceHeaders = { ...ownerHeaders, authorization: `Bearer ${OWNER_DEVICE_TOKEN}` };

after(async () => {
  await writeParentRouteScenarioReport();
});

test('active Parent and proof-of-possession device sessions receive only that device’s opaque envelopes', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  await ledger.record({
    envelopeId: 'env-owner-1',
    familyId: FAMILY,
    parentDeviceId: OWNER_DEVICE,
    keyEpoch: 4,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'b3BhcXVl',
    nonceB64: 'bm9uY2U',
  });
  await ledger.record({
    envelopeId: 'env-someone-else-1',
    familyId: FAMILY,
    parentDeviceId: OTHER_DEVICE,
    keyEpoch: 4,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'c2hvdWxkLW5vdC1hcHBlYXI',
    nonceB64: 'bm9uY2U',
  });
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: ownerDeviceHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    const body = response.json();
    assert.equal(body.envelopes.length, 1);
    assert.deepEqual(body.envelopes.map((entry) => entry.envelopeId), ['env-owner-1']);
    assert.equal(body.envelopes[0].encryptedPayloadB64, 'b3BhcXVl');
    // The route's own response shape check: no FamilyAuditRecord field
    // (actionType/targetScope/actorMemberId/reasonCategory/etc.) is ever
    // present -- only the opaque envelope fields.
    const keys = Object.keys(body.envelopes[0]).sort();
    assert.deepEqual(keys, ['encryptedPayloadB64', 'envelopeId', 'generatedAtUtc', 'keyEpoch', 'nonceB64']);

    const repeatedRead = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: ownerDeviceHeaders,
    });
    assert.equal(repeatedRead.statusCode, 200);
    assert.deepEqual(repeatedRead.json().envelopes.map((entry) => entry.envelopeId), ['env-owner-1'],
      'GET is repeatable and preserves the durable envelope ID; the ledger contract has no acknowledgement operation');
  } finally {
    await app.close();
  }
});

test('Parent cookie alone cannot read recipient-bound audit ciphertext', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let listCalls = 0;
  const listForParentDevice = ledger.listForParentDevice.bind(ledger);
  ledger.listForParentDevice = async (...args) => {
    listCalls += 1;
    return listForParentDevice(...args);
  };
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerHeaders });
    assert.equal(response.statusCode, 401);
    assert.equal(listCalls, 0, 'the ledger must not be queried without a verified device identity');
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_device_session_required', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response });
  } finally {
    await app.close();
  }
});

test('a valid device session from another family is denied before recipient lookup', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let listCalls = 0;
  const listForParentDevice = ledger.listForParentDevice.bind(ledger);
  ledger.listForParentDevice = async (...args) => {
    listCalls += 1;
    return listForParentDevice(...args);
  };
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: { ...ownerHeaders, authorization: `Bearer ${OTHER_FAMILY_DEVICE_TOKEN}` },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, 'unauthorized');
    assert.equal(listCalls, 0);
  } finally {
    await app.close();
  }
});

test('route composition without a device-session authority fails closed', async () => {
  const { app } = buildApp({ withDeviceSessionService: false });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: ownerDeviceHeaders,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'device_session_unavailable');
  } finally {
    await app.close();
  }
});

test('a family role outside Administrator/Viewer is denied before device or ledger lookup', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let deviceChecks = 0;
  const deviceSessionService = {
    async requireActorDeviceInFamily() {
      deviceChecks += 1;
      return { familyId: FAMILY, deviceId: OWNER_DEVICE };
    },
  };
  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: FAMILY }]]);
  const parentAccountService = {
    async readSession(token) { return sessions.get(token); },
    async activeFamilyRole() { return 'MEMBER'; },
  };
  const app = Fastify();
  registerFamilyAuditEventRoutes(app, { parentAccountService, familyAuditEventLedger: ledger, deviceSessionService });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: ownerDeviceHeaders,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(deviceChecks, 0);
  } finally {
    await app.close();
  }
});

test('a Parent session from another family cannot read this family’s queue', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: { cookie: 'pca_family_session=session-other-owner' },
    });
    // session-other-owner's own familyId (OTHER_FAMILY) never matches the :familyId path param (FAMILY).
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_cross_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(response.json().error, 'family_scope_forbidden');
  } finally {
    await app.close();
  }
});

test('no session cookie -> 401', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/audit-events` });
    assert.equal(response.statusCode, 401);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_requires_session', classification: 'EXPECTED_DENIAL', expectedStatus: 401, response });
    assert.equal(response.json().error, 'unauthorized');
  } finally {
    await app.close();
  }
});

test('an account with no family scope yet is rejected honestly, not treated as an empty family', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: { cookie: 'pca_family_session=session-no-family', authorization: 'Bearer dev-token-owner' },
    });
    assert.equal(response.statusCode, 403);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_no_family_denied', classification: 'EXPECTED_DENIAL', expectedStatus: 403, response });
    assert.equal(response.json().error, 'family_scope_required');
  } finally {
    await app.close();
  }
});

test('when familyAuditEventLedger is not supplied, the route registers nothing (mirrors registerFamilyMemberRoutes’ optional-feature convention)', async () => {
  const app = Fastify();
  registerFamilyAuditEventRoutes(app, {
    parentAccountService: { async readSession() { throw new Error('should never be called'); } },
  });
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/audit-events` });
    assert.equal(response.statusCode, 404);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_optional_route_absent', classification: 'OPTIONAL_ROUTE_ABSENT', expectedStatus: 404, response });
  } finally {
    await app.close();
  }
});
