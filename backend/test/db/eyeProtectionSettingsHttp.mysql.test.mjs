// FABLE-A008 / DW-W1-D: HTTP-level coverage for the eye-protection
// reminders GET/POST routes wired to the REAL (fixed)
// MySqlEyeProtectionSettingsRepository against a real MySQL database --
// not the InMemoryEyeProtectionSettingsRepository double that
// backend/test/http/eyeProtectionRoutes.test.mjs and
// backend/test/eyeprotection/EyeProtectionSettingsService.test.mjs already
// cover (and which was ALREADY correct; see MySqlEyeProtectionSettingsRepository.ts's
// own header comment). This file proves the full HTTP -> service -> real
// repository -> real MySQL chain no longer permits a cross-family read/IDOR
// or an existence oracle now that the repository's SELECT filters by
// family_id, and that the pre-existing write-authorization behaviour is
// unaffected by that change.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { registerEyeProtectionRoutes } from '../../dist/http/routes/eyeProtectionRoutes.js';
import { EyeProtectionSettingsService } from '../../dist/eyeprotection/EyeProtectionSettingsService.js';
import { MySqlEyeProtectionSettingsRepository } from '../../dist/eyeprotection/MySqlEyeProtectionSettingsRepository.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const T0 = new Date('2026-01-07T09:00:00.000Z');

function uniqueFamilyId(role) {
  return `family-eye-http-${role}-${randomUUID()}`;
}

function uniqueChildId() {
  return `child-eye-http-${randomUUID()}`;
}

/** A role resolver whose ONLY known family is `familyId` -- dev-owner is
 * OWNER, dev-viewer is VIEWER there, matching the convention already
 * established by test/http/eyeProtectionRoutes.test.mjs and
 * test/http/childPolicyRoutes.test.mjs. */
function trustedRoleResolver(familyId) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch({
    familyId,
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

function buildService(ownerFamilyId, childProfileFamilyMap) {
  const childProfileResolver = new StaticChildProfileMembershipResolver(childProfileFamilyMap);
  const authorization = new ParentActionAuthorizationService(
    trustedRoleResolver(ownerFamilyId),
    defaultFamilyRbacPolicyConfig,
    new InMemoryActionIdempotencyLedger(),
    () => T0,
    childProfileResolver,
  );
  const repository = new MySqlEyeProtectionSettingsRepository();
  const service = new EyeProtectionSettingsService(repository, authorization, () => T0);
  return { service, repository };
}

/** `sessionFamilyId` is the family the single fixed session cookie
 * ('session-owner') actually authenticates as -- in the cross-family tests
 * below this is the ATTACKER's own family (the URL segment they're allowed
 * to hit), never the real data owner's. */
function buildApp({ service, sessionFamilyId }) {
  const sessions = new Map([['session-owner', { accountId: 'acct-owner', familyId: sessionFamilyId }]]);
  const parentAccountService = {
    async readSession(token) {
      const session = sessions.get(token);
      if (!session) throw new Error('unauthorized');
      return session;
    },
  };
  const deviceTokens = new Map([
    ['dev-token-owner', { deviceId: 'dev-owner', familyId: sessionFamilyId }],
    ['dev-token-viewer', { deviceId: 'dev-viewer', familyId: sessionFamilyId }],
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
  registerEyeProtectionRoutes(app, { parentAccountService, deviceSessionService, eyeProtectionSettingsService: service, now: () => T0 });
  return { app };
}

const ownerAuthHeaders = { cookie: 'pca_family_session=session-owner; pca_family_csrf=csrf-a', 'x-pca-csrf-token': 'csrf-a' };

test('MySQL HTTP: GET returns the parent\'s own existing (non-default) setting for their own child', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const childProfileId = uniqueChildId();
  const { service, repository } = buildService(ownerFamilyId, new Map([[childProfileId, ownerFamilyId]]));
  await repository.update(ownerFamilyId, childProfileId, { remindersEnabled: true });
  const { app } = buildApp({ service, sessionFamilyId: ownerFamilyId });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${ownerFamilyId}/children/${childProfileId}/eye-protection`,
      headers: ownerAuthHeaders,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json().eyeProtection;
    assert.equal(body.remindersEnabled, true);
    assert.equal(body.childProfileId, childProfileId);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: GET for the parent\'s own child with no explicit setting yet returns the correct same-family default', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const childProfileId = uniqueChildId();
  const { service } = buildService(ownerFamilyId, new Map([[childProfileId, ownerFamilyId]]));
  const { app } = buildApp({ service, sessionFamilyId: ownerFamilyId });
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${ownerFamilyId}/children/${childProfileId}/eye-protection`,
      headers: ownerAuthHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().eyeProtection.remindersEnabled, false);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: a foreign-family child WITH a real saved setting does not leak it -- attacker sees only the safe default, never the real value or familyId', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const attackerFamilyId = uniqueFamilyId('attacker');
  const childProfileId = uniqueChildId();
  // Authorization is wired against the ATTACKER's family (the family whose
  // session is actually used for the request) -- exactly matching
  // production wiring, where one service instance is shared by every
  // family. childProfileId is deliberately absent from the membership map
  // from the attacker's point of view: the point of this test is that the
  // READ path (EyeProtectionSettingsService.get()) never even consults
  // authorization -- it must be the REPOSITORY's family_id filter alone
  // that keeps this safe.
  const { service, repository } = buildService(attackerFamilyId, new Map([[childProfileId, ownerFamilyId]]));
  // The real owner (family A) saves a real, non-default setting directly
  // through the repository (simulating a prior legitimate write by the
  // real owning family).
  await repository.update(ownerFamilyId, childProfileId, { remindersEnabled: true });

  const { app } = buildApp({ service, sessionFamilyId: attackerFamilyId });
  try {
    // The attacker hits THEIR OWN family's URL (passes the HTTP layer's
    // familySession() family-scope check) but supplies the real owner's
    // childProfileId -- the live cross-family IDOR this whole fix closes.
    const response = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${attackerFamilyId}/children/${childProfileId}/eye-protection`,
      headers: ownerAuthHeaders,
    });
    assert.equal(response.statusCode, 200, 'the route itself must not reject this -- the repository is the enforcement point');
    const body = response.json().eyeProtection;
    assert.equal(body.remindersEnabled, false, 'the true (foreign) remindersEnabled=true value must never leak over HTTP');
    assert.equal(body.childProfileId, childProfileId);
    assert.equal('familyId' in body, false, 'the response DTO must never expose any familyId at all (defense in depth beyond the repository fix)');

    // The real owner is unaffected and still sees their own real setting.
    const ownerView = await repository.get(ownerFamilyId, childProfileId);
    assert.equal(ownerView.remindersEnabled, true);
    assert.equal(ownerView.familyId, ownerFamilyId);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: a nonexistent childProfileId returns the identical 200/safe-default shape as a foreign-family one -- no existence oracle', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const attackerFamilyId = uniqueFamilyId('attacker');
  const foreignChildProfileId = uniqueChildId();
  const nonexistentChildProfileId = uniqueChildId();
  const { service, repository } = buildService(attackerFamilyId, new Map());
  await repository.update(ownerFamilyId, foreignChildProfileId, { remindersEnabled: true });

  const { app } = buildApp({ service, sessionFamilyId: attackerFamilyId });
  try {
    const foreignResponse = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${attackerFamilyId}/children/${foreignChildProfileId}/eye-protection`,
      headers: ownerAuthHeaders,
    });
    const nonexistentResponse = await app.inject({
      method: 'GET',
      url: `/api/parent/families/${attackerFamilyId}/children/${nonexistentChildProfileId}/eye-protection`,
      headers: ownerAuthHeaders,
    });

    assert.equal(foreignResponse.statusCode, 200);
    assert.equal(nonexistentResponse.statusCode, foreignResponse.statusCode);

    const foreignBody = foreignResponse.json().eyeProtection;
    const nonexistentBody = nonexistentResponse.json().eyeProtection;
    // Same shape/keys and same values for everything except childProfileId,
    // which trivially echoes back whatever the caller requested in BOTH
    // cases (not a leak -- the caller already supplied that id itself).
    assert.deepEqual(Object.keys(foreignBody).sort(), Object.keys(nonexistentBody).sort());
    assert.equal(foreignBody.remindersEnabled, nonexistentBody.remindersEnabled);
    assert.equal(foreignBody.updatedAtUtc, nonexistentBody.updatedAtUtc);
    assert.equal(foreignBody.remindersEnabled, false);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: zero foreign setting/family_id leakage across several distinct attacking families reading the same real child', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const childProfileId = uniqueChildId();
  const seed = buildService(ownerFamilyId, new Map());
  await seed.repository.update(ownerFamilyId, childProfileId, { remindersEnabled: true });

  for (const label of ['1', '2', '3']) {
    const attackerFamilyId = uniqueFamilyId(`attacker-${label}`);
    const { service, repository } = buildService(attackerFamilyId, new Map());
    const { app } = buildApp({ service, sessionFamilyId: attackerFamilyId });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/parent/families/${attackerFamilyId}/children/${childProfileId}/eye-protection`,
        headers: ownerAuthHeaders,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().eyeProtection.remindersEnabled, false, `attacker family ${attackerFamilyId} must never see the real remindersEnabled=true`);

      // Repository-level double-check that this attacker's OWN familyId
      // (never the real owner's) is what would back any further write.
      const asAttacker = await repository.get(attackerFamilyId, childProfileId);
      assert.equal(asAttacker.familyId, attackerFamilyId);
      assert.notEqual(asAttacker.familyId, ownerFamilyId);
    } finally {
      await app.close();
    }
  }
});

test('MySQL HTTP (no regression): an Owner can enable reminders through the REAL fixed repository -- authorized, durably written, and read back correctly', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const childProfileId = uniqueChildId();
  const { service, repository } = buildService(ownerFamilyId, new Map([[childProfileId, ownerFamilyId]]));
  const { app } = buildApp({ service, sessionFamilyId: ownerFamilyId });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${ownerFamilyId}/children/${childProfileId}/eye-protection`,
      headers: { ...ownerAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().eyeProtection.remindersEnabled, true);

    const stored = await repository.get(ownerFamilyId, childProfileId);
    assert.equal(stored.remindersEnabled, true);
    assert.equal(stored.familyId, ownerFamilyId);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP (no regression): a VIEWER still cannot edit the eye-protection setting through the REAL fixed repository -- NOT_AUTHORIZED, no write occurs', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const childProfileId = uniqueChildId();
  const { service, repository } = buildService(ownerFamilyId, new Map([[childProfileId, ownerFamilyId]]));
  const { app } = buildApp({ service, sessionFamilyId: ownerFamilyId });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${ownerFamilyId}/children/${childProfileId}/eye-protection`,
      headers: { ...ownerAuthHeaders, authorization: 'Bearer dev-token-viewer' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 403);
    const stored = await repository.get(ownerFamilyId, childProfileId);
    assert.equal(stored.remindersEnabled, false, 'no write should have happened');
  } finally {
    await app.close();
  }
});

test('MySQL HTTP (no regression): a childProfileId belonging to another family is still rejected for WRITES, real repository backing unchanged', async () => {
  const ownerFamilyId = uniqueFamilyId('owner');
  const foreignChildProfileId = uniqueChildId();
  // Membership map marks this child as belonging to a DIFFERENT family --
  // the authorization pre-check (unrelated to this fix) must still deny it.
  const { service, repository } = buildService(ownerFamilyId, new Map([[foreignChildProfileId, uniqueFamilyId('other')]]));
  const { app } = buildApp({ service, sessionFamilyId: ownerFamilyId });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/parent/families/${ownerFamilyId}/children/${foreignChildProfileId}/eye-protection`,
      headers: { ...ownerAuthHeaders, authorization: 'Bearer dev-token-owner' },
      payload: { remindersEnabled: true },
    });
    assert.equal(response.statusCode, 403);
    const stored = await repository.get(ownerFamilyId, foreignChildProfileId);
    assert.equal(stored.remindersEnabled, false);
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
