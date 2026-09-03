// Regression guard for the API half of the "no iOS host app ships" decision.
//
// parent-web's DeviceEnrollmentPanel.tsx removed the `<option value="IOS">`
// from the enrollment platform picker, but POST /v1/families/:familyId/
// invitations still minted a real, redeemable enrollment token + QR payload
// for platform=IOS to any authenticated, authorized caller. Removing a UI
// option is not an access-control change: a direct API call still produced
// a working credential for an app that exists on no store.
//
// These tests pin BOTH halves of the fix:
//   1. platform=IOS is refused and NO invitation row / token is created.
//   2. platform=ANDROID is entirely unaffected and still gets a token.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerInvitationRoutes } from '../../dist/http/routes/invitationRoutes.js';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';

const FAMILY = 'family-ios-gate-1';
const ACCOUNT = 'acct-ios-gate-1';
const SESSION_TOKEN = 'session-ios-gate-1';
const T0 = new Date('2026-01-07T09:00:00.000Z');

function buildApp() {
  const repository = createInMemoryInvitationRepository();
  const invitationService = new InvitationService(repository, () => T0);

  // Minimal structural stand-ins: these routes' auth/authz preHandlers are
  // exercised in depth by their own suites -- here they must simply pass, so
  // that a rejection observed below is unambiguously the platform gate and
  // not an auth artifact.
  const authService = {
    async validateSession(rawToken) {
      if (rawToken !== SESSION_TOKEN) throw new Error('unauthorized');
      return ACCOUNT;
    },
  };
  const authzService = {
    async authorize() {
      /* authorized */
    },
  };

  const rateLimiter = createRateLimiter();
  const app = Fastify();
  registerInvitationRoutes(app, {
    invitationService,
    authService,
    authzService,
    rateLimiter,
    authAttemptLimiter: async () => {},
  });
  return { app, repository };
}

function createBody(overrides = {}) {
  return {
    platform: 'ANDROID',
    requestedProtectionMode: 'ANDROID_STANDARD',
    childProfileId: 'child-1',
    ageUxTier: 'YOUNG_CHILD',
    initialPolicyProfile: 'BALANCED',
    ...overrides,
  };
}

function post(app, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/families/${FAMILY}/invitations`,
    headers: { authorization: `Bearer ${SESSION_TOKEN}`, 'content-type': 'application/json' },
    payload: body,
  });
}

test('platform=IOS is refused: no enrollment token is minted while no iOS host app ships', async (t) => {
  const { app, repository } = buildApp();
  t.after(() => app.close());

  const response = await post(app, createBody({ platform: 'IOS', requestedProtectionMode: 'IOS_STANDARD' }));

  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.equal(payload.error, 'invalid_request');
  // Distinguishable from a malformed request, so a caller can tell
  // "unavailable" from "you sent garbage" -- same `code` sub-field shape
  // this route already uses for its 403 capacity refusals.
  assert.equal(payload.code, 'PLATFORM_ENROLLMENT_UNAVAILABLE');
  // The whole point: no credential leaves the server.
  assert.equal(payload.rawInvitationToken, undefined);
  assert.deepEqual(await repository.listForFamily(FAMILY), []);
});

test('platform=IOS is refused for every otherwise-valid protection mode', async (t) => {
  const { app, repository } = buildApp();
  t.after(() => app.close());

  for (const requestedProtectionMode of ['IOS_STANDARD', 'ANDROID_STANDARD', 'ANDROID_PROTECTED']) {
    const response = await post(app, createBody({ platform: 'IOS', requestedProtectionMode }));
    assert.equal(response.statusCode, 400, `expected 400 for IOS/${requestedProtectionMode}`);
    assert.equal(response.json().rawInvitationToken, undefined);
  }
  assert.deepEqual(await repository.listForFamily(FAMILY), []);
});

test('platform=ANDROID still succeeds and still returns a usable enrollment token', async (t) => {
  const { app, repository } = buildApp();
  t.after(() => app.close());

  const response = await post(app, createBody());

  assert.equal(response.statusCode, 201);
  const payload = response.json();
  assert.equal(payload.platform, 'ANDROID');
  assert.equal(payload.requestedProtectionMode, 'ANDROID_STANDARD');
  assert.equal(typeof payload.rawInvitationToken, 'string');
  assert.ok(payload.rawInvitationToken.length > 0);
  assert.equal(payload.status, 'CREATED');

  const persisted = await repository.listForFamily(FAMILY);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].platform, 'ANDROID');
});

test('ANDROID_PROTECTED is also unaffected by the iOS gate', async (t) => {
  const { app } = buildApp();
  t.after(() => app.close());

  const response = await post(app, createBody({ requestedProtectionMode: 'ANDROID_PROTECTED' }));
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().requestedProtectionMode, 'ANDROID_PROTECTED');
});

test('an unknown platform is still the plain malformed-request rejection, with no unavailability code', async (t) => {
  const { app } = buildApp();
  t.after(() => app.close());

  const response = await post(app, createBody({ platform: 'WINDOWS' }));
  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.equal(payload.error, 'invalid_request');
  assert.equal(payload.code, undefined);
});
