// Real-MySQL proof that the migration runner's advisory lock actually
// serializes two concurrent deploy tasks (D021).
//
// The unit tests in backend/test/tooling/migrationAdvisoryLock.test.mjs pin
// the SQL and the return-value handling against a fake connection. This one
// proves the thing that matters: with two genuinely separate connections --
// which is what two deploy tasks are -- the second cannot take the lock
// while the first holds it, and can the moment the first releases.
import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2/promise';
import {
  MigrationLockError,
  acquireMigrationLock,
  releaseMigrationLock,
  withMigrationLock,
} from '../../scripts/migrationAdvisoryLock.mjs';

const uri = process.env.PCA_MIGRATION_DATABASE_URL ?? process.env.PCA_DATABASE_URL;
if (!uri) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

// A name unique to this run, so the test can never collide with a real
// migration actually running against the same database.
const LOCK_NAME = `pca_test_migration_lock_${process.pid}`;

async function connect() {
  return mysql.createConnection({ uri, timezone: 'Z' });
}

test('MySQL: a second connection cannot take the migration lock while the first holds it', async () => {
  const first = await connect();
  const second = await connect();
  try {
    assert.equal(await acquireMigrationLock(first, { name: LOCK_NAME, timeoutSeconds: 5 }), LOCK_NAME);

    // Zero-second timeout: fail immediately rather than making the test wait.
    await assert.rejects(
      () => acquireMigrationLock(second, { name: LOCK_NAME, timeoutSeconds: 0 }),
      (error) => {
        assert.ok(error instanceof MigrationLockError);
        assert.match(error.message, /another migration run holds it/);
        return true;
      },
    );

    // ... and it becomes available again the moment the holder releases.
    assert.equal(await releaseMigrationLock(first, LOCK_NAME), true);
    assert.equal(await acquireMigrationLock(second, { name: LOCK_NAME, timeoutSeconds: 5 }), LOCK_NAME);
    await releaseMigrationLock(second, LOCK_NAME);
  } finally {
    await first.end();
    await second.end();
  }
});

test('MySQL: withMigrationLock releases on the way out, so the next deploy is not blocked', async () => {
  const first = await connect();
  const second = await connect();
  try {
    await withMigrationLock(first, async () => 'applied', { name: LOCK_NAME, timeoutSeconds: 5 });

    // If the release had been skipped this would time out and throw.
    assert.equal(await acquireMigrationLock(second, { name: LOCK_NAME, timeoutSeconds: 2 }), LOCK_NAME);
    await releaseMigrationLock(second, LOCK_NAME);
  } finally {
    await first.end();
    await second.end();
  }
});

test('MySQL: a killed deploy task cannot wedge the lock -- MySQL frees it on disconnect', async () => {
  const holder = await connect();
  await acquireMigrationLock(holder, { name: LOCK_NAME, timeoutSeconds: 5 });
  // Simulates the deploy task dying without ever calling RELEASE_LOCK.
  await holder.end();

  const next = await connect();
  try {
    assert.equal(await acquireMigrationLock(next, { name: LOCK_NAME, timeoutSeconds: 5 }), LOCK_NAME);
    await releaseMigrationLock(next, LOCK_NAME);
  } finally {
    await next.end();
  }
});
