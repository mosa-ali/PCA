// PCA-NFR-064 (Writer65): proves the committed
// backend/src/sdkDisclosure/thirdPartySdks.generated.ts is NOT stale
// relative to the real dependency manifests (drift check, mirrors
// schema-snapshot.mjs's "generate and diff" convention), and that the
// public GET /sdk-disclosure route actually serves it.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { computeSdkDisclosure } from '../../scripts/sdkDisclosureCompute.mjs';
import { THIRD_PARTY_SDK_DISCLOSURE } from '../../dist/sdkDisclosure/thirdPartySdks.generated.js';
import { registerSdkDisclosureRoutes } from '../../dist/http/routes/sdkDisclosureRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('DRIFT CHECK: the committed generated disclosure file exactly matches what the generator would produce right now from the real manifests', async () => {
  const fresh = await computeSdkDisclosure(repoRoot);
  assert.deepEqual(THIRD_PARTY_SDK_DISCLOSURE.surfaces, fresh.surfaces, 'thirdPartySdks.generated.ts is STALE -- run `node backend/scripts/generateSdkDisclosure.mjs` and commit the result');
});

test('the disclosure genuinely reflects the real, current dependency set -- fastify and mysql2 are present (backend), no fabricated/placeholder SDK names', () => {
  const backendNames = THIRD_PARTY_SDK_DISCLOSURE.surfaces.backend.map((s) => s.name);
  assert.ok(backendNames.includes('fastify'));
  assert.ok(backendNames.includes('mysql2'));
  // Nothing in this repository's real manifests is an ad/crash/push SDK today -- confirmed structurally, not merely asserted.
  const allNames = [...backendNames, ...THIRD_PARTY_SDK_DISCLOSURE.surfaces.platformAdminWeb.map((s) => s.name), ...THIRD_PARTY_SDK_DISCLOSURE.surfaces.android.map((s) => s.name)];
  for (const forbidden of ['admob', 'firebase-crashlytics', 'sentry', 'appsflyer', 'facebook']) {
    assert.ok(!allNames.some((n) => n.toLowerCase().includes(forbidden)), `unexpected SDK-like name matching "${forbidden}" in disclosure`);
  }
});

test('HTTP: GET /sdk-disclosure is public (no auth header) and serves the real generated disclosure', async () => {
  const app = Fastify({ logger: false });
  registerSdkDisclosureRoutes(app, { rateLimiter: createRateLimiter() });
  await app.ready();
  try {
    const response = await app.inject({ method: 'GET', url: '/sdk-disclosure' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.disclosureVersion, 1);
    assert.deepEqual(body.surfaces, THIRD_PARTY_SDK_DISCLOSURE.surfaces);
  } finally {
    await app.close();
  }
});
