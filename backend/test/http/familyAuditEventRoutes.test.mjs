import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerFamilyAuditEventRoutes } from '../../dist/http/routes/familyAuditEventRoutes.js';
import { InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';
import { recordParentRouteScenario, writeParentRouteScenarioReport } from '../helpers/parentRouteOutcomeCollector.mjs';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-01-01T00:00:00.000Z');

const FAMILY = 'family-audit-http-1';
const OTHER_FAMILY = 'family-audit-http-other';

function buildApp({ ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW) } = {}) {
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
    async activeFamilyRole() { return 'ADMINISTRATOR'; },
  };

  const app = Fastify();
  registerFamilyAuditEventRoutes(app, { parentAccountService, familyAuditEventLedger: ledger });
  return { app, ledger };
}

const ownerHeaders = { cookie: 'pca_family_session=session-owner' };

after(async () => {
  await writeParentRouteScenarioReport();
});

test('an active Parent session receives family-scoped opaque envelopes -- never plaintext', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  await ledger.record({
    envelopeId: 'env-owner-1',
    familyId: FAMILY,
    parentDeviceId: 'dev-owner',
    keyEpoch: 4,
    generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
    encryptedPayloadB64: 'b3BhcXVl',
    nonceB64: 'bm9uY2U',
  });
  await ledger.record({
    envelopeId: 'env-someone-else-1',
    familyId: FAMILY,
    parentDeviceId: 'dev-a-different-parent-device',
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
      headers: ownerHeaders,
    });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_owner_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
    const body = response.json();
    assert.equal(body.envelopes.length, 2);
    assert.deepEqual(body.envelopes.map((entry) => entry.envelopeId), ['env-owner-1', 'env-someone-else-1']);
    assert.equal(body.envelopes[0].encryptedPayloadB64, 'b3BhcXVl');
    // The route's own response shape check: no FamilyAuditRecord field
    // (actionType/targetScope/actorMemberId/reasonCategory/etc.) is ever
    // present -- only the opaque envelope fields.
    const keys = Object.keys(body.envelopes[0]).sort();
    assert.deepEqual(keys, ['encryptedPayloadB64', 'envelopeId', 'generatedAtUtc', 'keyEpoch', 'nonceB64']);
  } finally {
    await app.close();
  }
});

test('Parent session reads do not require an actor-device-session bearer token', async () => {
  const { app } = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerHeaders });
    assert.equal(response.statusCode, 200);
    recordParentRouteScenario({ method: 'GET', route: '/api/parent/families/:familyId/audit-events', scenarioId: 'audit_events_session_allow', classification: 'ALLOW_PROVEN', expectedStatus: 200, response });
  } finally {
    await app.close();
  }
});

test('a device from a different family cannot read this family’s queue', async () => {
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
