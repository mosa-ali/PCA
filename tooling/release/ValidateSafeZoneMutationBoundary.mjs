import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const routePath = `${root}/backend/dist/http/routes/parentAccountRoutes.js`;
const migrationPath = `${root}/backend/migrations/0020_parent_preferences_safe_zones.sql`;
const requireFromBackend = createRequire(`${root}/backend/package.json`);
const Fastify = requireFromBackend('fastify');
const { RuntimeSyncAuthError } = await import(pathToFileURL(`${root}/backend/dist/runtime-sync/DeviceSessionService.js`).href);

const authHeaders = {
  cookie: 'pca_family_session=session-a; pca_family_csrf=csrf-a',
  authorization: 'Bearer devtoken-a',
  'x-pca-csrf-token': 'csrf-a',
};
const opaquePayload = {
  recipientEndpointId: 'device-b',
  ciphertextB64: 'AQID',
  nonceB64: 'AAECAwQFBgcICQoL',
  keyEpoch: 1,
};

function dependencies() {
  const zone = {
    zoneId: 'zone-a',
    familyId: 'family-a',
    recipientEndpointId: 'device-b',
    ciphertextB64: 'AQID',
    nonceB64: 'AAECAwQFBgcICQoL',
    keyEpoch: 1,
    revision: 1,
    deliveryState: 'PENDING_OFFLINE',
    createdAtUtc: '2026-01-01T00:00:00.000Z',
    updatedAtUtc: '2026-01-01T00:00:00.000Z',
  };
  const authorizationRequests = [];
  const dependencies = {
    parentAccountService: {
      async readSession(token) {
        return token === 'session-a' ? { accountId: 'account-a', familyId: 'family-a', emailVerified: true } : null;
      },
    },
    parentPreferenceRepository: {
      async get() { return null; },
      async upsert() { return null; },
    },
    safeZoneRepository: {
      async list(familyId) { return familyId === 'family-a' ? [zone] : []; },
      async create(input) { return { ...zone, ...input, zoneId: 'zone-created' }; },
      async update(_familyId, _zoneId, patch) { return { ...zone, ...patch, revision: 2 }; },
      async remove() { return true; },
    },
    safeZonePolicyAuthorizer: {
      async authorize(request) {
        authorizationRequests.push(request);
        if (request.targetScope.kind === 'FAMILY') return { verdict: 'ALLOW' };
        return request.targetScope.id === 'device-a'
          ? { verdict: 'ALLOW' }
          : { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      },
    },
    // SECURITY (actor-identity binding): mirrors
    // backend/test/parentaccount/preferencesSafeZonesRoute.test.mjs's stub
    // -- the mutation-boundary route file under test now requires a
    // verified DeviceSessionService session (Authorization: Bearer
    // <token>), not the legacy x-pca-actor-device-id header alone.
    deviceSessionService: {
      async requireActorDeviceInFamily(rawToken, expectedFamilyId) {
        if (rawToken !== 'devtoken-a' || expectedFamilyId !== 'family-a') {
          throw new RuntimeSyncAuthError('UNAUTHORIZED');
        }
        return { deviceId: 'device-a', familyId: 'family-a' };
      },
    },
  };
  dependencies.authorizationRequests = authorizationRequests;
  return dependencies;
}

async function runMutatedRoute(mutatedSource, request, mutationId) {
  const mutationPath = routePath.replace('parentAccountRoutes.js', `parentAccountRoutes.${mutationId}.js`);
  await writeFile(mutationPath, mutatedSource, 'utf8');
  try {
    const { registerParentAccountRoutes } = await import(`${pathToFileURL(mutationPath).href}?mutation=${Date.now()}-${Math.random()}`);
    const app = Fastify();
    const deps = dependencies();
    registerParentAccountRoutes(app, deps);
    const response = await app.inject(request);
    await app.close();
    return { response, authorizationRequests: deps.authorizationRequests };
  } finally {
    await unlink(mutationPath);
  }
}

const originalRoute = await readFile(routePath, 'utf8');
const originalMigration = await readFile(migrationPath, 'utf8');
const mutants = [];

const familyTargetMutant = originalRoute.replace(
  "{ kind: 'DEVICE', id: body.recipientEndpointId }",
  "{ kind: 'FAMILY', id: session.familyId }",
);
assert.notEqual(familyTargetMutant, originalRoute, 'family-target mutation was not applied');
mutants.push({
  id: 'POST_RECIPIENT_FAMILY_SCOPE_BYPASS',
  run: async () => {
    const result = await runMutatedRoute(familyTargetMutant, {
      method: 'POST',
      url: '/api/parent/families/family-a/safe-zones',
      headers: authHeaders,
      payload: opaquePayload,
    }, 'post-family-target');
    return { killed: result.response.statusCode !== 403, observedStatus: result.response.statusCode, observedBody: result.response.body, authorizationRequests: result.authorizationRequests };
  },
});

const existingTargetMutant = originalRoute.replaceAll(
  "{ kind: 'DEVICE', id: existing.recipientEndpointId }",
  "{ kind: 'FAMILY', id: session.familyId }",
);
assert.notEqual(existingTargetMutant, originalRoute, 'existing-recipient mutation was not applied');
mutants.push({
  id: 'PATCH_EXISTING_RECIPIENT_FAMILY_SCOPE_BYPASS',
  run: async () => {
    const result = await runMutatedRoute(existingTargetMutant, {
      method: 'PATCH',
      url: '/api/parent/families/family-a/safe-zones/zone-a',
      headers: authHeaders,
      payload: { ciphertextB64: 'BAUG' },
    }, 'patch-existing-target');
    return { killed: result.response.statusCode !== 403, observedStatus: result.response.statusCode, observedBody: result.response.body, authorizationRequests: result.authorizationRequests };
  },
});

const safeZoneSection = originalMigration.slice(originalMigration.indexOf('CREATE TABLE safe_zones'));
mutants.push({
  id: 'MIGRATION_PLAINTEXT_ENABLED_COLUMN',
  run: async () => ({
    killed: /\benabled\s+TINYINT\b/.test(`${safeZoneSection}\n  enabled TINYINT(1) NOT NULL`),
  }),
});

const results = [];
for (const mutant of mutants) {
  results.push({ id: mutant.id, ...(await mutant.run()) });
}
const survivors = results.filter((result) => !result.killed).map((result) => result.id);
const output = { mutationScope: 'SAFE_ZONE_PRIVACY_AND_RECIPIENT_AUTHORIZATION', results, survivors, validMutationSurvivors: survivors.length };
console.log(JSON.stringify(output));
if (survivors.length > 0) process.exitCode = 1;
