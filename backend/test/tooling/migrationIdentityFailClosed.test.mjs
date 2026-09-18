// PCA-DW-W3-E (2026-09-16): scripts/migrate.mjs must refuse to silently
// fall back from PCA_MIGRATION_DATABASE_URL to the least-privilege
// application runtime credential (PCA_DATABASE_URL) in a production-sensitive
// runtime -- a migration must use a dedicated migration identity, never the
// runtime one. These are real subprocess executions of the actual script
// (not a reimplementation), asserting on its exit code/stderr, using the
// same isProductionSensitiveRuntime authority every other production-
// sensitive gate in this codebase uses (see src/runtime/environment.ts).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const scriptPath = new URL('../../scripts/migrate.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');

/**
 * Builds a clean child env: starts empty (not from process.env, which may
 * carry a real PCA_DATABASE_URL/PCA_MIGRATION_DATABASE_URL from this
 * repo's own test.db.env sourcing and would silently mask what this test
 * is actually exercising), keeps only PATH so `node` itself resolves, sets
 * NODE_ENV explicitly (never left "unset" via an empty-string placeholder
 * -- that's a distinct value from "the key does not exist" and this script
 * must behave identically for both), and applies the given overrides.
 * Omitting a URL key here means "genuinely absent", not "set to ''".
 */
function childEnv({ nodeEnv, databaseUrl, migrationDatabaseUrl, databaseTls }) {
  const env = { PATH: process.env.PATH };
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  if (databaseUrl !== undefined) env.PCA_DATABASE_URL = databaseUrl;
  if (migrationDatabaseUrl !== undefined) env.PCA_MIGRATION_DATABASE_URL = migrationDatabaseUrl;
  if (databaseTls !== undefined) env.PCA_DATABASE_TLS = databaseTls;
  return env;
}

async function runMigrate(overrides) {
  try {
    const { stdout, stderr } = await execFileP('node', [scriptPath], { env: childEnv(overrides) });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const UNREACHABLE_URL = 'mysql://someone:x@127.0.0.1:1/irrelevant';

test('production-sensitive runtime (NODE_ENV unset) with no PCA_MIGRATION_DATABASE_URL refuses to start', async () => {
  const result = await runMigrate({ nodeEnv: undefined, databaseUrl: UNREACHABLE_URL });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /PCA_MIGRATION_DATABASE_URL is required to run migrations in a production-sensitive runtime/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED/, 'must refuse before ever attempting a connection');
});

test('production-sensitive runtime (NODE_ENV=production) with no PCA_MIGRATION_DATABASE_URL refuses to start', async () => {
  const result = await runMigrate({ nodeEnv: 'production', databaseUrl: UNREACHABLE_URL });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /PCA_MIGRATION_DATABASE_URL is required to run migrations in a production-sensitive runtime/);
});

test('production-sensitive runtime WITH PCA_MIGRATION_DATABASE_URL set proceeds past the identity gate (fails later only on the actual connection attempt)', async () => {
  const result = await runMigrate({ nodeEnv: 'production', migrationDatabaseUrl: UNREACHABLE_URL, databaseTls: 'REQUIRED' });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /PCA_MIGRATION_DATABASE_URL is required/, 'the identity gate itself must not fire once the dedicated credential is set');
  assert.match(result.stderr, /ECONNREFUSED|ETIMEDOUT/, 'should fail only on the (deliberately unreachable) connection attempt, proving it got past the identity gate');
});

test('non-production-sensitive runtime (NODE_ENV=test) with no PCA_MIGRATION_DATABASE_URL is still allowed to fall back to PCA_DATABASE_URL', async () => {
  const result = await runMigrate({ nodeEnv: 'test', databaseUrl: UNREACHABLE_URL });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /PCA_MIGRATION_DATABASE_URL is required/, 'local/dev/test workflows that only set PCA_DATABASE_URL must keep working unchanged');
  assert.match(result.stderr, /ECONNREFUSED|ETIMEDOUT/);
});

test('non-production-sensitive runtime (NODE_ENV=development) with no PCA_MIGRATION_DATABASE_URL is still allowed to fall back to PCA_DATABASE_URL', async () => {
  const result = await runMigrate({ nodeEnv: 'development', databaseUrl: UNREACHABLE_URL });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stderr, /PCA_MIGRATION_DATABASE_URL is required/);
  assert.match(result.stderr, /ECONNREFUSED|ETIMEDOUT/);
});
