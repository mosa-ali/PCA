import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { registerFamilyAuditEventRoutes } from '../../dist/http/routes/familyAuditEventRoutes.js';
import { encodeFamilyAuditEventCursor, InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';
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
  [OWNER_DEVICE_TOKEN, { familyId: FAMILY, deviceId: OWNER_DEVICE, dskKeyId: 'dsk-owner-1' }],
  [OTHER_FAMILY_DEVICE_TOKEN, { familyId: OTHER_FAMILY, deviceId: 'dev-other-family', dskKeyId: 'dsk-other-family-1' }],
]);

function buildApp({
  ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW),
  role = 'ADMINISTRATOR',
  withDeviceSessionService = true,
  withTrustSetRoleResolver = true,
  trustSetRoleResolver,
  deviceIdentityOverrides = new Map(),
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
    async activeFamilyRole() { return typeof role === 'function' ? role() : role; },
  };
  const deviceSessionService = {
    async requireActorDeviceInFamily(token, familyId) {
      const identity = deviceIdentityOverrides.get(token) ?? deviceIdentities.get(token);
      if (!identity || identity.familyId !== familyId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      return identity;
    },
  };
  const acceptedTrustSetRoleResolver = trustSetRoleResolver ?? {
    async resolveActor(familyId, deviceId, dskKeyId) {
      if (familyId !== FAMILY || deviceId !== OWNER_DEVICE || dskKeyId !== 'dsk-owner-1') return 'DEVICE_NOT_ACTIVE';
      return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 7, keyEpoch: 4 };
    },
  };

  const app = Fastify();
  registerFamilyAuditEventRoutes(app, {
    parentAccountService,
    familyAuditEventLedger: ledger,
    ...(withDeviceSessionService ? { deviceSessionService } : {}),
    ...(withTrustSetRoleResolver ? { trustSetRoleResolver: acceptedTrustSetRoleResolver } : {}),
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
  for (const [envelopeId, keyEpoch] of [['env-owner-stale', 3], ['env-owner-future', 5]]) {
    await ledger.record({
      envelopeId,
      familyId: FAMILY,
      parentDeviceId: OWNER_DEVICE,
      keyEpoch,
      generatedAtUtc: new Date('2026-01-01T00:00:00.000Z'),
      encryptedPayloadB64: 'c3RhbGUtb3ItZnV0dXJl',
      nonceB64: 'bm9uY2U',
    });
  }
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
    assert.equal(body.complete, true);
    assert.equal(body.nextCursor, null);
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

test('FamilyAudit pages are oldest-first and continue through stable same-timestamp ID ties', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  for (let index = 0; index < 1001; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- deterministic append order for one recipient feed.
    await ledger.record({
      envelopeId: `env-cap-${String(index).padStart(4, '0')}`,
      familyId: FAMILY,
      parentDeviceId: OWNER_DEVICE,
      keyEpoch: 4,
      generatedAtUtc: LEDGER_NOW,
      encryptedPayloadB64: 'Y2lwaGVydGV4dA==',
      nonceB64: 'bm9uY2U=',
    });
  }
  await ledger.record({ envelopeId: 'env-other-device', familyId: FAMILY, parentDeviceId: OTHER_DEVICE,
    keyEpoch: 4, generatedAtUtc: LEDGER_NOW, encryptedPayloadB64: 'b3RoZXI=', nonceB64: 'bm9uY2U=' });
  await ledger.record({ envelopeId: 'env-other-epoch', familyId: FAMILY, parentDeviceId: OWNER_DEVICE,
    keyEpoch: 3, generatedAtUtc: LEDGER_NOW, encryptedPayloadB64: 'b3RoZXI=', nonceB64: 'bm9uY2U=' });
  const { app } = buildApp({ ledger });
  try {
    const first = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: ownerDeviceHeaders,
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.envelopes.length, 500);
    assert.equal(firstBody.complete, false);
    assert.equal(typeof firstBody.nextCursor, 'string');
    assert.deepEqual(firstBody.envelopes.map((entry) => entry.envelopeId),
      Array.from({ length: 500 }, (_, index) => `env-cap-${String(index).padStart(4, '0')}`));

    const second = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: ownerDeviceHeaders });
    const secondBody = second.json();
    assert.equal(second.statusCode, 200);
    assert.equal(secondBody.envelopes.length, 500);
    assert.equal(secondBody.complete, false);
    assert.equal(typeof secondBody.nextCursor, 'string');
    assert.deepEqual(secondBody.envelopes.map((entry) => entry.envelopeId),
      Array.from({ length: 500 }, (_, index) => `env-cap-${String(index + 500).padStart(4, '0')}`));

    const third = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events?cursor=${encodeURIComponent(secondBody.nextCursor)}`,
      headers: ownerDeviceHeaders });
    const thirdBody = third.json();
    assert.equal(third.statusCode, 200);
    assert.deepEqual(thirdBody.envelopes.map((entry) => entry.envelopeId), ['env-cap-1000']);
    assert.equal(thirdBody.complete, true);
    assert.equal(thirdBody.nextCursor, null);
  } finally {
    await app.close();
  }
});

test('an exactly full final FamilyAudit page requires an empty follow-up before complete', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  for (let index = 0; index < 500; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- deterministic full-page fixture.
    await ledger.record({ envelopeId: `env-exact-${String(index).padStart(3, '0')}`, familyId: FAMILY,
      parentDeviceId: OWNER_DEVICE, keyEpoch: 4, generatedAtUtc: LEDGER_NOW,
      encryptedPayloadB64: 'Y2lwaGVydGV4dA==', nonceB64: 'bm9uY2U=' });
  }
  const { app } = buildApp({ ledger });
  try {
    const first = await app.inject({ method: 'GET', url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    const firstBody = first.json();
    assert.equal(firstBody.envelopes.length, 500);
    assert.equal(firstBody.complete, false);
    assert.equal(typeof firstBody.nextCursor, 'string');
    const followUp = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: ownerDeviceHeaders });
    assert.deepEqual(followUp.json(), { envelopes: [], complete: true, nextCursor: null });
  } finally {
    await app.close();
  }
});

test('malformed, noncanonical, and unsupported-version cursors are rejected before ledger reads', async () => {
  const nonCanonical = Buffer.from('{"v":1, "generatedAtUtc":"2026-01-01T00:00:00.000Z","envelopeId":"env"}', 'utf8').toString('base64url');
  for (const cursor of ['!', 'bm90LWpzb24', nonCanonical,
    'eyJ2IjoyLCJnZW5lcmF0ZWRBdFV0YyI6IjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWiIsImVudmVsb3BlSWQiOiJlbnYifQ']) {
    const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
    let listCalls = 0;
    ledger.listForParentDevice = async () => { listCalls += 1; return []; };
    const { app } = buildApp({ ledger });
    try {
      const response = await app.inject({ method: 'GET',
        url: `/api/parent/families/${FAMILY}/audit-events?cursor=${encodeURIComponent(cursor)}`,
        headers: ownerDeviceHeaders });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: 'invalid_cursor' });
      assert.equal(listCalls, 0);
    } finally {
      await app.close();
    }
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

test('accepted Trust Set membership is bound to the live session DSK before recipient lookup', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let resolverArgs;
  const listCalls = [];
  const list = ledger.listForParentDevice.bind(ledger);
  ledger.listForParentDevice = async (...args) => { listCalls.push(args); return list(...args); };
  const { app } = buildApp({ ledger, trustSetRoleResolver: {
    async resolveActor(...args) {
      resolverArgs = args;
      return { familyId: args[0], deviceId: OWNER_DEVICE, dskKeyId: 'dsk-owner-1', role: 'OWNER', trustSetEpoch: 7, keyEpoch: 4 };
    },
  } });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`,
      headers: ownerDeviceHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(resolverArgs, [FAMILY, OWNER_DEVICE, 'dsk-owner-1']);
    assert.deepEqual(listCalls, [[FAMILY, OWNER_DEVICE, 4]]);
  } finally {
    await app.close();
  }
});

test('key rotation during the ledger read returns no ciphertext from the stale accepted epoch', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  await ledger.record({ envelopeId: 'env-owner-rotation-race', familyId: FAMILY,
    parentDeviceId: OWNER_DEVICE, keyEpoch: 4, generatedAtUtc: LEDGER_NOW,
    encryptedPayloadB64: 'c3RhbGU=', nonceB64: 'bm9uY2U' });
  const resolverCalls = [];
  const { app } = buildApp({ ledger, trustSetRoleResolver: {
    async resolveActor(...args) {
      resolverCalls.push(args);
      return { familyId: args[0], deviceId: OWNER_DEVICE, dskKeyId: 'dsk-owner-1', role: 'OWNER', trustSetEpoch: 7,
        keyEpoch: resolverCalls.length === 1 ? 4 : 5 };
    },
  } });
  try {
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'key_epoch_mismatch' });
    assert.equal(response.body.includes('c3RhbGU='), false);
    assert.equal(resolverCalls.length, 2);
  } finally {
    await app.close();
  }
});

test('session DSK rotation during the ledger read returns no ciphertext', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  await ledger.record({ envelopeId: 'env-owner-dsk-rotation-race', familyId: FAMILY,
    parentDeviceId: OWNER_DEVICE, keyEpoch: 4, generatedAtUtc: LEDGER_NOW,
    encryptedPayloadB64: 'c3RhbGU=', nonceB64: 'bm9uY2U' });
  let resolverCalls = 0;
  const { app } = buildApp({ ledger, trustSetRoleResolver: {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls += 1;
      return { familyId, deviceId, dskKeyId: resolverCalls === 1 ? dskKeyId : 'dsk-owner-rotated',
        role: 'OWNER', trustSetEpoch: 7, keyEpoch: 4 };
    },
  } });
  try {
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(response.body.includes('c3RhbGU='), false);
    assert.equal(resolverCalls, 2);
  } finally {
    await app.close();
  }
});

test('family projection changes during the ledger read return no ciphertext', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  await ledger.record({ envelopeId: 'env-owner-family-rotation-race', familyId: FAMILY,
    parentDeviceId: OWNER_DEVICE, keyEpoch: 4, generatedAtUtc: LEDGER_NOW,
    encryptedPayloadB64: 'c3RhbGU=', nonceB64: 'bm9uY2U' });
  let resolverCalls = 0;
  const { app } = buildApp({ ledger, trustSetRoleResolver: {
    async resolveActor(familyId, deviceId, dskKeyId) {
      resolverCalls += 1;
      return { familyId: resolverCalls === 1 ? familyId : `${familyId}-other`,
        deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 7, keyEpoch: 4 };
    },
  } });
  try {
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(response.body.includes('c3RhbGU='), false);
    assert.equal(resolverCalls, 2);
  } finally {
    await app.close();
  }
});

test('Parent role revoked during the ledger read returns no ciphertext', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  await ledger.record({ envelopeId: 'env-owner-role-revocation-race', familyId: FAMILY,
    parentDeviceId: OWNER_DEVICE, keyEpoch: 4, generatedAtUtc: LEDGER_NOW,
    encryptedPayloadB64: 'c3RhbGU=', nonceB64: 'bm9uY2U' });
  let roleChecks = 0;
  const { app } = buildApp({ ledger, role: () => ++roleChecks === 1 ? 'ADMINISTRATOR' : 'MEMBER' });
  try {
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: 'forbidden' });
    assert.equal(response.body.includes('c3RhbGU='), false);
    assert.equal(roleChecks, 2);
  } finally {
    await app.close();
  }
});

test('FamilyAudit delivery rejects ledger pages that escape recipient scope or violate keyset order', async (t) => {
  const validEnvelope = {
    envelopeId: 'env-boundary-1', familyId: FAMILY, parentDeviceId: OWNER_DEVICE, keyEpoch: 4,
    generatedAtUtc: LEDGER_NOW, encryptedPayloadB64: 'boundary-secret-ciphertext', nonceB64: 'bm9uY2U=',
  };
  const staleCursor = encodeFamilyAuditEventCursor({ generatedAtUtc: new Date(LEDGER_NOW.getTime() + 1000), envelopeId: 'env-cursor-after' });
  const cases = [
    { name: 'wrong family', rows: [{ ...validEnvelope, familyId: OTHER_FAMILY }] },
    { name: 'wrong recipient device', rows: [{ ...validEnvelope, parentDeviceId: OTHER_DEVICE }] },
    { name: 'wrong key epoch', rows: [{ ...validEnvelope, keyEpoch: 5 }] },
    { name: 'descending page', rows: [
      { ...validEnvelope, envelopeId: 'env-b', generatedAtUtc: new Date(LEDGER_NOW.getTime() + 1) },
      { ...validEnvelope, envelopeId: 'env-a', generatedAtUtc: LEDGER_NOW },
    ] },
    { name: 'row before cursor', rows: [validEnvelope], cursor: staleCursor },
  ];

  for (const scenario of cases) {
    const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
    ledger.listForParentDevice = async () => scenario.rows;
    const { app } = buildApp({ ledger });
    t.after(() => app.close());
    const cursorQuery = scenario.cursor ? `?cursor=${encodeURIComponent(scenario.cursor)}` : '';
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events${cursorQuery}`, headers: ownerDeviceHeaders });

    assert.equal(response.statusCode, 503, scenario.name);
    assert.deepEqual(response.json(), { error: 'family_audit_unavailable' }, scenario.name);
    assert.equal(response.body.includes('boundary-secret-ciphertext'), false, `${scenario.name} must not expose ciphertext`);
    assert.equal(response.body.includes('env-boundary-1'), false, `${scenario.name} must not expose envelope metadata`);
  }
});

test('ledger read failure returns a sanitized retryable response', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  ledger.listForParentDevice = async () => { throw new Error('database-password-or-row-content'); };
  const { app } = buildApp({ ledger });
  try {
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'family_audit_unavailable' });
    assert.equal(response.body.includes('database-password-or-row-content'), false);
  } finally {
    await app.close();
  }
});

test('Parent membership authority outage returns a sanitized retryable response before ledger access', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  let listCalls = 0;
  ledger.listForParentDevice = async () => { listCalls += 1; return []; };
  const { app } = buildApp({ ledger, role: () => { throw new Error('private membership storage failure'); } });
  try {
    const response = await app.inject({ method: 'GET',
      url: `/api/parent/families/${FAMILY}/audit-events`, headers: ownerDeviceHeaders });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: 'family_authority_unavailable' });
    assert.equal(response.body.includes('private membership storage failure'), false);
    assert.equal(listCalls, 0);
  } finally {
    await app.close();
  }
});

test('missing or unavailable accepted Trust Set authority fails closed before recipient lookup', async (t) => {
  for (const scenario of [
    { id: 'missing', withTrustSetRoleResolver: false, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { id: 'unavailable', trustSetRoleResolver: { async resolveActor() { throw new Error('store unavailable'); } }, expectedStatus: 503, expectedError: 'family_authority_unavailable' },
    { id: 'revoked', trustSetRoleResolver: { async resolveActor() { return 'DEVICE_NOT_ACTIVE'; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'wrong-family-projection', trustSetRoleResolver: { async resolveActor(familyId) { return { familyId: `${familyId}-other`, deviceId: OWNER_DEVICE, dskKeyId: 'dsk-owner-1', role: 'OWNER', trustSetEpoch: 7, keyEpoch: 4 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'unknown-role', trustSetRoleResolver: { async resolveActor(familyId) { return { familyId, deviceId: OWNER_DEVICE, role: 'SERVICE', trustSetEpoch: 7, keyEpoch: 4 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'child-device-role', trustSetRoleResolver: { async resolveActor(familyId) { return { familyId, deviceId: OWNER_DEVICE, role: 'CHILD', trustSetEpoch: 7, keyEpoch: 4 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'missing-role', trustSetRoleResolver: { async resolveActor(familyId) { return { familyId, deviceId: OWNER_DEVICE, trustSetEpoch: 7, keyEpoch: 4 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'resolved-dsk-mismatch', trustSetRoleResolver: { async resolveActor(familyId, deviceId) { return { familyId, deviceId, dskKeyId: 'another-device-key', role: 'OWNER', trustSetEpoch: 7, keyEpoch: 4 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'invalid-trust-set-epoch', trustSetRoleResolver: { async resolveActor(familyId) { return { familyId, deviceId: OWNER_DEVICE, role: 'OWNER', trustSetEpoch: Number.NaN, keyEpoch: 4 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    { id: 'invalid-key-epoch', trustSetRoleResolver: { async resolveActor(familyId) { return { familyId, deviceId: OWNER_DEVICE, role: 'OWNER', trustSetEpoch: 7, keyEpoch: 0 }; } }, expectedStatus: 403, expectedError: 'forbidden' },
    {
      id: 'dsk-mismatch',
      deviceIdentityOverrides: new Map([[OWNER_DEVICE_TOKEN, { familyId: FAMILY, deviceId: OWNER_DEVICE, dskKeyId: 'dsk-owner-rotated' }]]),
      expectedStatus: 403,
      expectedError: 'forbidden',
    },
  ]) {
    await t.test(scenario.id, async () => {
      const ledger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
      let listCalls = 0;
      const list = ledger.listForParentDevice.bind(ledger);
      ledger.listForParentDevice = async (...args) => { listCalls += 1; return list(...args); };
      const { app } = buildApp({ ledger, ...scenario });
      try {
        const response = await app.inject({
          method: 'GET',
          url: `/api/parent/families/${FAMILY}/audit-events`,
          headers: ownerDeviceHeaders,
        });
        assert.equal(response.statusCode, scenario.expectedStatus);
        assert.equal(response.json().error, scenario.expectedError);
        assert.equal(listCalls, 0, 'recipient ciphertext must not be queried for missing, stale, or unavailable membership');
      } finally {
        await app.close();
      }
    });
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
