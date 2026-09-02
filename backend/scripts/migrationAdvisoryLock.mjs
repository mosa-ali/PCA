// Cross-process mutual exclusion for the migration runner.
//
// WHY: MySQL DDL is NOT transactional -- every CREATE/ALTER implicitly
// commits (see migrate.mjs's own header). Two deploy tasks starting at the
// same time therefore both read schema_migrations, both see the same
// pending file, and both start executing its DDL. The second one does not
// wait and does not roll back; it half-applies a migration on top of a
// half-applied migration, and neither run records the version, so the next
// deploy retries the wreckage. `schema_migrations` is a record of what was
// applied, never a lock.
//
// MySQL's GET_LOCK is the right primitive here and needs no schema of its
// own: it is a named, connection-scoped advisory lock held on the SERVER,
// so it is visible to every deploy task pointed at that database, and it is
// released automatically if the holding connection dies (a killed deploy
// task cannot wedge the next one). It is unaffected by the implicit commits
// DDL performs, which is exactly why a row lock or a transaction would not
// work for this.
//
// Callers must acquire on the SAME connection they run the migrations on --
// the lock belongs to the connection, not the session user or the database.

/**
 * Lock name. MySQL keys GET_LOCK on the exact string within a server
 * instance, so it is deliberately namespaced and kept well under the 64-
 * character limit MySQL 5.7+ enforces (a longer name is an error, not a
 * silent truncation).
 */
export const MIGRATION_LOCK_NAME = 'pca_schema_migration';

/**
 * How long a second deploy task waits for the first to finish before giving
 * up. Long enough to cover an ordinary migration run, short enough that a
 * genuinely stuck holder surfaces as a failed deploy rather than a hung one.
 */
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS = 120;

export class MigrationLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationLockError';
  }
}

function firstValue(result) {
  // mysql2 returns [rows, fields]; the runner may hand us either shape.
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row || typeof row !== 'object') return undefined;
  return Object.values(row)[0];
}

/**
 * Acquires the migration lock, or throws. Never returns having failed to
 * take it -- a caller that proceeded on a false return is the whole bug
 * this guards against.
 *
 * GET_LOCK returns 1 (acquired), 0 (timed out -- someone else holds it), or
 * NULL (error, e.g. a bad name or the connection was killed). Only 1 is a
 * success, and 0 and NULL are reported distinctly so an operator can tell
 * "another deploy is running" apart from "the lock call itself failed".
 */
export async function acquireMigrationLock(connection, options = {}) {
  const name = options.name ?? MIGRATION_LOCK_NAME;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_MIGRATION_LOCK_TIMEOUT_SECONDS;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0) {
    throw new MigrationLockError(`Invalid migration lock timeout: ${String(timeoutSeconds)}`);
  }

  const acquired = firstValue(await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [name, timeoutSeconds]));
  if (acquired === 1 || acquired === '1') return name;
  if (acquired === 0 || acquired === '0') {
    throw new MigrationLockError(
      `Could not acquire the migration lock '${name}' within ${timeoutSeconds}s -- another migration run holds it. ` +
        'Refusing to apply DDL concurrently: MySQL DDL is not transactional, so a second concurrent runner would ' +
        'half-apply migrations on top of the first. Wait for the other deploy to finish and re-run.',
    );
  }
  throw new MigrationLockError(
    `GET_LOCK('${name}', ${timeoutSeconds}) returned ${String(acquired)} -- the lock could not be evaluated. ` +
      'Refusing to apply DDL without mutual exclusion.',
  );
}

/**
 * Releases the lock. Best-effort by design: the process is about to close
 * the connection, and MySQL frees the lock on disconnect anyway, so a
 * failure here must never mask the migration's own outcome.
 */
export async function releaseMigrationLock(connection, name = MIGRATION_LOCK_NAME) {
  try {
    await connection.query('SELECT RELEASE_LOCK(?) AS released', [name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `fn` while holding the lock, releasing it on every exit path.
 * `fn` returning normally, throwing, or the process setting a failing exit
 * code all end with the lock released.
 */
export async function withMigrationLock(connection, fn, options = {}) {
  const name = await acquireMigrationLock(connection, options);
  try {
    return await fn();
  } finally {
    await releaseMigrationLock(connection, name);
  }
}
