// Regression tests for the migration runner's cross-process advisory lock.
//
// The defect: scripts/migrate.mjs took no lock at all, so two concurrent
// deploy tasks could both read schema_migrations, both see the same pending
// file, and both execute its DDL. MySQL DDL implicitly commits and is not
// rolled back as a unit (the runner's own header says so), so the result is
// migrations half-applied on top of each other with neither run recording
// the version.
//
// These are unit tests against a fake connection: they pin the SQL and the
// return-value handling, which is where the lock can silently fail (GET_LOCK
// returns 0 on timeout and NULL on error -- neither throws on its own).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS,
  MIGRATION_LOCK_NAME,
  MigrationLockError,
  acquireMigrationLock,
  releaseMigrationLock,
  withMigrationLock,
} from '../../scripts/migrationAdvisoryLock.mjs';

/** Stands in for a mysql2 connection: records queries, replays scripted results. */
function fakeConnection(results = []) {
  const queries = [];
  let index = 0;
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      const next = results[index++];
      if (typeof next === 'function') return next();
      // mysql2's own shape: [rows, fields].
      return [next ?? [{ acquired: 1 }], []];
    },
  };
}

test('acquiring the lock issues GET_LOCK with the namespaced name and the timeout', async () => {
  const connection = fakeConnection([[{ acquired: 1 }]]);

  const name = await acquireMigrationLock(connection);

  assert.equal(name, MIGRATION_LOCK_NAME);
  assert.equal(connection.queries.length, 1);
  assert.match(connection.queries[0].sql, /GET_LOCK\(\?, \?\)/);
  assert.deepEqual(connection.queries[0].params, [MIGRATION_LOCK_NAME, DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS]);
  // MySQL 5.7+ rejects a lock name over 64 characters outright.
  assert.ok(MIGRATION_LOCK_NAME.length <= 64);
});

test('NEGATIVE: GET_LOCK returning 0 (another runner holds it) refuses to proceed', async () => {
  const connection = fakeConnection([[{ acquired: 0 }]]);

  await assert.rejects(() => acquireMigrationLock(connection, { timeoutSeconds: 5 }), (error) => {
    assert.ok(error instanceof MigrationLockError);
    assert.match(error.message, /another migration run holds it/);
    return true;
  });
});

test('NEGATIVE: GET_LOCK returning NULL (lock could not be evaluated) refuses to proceed', async () => {
  const connection = fakeConnection([[{ acquired: null }]]);

  await assert.rejects(() => acquireMigrationLock(connection), (error) => {
    assert.ok(error instanceof MigrationLockError);
    assert.match(error.message, /could not be evaluated/);
    return true;
  });
});

test('NEGATIVE: an empty GET_LOCK result set is treated as failure, never as success', async () => {
  const connection = fakeConnection([[]]);

  await assert.rejects(() => acquireMigrationLock(connection), MigrationLockError);
});

test('a nonsensical timeout is rejected before any query is issued', async () => {
  const connection = fakeConnection();

  await assert.rejects(() => acquireMigrationLock(connection, { timeoutSeconds: -1 }), MigrationLockError);
  await assert.rejects(() => acquireMigrationLock(connection, { timeoutSeconds: 1.5 }), MigrationLockError);
  assert.equal(connection.queries.length, 0);
});

test('withMigrationLock runs the migration body only while holding the lock, and releases it', async () => {
  const connection = fakeConnection([[{ acquired: 1 }], [{ released: 1 }]]);
  const order = [];

  const result = await withMigrationLock(connection, async () => {
    order.push('body');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(order, ['body']);
  assert.deepEqual(
    connection.queries.map((entry) => entry.sql),
    ['SELECT GET_LOCK(?, ?) AS acquired', 'SELECT RELEASE_LOCK(?) AS released'],
  );
  assert.deepEqual(connection.queries[1].params, [MIGRATION_LOCK_NAME]);
});

test('withMigrationLock releases the lock even when the migration body throws', async () => {
  const connection = fakeConnection([[{ acquired: 1 }], [{ released: 1 }]]);

  await assert.rejects(
    () =>
      withMigrationLock(connection, async () => {
        throw new Error('migration blew up');
      }),
    /migration blew up/,
  );

  assert.match(connection.queries.at(-1).sql, /RELEASE_LOCK/);
});

test('NEGATIVE: the migration body never runs when the lock is not obtained', async () => {
  const connection = fakeConnection([[{ acquired: 0 }]]);
  let ran = false;

  await assert.rejects(
    () =>
      withMigrationLock(connection, async () => {
        ran = true;
      }),
    MigrationLockError,
  );

  assert.equal(ran, false, 'concurrent DDL is exactly the failure this lock exists to prevent');
  // No RELEASE_LOCK either -- releasing a lock this connection never held
  // would free the OTHER runner's lock out from under it.
  assert.deepEqual(
    connection.queries.map((entry) => entry.sql),
    ['SELECT GET_LOCK(?, ?) AS acquired'],
  );
});

test('a failing RELEASE_LOCK does not mask the migration outcome', async () => {
  const connection = fakeConnection([
    [{ acquired: 1 }],
    () => {
      throw new Error('connection already gone');
    },
  ]);

  const result = await withMigrationLock(connection, async () => 'applied');

  assert.equal(result, 'applied');
  assert.equal(await releaseMigrationLock(fakeConnection([[{ released: 1 }]])), true);
});

test('the migration runner actually wraps its run in the lock', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../scripts/migrate.mjs', import.meta.url), 'utf8');

  assert.match(source, /withMigrationLock\(/, 'migrate.mjs must take the advisory lock');
  const lockIndex = source.indexOf('withMigrationLock(');
  const applyIndex = source.indexOf('await connection.query(sql)');
  const appliedVersionsIndex = source.indexOf('await appliedVersions(connection)');
  assert.ok(applyIndex > lockIndex, 'DDL must be applied inside the lock');
  assert.ok(
    appliedVersionsIndex > lockIndex,
    'the schema_migrations read must be inside the lock too -- it is the "check" half of the check-then-act',
  );
});
