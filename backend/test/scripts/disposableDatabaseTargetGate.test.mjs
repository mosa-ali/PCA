import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * PCA-DW-E2E: the disposable-database gate in scripts/verify-mysql.mjs.
 *
 * That script CREATES SCHEMA in whatever database it is pointed at, so its
 * hostname allowlist is a real safety control, not ceremony. It previously
 * accepted only 127.0.0.1/localhost/mysql, which also made it impossible to
 * validate an authorized REMOTE disposable database.
 *
 * The allowlist was therefore not removed and no hostname was hardcoded.
 * A remote target must be declared twice, deliberately, AND carry TLS:
 *
 *   PCA_DISPOSABLE_REMOTE_DB_HOST  == the URL's host
 *   PCA_DISPOSABLE_REMOTE_DB_NAME  == the URL's database
 *   PCA_DATABASE_TLS               == REQUIRED
 *
 * Every one of those is load-bearing, and each is pinned below by removing it
 * on its own. All of these cases are refused BEFORE any network connection is
 * attempted, so none of them needs a database.
 */

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(BACKEND_ROOT, 'scripts', 'verify-mysql.mjs');

const REMOTE_HOST = 'example-disposable.mysql.database.azure.invalid';
const REMOTE_DB = 'disposable';
const REMOTE_URL = `mysql://u:p@${REMOTE_HOST}:3306/${REMOTE_DB}`;

/** Runs the gate and returns its combined output; it is expected to exit non-zero. */
function runGate(env) {
  try {
    execFileSync(process.execPath, [SCRIPT], {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', PCA_DATABASE_URL: REMOTE_URL, ...env },
      timeout: 60_000,
    });
    return { exited: 0, out: '' };
  } catch (error) {
    return { exited: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const FULLY_DECLARED = {
  PCA_DISPOSABLE_REMOTE_DB_HOST: REMOTE_HOST,
  PCA_DISPOSABLE_REMOTE_DB_NAME: REMOTE_DB,
  PCA_DATABASE_TLS: 'REQUIRED',
};

test('an undeclared remote host is refused', () => {
  const { exited, out } = runGate({
    PCA_DISPOSABLE_REMOTE_DB_HOST: '',
    PCA_DISPOSABLE_REMOTE_DB_NAME: '',
    PCA_DATABASE_TLS: '',
  });
  assert.notEqual(exited, 0);
  assert.match(out, /Refusing to run the disposable-database gate/);
  assert.match(out, /no remote disposable environment has been declared/);
});

test('a declared host that does not match the URL is refused', () => {
  const { exited, out } = runGate({ ...FULLY_DECLARED, PCA_DISPOSABLE_REMOTE_DB_HOST: 'some-other-host.invalid' });
  assert.notEqual(exited, 0);
  assert.match(out, /declared remote host is/);
});

test('a declared database that does not match the URL is refused', () => {
  // The point of the second key: declaring a host must not hand over every
  // database on that server.
  const { exited, out } = runGate({ ...FULLY_DECLARED, PCA_DISPOSABLE_REMOTE_DB_NAME: 'some_other_database' });
  assert.notEqual(exited, 0);
  assert.match(out, /declared remote database is/);
});

test('a fully declared remote target without TLS is refused', () => {
  for (const value of ['', 'DISABLED', 'ssl-mode=REQUIRED']) {
    const { exited, out } = runGate({ ...FULLY_DECLARED, PCA_DATABASE_TLS: value });
    assert.notEqual(exited, 0, `PCA_DATABASE_TLS=${JSON.stringify(value)} must not satisfy the gate`);
    assert.match(out, /PCA_DATABASE_TLS=REQUIRED is mandatory|must be exactly "REQUIRED" or "DISABLED"/);
  }
});

test('a fully declared remote target passes the allowlist and announces itself', () => {
  // It then fails at the network layer, because this host does not exist --
  // which is the point: the gate stopped being the thing that refused it.
  const { exited, out } = runGate(FULLY_DECLARED);
  assert.notEqual(exited, 0, 'the unreachable host must still fail the run');
  assert.match(out, /DISPOSABLE REMOTE TARGET: host=/, 'the gate must announce a remote target loudly');
  assert.match(out, new RegExp(`database=${REMOTE_DB}`));
  assert.doesNotMatch(out, /Refusing to run the disposable-database gate/, 'the allowlist must no longer be the blocker');
  assert.match(out, /ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNREFUSED/, 'it must fail at the network, not at the gate');
});

test('local/Compose hosts need no declaration at all', () => {
  // Unchanged behaviour: the existing local workflow must not acquire new
  // required environment variables.
  const { out } = runGate({
    PCA_DATABASE_URL: 'mysql://root:nope@127.0.0.1:59999/pca_test',
    PCA_DISPOSABLE_REMOTE_DB_HOST: '',
    PCA_DISPOSABLE_REMOTE_DB_NAME: '',
    PCA_DATABASE_TLS: '',
  });
  assert.doesNotMatch(out, /Refusing to run the disposable-database gate/);
  assert.doesNotMatch(out, /DISPOSABLE REMOTE TARGET/);
});
