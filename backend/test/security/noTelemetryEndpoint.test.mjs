// PCA-PRIV-002: this backend has no telemetry-ingestion endpoint by design
// (default-off requirement -- see docs/architecture privacy posture). No
// regression guard previously existed for that specific claim (unlike, say,
// the schema-privacy tests in test/db/schema-privacy.mysql.test.mjs, which
// guard the DB schema surface). This test guards the HTTP ROUTE surface
// instead: it statically scans every Fastify route registration under
// backend/src/http for a route path shaped like a telemetry/analytics
// ingestion endpoint, and fails the moment one appears that hasn't been
// explicitly reviewed onto ALLOWED_TELEMETRY_ROUTES below -- the same
// "flag it, then require an explicit, reviewed allowlist entry to keep it"
// discipline test/db/schema-privacy.mysql.test.mjs already uses for
// ALLOWED_KEY_COLUMNS. A future PR that genuinely wants an opt-in telemetry
// feature must touch this allowlist as part of that review, rather than
// silently shipping a route this test would otherwise have caught.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REAL_HTTP_ROOT = fileURLToPath(new URL('../../src/http', import.meta.url));

// Route-path substrings that would indicate a telemetry/analytics/usage-
// event INGESTION endpoint has been added -- i.e. a place a client could
// POST/PUT arbitrary behavioral events to this backend. Deliberately does
// NOT include generic words like "event" or "log" alone (too many benign
// false positives -- e.g. this codebase's own audit "event" types), only
// substrings specific enough to a telemetry-collection surface.
const PROHIBITED_ROUTE_TERMS = ['telemetry', 'analytics', 'beacon', '/collect', '/ingest', '/usage-report', '/metrics/report'];

// Reviewed exceptions, same discipline as schema-privacy.mysql.test.mjs's
// ALLOWED_KEY_COLUMNS. Empty today: PCA-PRIV-002 is that NO such route
// exists yet, consistent with the default-off telemetry requirement.
const ALLOWED_TELEMETRY_ROUTES = new Set();

async function listTsFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
  }
  await walk(root);
  return out;
}

/**
 * Extracts every Fastify route-registration path literal (`app.get(...)`,
 * `app.post(...)`, etc.) from a directory tree of .ts source files, and
 * flags any whose path matches a PROHIBITED_ROUTE_TERMS substring and is
 * not on ALLOWED_TELEMETRY_ROUTES. Pure static text scan -- no TypeScript
 * parsing, deliberately simple and auditable, matching the grep-based
 * spirit of schema-privacy.mysql.test.mjs.
 */
async function scanForTelemetryRoutes(root) {
  const violations = [];
  const files = await listTsFilesRecursive(root);
  const routeCallRegex = /\bapp\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(routeCallRegex)) {
      const [, method, routePath] = match;
      const lowerPath = routePath.toLowerCase();
      const hitTerm = PROHIBITED_ROUTE_TERMS.find((term) => lowerPath.includes(term));
      if (hitTerm && !ALLOWED_TELEMETRY_ROUTES.has(routePath)) {
        violations.push(`${file}: ${method.toUpperCase()} ${routePath} matches prohibited telemetry term "${hitTerm}"`);
      }
    }
  }
  return violations;
}

test('SECURITY GUARD: the REAL backend/src/http route tree currently has NO telemetry/analytics-ingestion endpoint', async () => {
  const violations = await scanForTelemetryRoutes(REAL_HTTP_ROOT);
  assert.deepEqual(violations, [], violations.join('; '));
});

test('SECURITY GUARD: a fixture route file registering an unreviewed telemetry-ingestion route IS caught (proves this guard is not vacuous)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pca-no-telemetry-'));
  try {
    await mkdir(join(root, 'routes'), { recursive: true });
    await writeFile(
      join(root, 'routes', 'fakeTelemetryRoutes.ts'),
      [
        "import type { FastifyInstance } from 'fastify';",
        'export function registerFakeRoutes(app: FastifyInstance): void {',
        "  app.post('/v1/telemetry/ingest', async (request, reply) => {",
        '    return reply.code(202).send({ accepted: true });',
        '  });',
        '}',
        '',
      ].join('\n'),
    );
    const violations = await scanForTelemetryRoutes(root);
    assert.equal(violations.length, 1, violations.join('; '));
    assert.match(violations[0], /telemetry/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SECURITY GUARD: a fixture route with an unrelated path (e.g. "/platform-admin/settings/market-mapping") is NOT flagged (no false positive)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pca-no-telemetry-'));
  try {
    await mkdir(join(root, 'routes'), { recursive: true });
    await writeFile(
      join(root, 'routes', 'benignRoutes.ts'),
      [
        "import type { FastifyInstance } from 'fastify';",
        'export function registerBenignRoutes(app: FastifyInstance): void {',
        "  app.get('/platform-admin/settings/market-mapping', async (_request, reply) => reply.code(200).send({}));",
        "  app.post('/v1/families/:familyId/delete-now', async (_request, reply) => reply.code(200).send({}));",
        '}',
        '',
      ].join('\n'),
    );
    const violations = await scanForTelemetryRoutes(root);
    assert.deepEqual(violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SECURITY GUARD: an allowlisted telemetry-shaped route is NOT flagged (reviewed-exception mechanism works)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pca-no-telemetry-'));
  ALLOWED_TELEMETRY_ROUTES.add('/v1/reviewed-opt-in-telemetry');
  try {
    await mkdir(join(root, 'routes'), { recursive: true });
    await writeFile(
      join(root, 'routes', 'reviewedRoutes.ts'),
      [
        "import type { FastifyInstance } from 'fastify';",
        'export function registerReviewedRoutes(app: FastifyInstance): void {',
        "  app.post('/v1/reviewed-opt-in-telemetry', async (_request, reply) => reply.code(202).send({}));",
        '}',
        '',
      ].join('\n'),
    );
    const violations = await scanForTelemetryRoutes(root);
    assert.deepEqual(violations, []);
  } finally {
    ALLOWED_TELEMETRY_ROUTES.delete('/v1/reviewed-opt-in-telemetry');
    await rm(root, { recursive: true, force: true });
  }
});
