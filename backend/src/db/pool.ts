import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isProductionSensitiveRuntime } from '../runtime/environment.js';

/** Row shape used by every repository SELECT -- see `execute` below. */
type Row = RowDataPacket;

let pool: Pool | null = null;

function getConnectionUri(): string {
  const uri = process.env.PCA_DATABASE_URL;
  if (!uri) throw new Error('PCA_DATABASE_URL is required for MySQL persistence.');
  return uri;
}

export class DatabaseTlsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseTlsConfigurationError';
  }
}

/** What `mysql2` accepts for its `ssl` option: `false` means plaintext. */
export type DatabaseTlsOption = false | { minVersion: 'TLSv1.2'; rejectUnauthorized: true; ca?: string };

/**
 * PCA-DW-E2E F-1: resolve the database link's TLS posture EXPLICITLY.
 *
 * mysql2 does not negotiate TLS on its own. Its own `ConnectionConfig` reads
 * `this.ssl = typeof options.ssl === 'string' ? getSSLProfile(options.ssl) :
 * options.ssl || false` -- so an absent `ssl` option is exactly `false`, i.e.
 * a PLAINTEXT connection carrying the database password and every family
 * record on the wire. `getPool()` previously passed only a URI, so PCA's
 * database link had no TLS enforcement at all, and whether production traffic
 * was encrypted depended entirely on an operator remembering to embed a JSON
 * fragment in a URL.
 *
 * Worse, the obvious way to try was silently wrong: `?ssl-mode=REQUIRED` is
 * the standard MySQL client spelling, and mysql2 does not recognise it as an
 * option at all -- it prints "Ignoring invalid configuration option" to stderr
 * and connects in PLAINTEXT. A near-miss that fails OPEN is exactly the shape
 * that survives a review.
 *
 * So the posture is now named, not inferred:
 *
 *   PCA_DATABASE_TLS=REQUIRED  -> TLS 1.2+, certificate verification ON,
 *                                 optionally against PCA_DATABASE_TLS_CA.
 *   PCA_DATABASE_TLS=DISABLED  -> plaintext; REFUSED in a production-sensitive
 *                                 runtime, allowed only for the disposable
 *                                 local/Compose database, which serves no
 *                                 trusted certificate.
 *   unset                      -> plaintext in test/development; a hard error
 *                                 in a production-sensitive runtime.
 *   anything else              -> a hard error, always. A typo must never
 *                                 quietly mean "plaintext".
 *
 * There is deliberately NO "encrypt but skip verification" mode: an
 * unverified TLS session authenticates nothing and is not meaningfully better
 * than plaintext against an active attacker. A private or self-signed CA is
 * supported the honest way instead, by supplying it via PCA_DATABASE_TLS_CA.
 *
 * Note this option is passed to `mysql2` alongside the URI, and mysql2 merges
 * URI parameters only where the explicit option is FALSY (`if (options[key])
 * continue;`). A resolved REQUIRED object is truthy, so a connection string
 * can never downgrade it -- proven by test.
 */
export function resolveDatabaseTlsOption(env: NodeJS.ProcessEnv = process.env): DatabaseTlsOption {
  const raw = env.PCA_DATABASE_TLS;
  const productionSensitive = isProductionSensitiveRuntime(env);

  if (raw === undefined || raw === '') {
    if (productionSensitive) {
      throw new DatabaseTlsConfigurationError(
        'PCA_DATABASE_TLS must be set to "REQUIRED" in a production-sensitive runtime. ' +
          'Refusing to open a database connection whose encryption posture was never stated: ' +
          'mysql2 defaults to an unencrypted connection when no ssl option is supplied.',
      );
    }
    return false;
  }

  if (raw === 'DISABLED') {
    if (productionSensitive) {
      throw new DatabaseTlsConfigurationError(
        'PCA_DATABASE_TLS=DISABLED is refused in a production-sensitive runtime. ' +
          'Plaintext is only permitted for the disposable local/Compose database.',
      );
    }
    return false;
  }

  if (raw !== 'REQUIRED') {
    throw new DatabaseTlsConfigurationError(
      `PCA_DATABASE_TLS must be exactly "REQUIRED" or "DISABLED" (got ${JSON.stringify(raw)}). ` +
        'An unrecognized value must never be treated as either -- in particular it must never silently mean plaintext.',
    );
  }

  const ca = resolveTlsCertificateAuthority(env);
  return ca === undefined
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    : { minVersion: 'TLSv1.2', rejectUnauthorized: true, ca };
}

/** PCA_DATABASE_TLS_CA is either an inline PEM or a path to one. Anything unreadable is a hard error, never a silent fallback to the system trust store. */
function resolveTlsCertificateAuthority(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.PCA_DATABASE_TLS_CA;
  if (configured === undefined || configured === '') return undefined;
  if (configured.includes('-----BEGIN CERTIFICATE-----')) return configured;
  try {
    return readFileSync(configured, 'utf8');
  } catch (error) {
    throw new DatabaseTlsConfigurationError(
      `PCA_DATABASE_TLS_CA is set to ${JSON.stringify(configured)}, which is neither an inline PEM nor a readable file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Boot-time assertion, so a database TLS misconfiguration is a startup failure
 * rather than a surprise at the first query -- the same posture the production
 * email configuration already takes.
 */
export function assertDatabaseTlsConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  resolveDatabaseTlsOption(env);
}

/**
 * All connections operate in UTC (`timezone: 'Z'`): every DATETIME column
 * is written and read as a UTC instant, and application code never depends
 * on the MySQL server's local session timezone. This mirrors the previous
 * TIMESTAMPTZ contract without relying on MySQL's own (session-dependent)
 * TIMESTAMP type.
 */
export function getPool(): Pool {
  if (!pool) {
    const tls = resolveDatabaseTlsOption();
    pool = mysql.createPool({
      uri: getConnectionUri(),
      // mysql2's own types accept only `SslOptions | string | undefined`, while
      // its runtime reads `options.ssl || false` -- so `undefined` and `false`
      // are the same plaintext posture to it. The resolver returns an explicit
      // `false` because that is the honest, testable value for "plaintext was
      // chosen"; it is narrowed to `undefined` only here, at the boundary.
      ssl: tls === false ? undefined : tls,
      timezone: 'Z',
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      connectTimeout: 10_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * A repository-internal signal to abort the current transaction and report
 * a typed "soft failure" outcome (e.g. DEVICE_NOT_FOUND, DUPLICATE_KEY)
 * instead of an ordinary error. runInTransaction rolls the transaction back
 * on ANY throw, including this one; callers catch SoftFailure specifically
 * to map it back to the repository interface's outcome union.
 */
export class SoftFailure<T extends string> extends Error {
  readonly outcome: T;
  constructor(outcome: T) {
    super(`soft-failure:${outcome}`);
    this.name = 'SoftFailure';
    this.outcome = outcome;
  }
}

/** MySQL/InnoDB error 1062 (ER_DUP_ENTRY) = duplicate unique-key value. */
export function isDuplicateEntry(error: unknown): error is { code: 'ER_DUP_ENTRY'; errno: 1062 } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}

/**
 * MySQL/InnoDB error 1213 (ER_LOCK_DEADLOCK) -- InnoDB detected a lock
 * cycle and has ALREADY rolled back this transaction itself (this is not
 * something the caller needs to, or should, roll back again). Safe and
 * correct to retry the entire transaction attempt from scratch: no partial
 * state from the aborted attempt survives. Used by callers that hold more
 * than one keyed row lock within a single transaction (e.g.
 * MySqlEnvelopeAcceptanceTransaction), where a consistent lock-acquisition
 * order bounds deadlock risk but cannot eliminate it outright, since a
 * COMMIT vs. a fresh lock attempt on another connection can still interleave
 * mid-transaction.
 */
export function isDeadlock(error: unknown): error is { code: 'ER_LOCK_DEADLOCK'; errno: 1213 } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_LOCK_DEADLOCK';
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  insertId: number;
}

/**
 * Thin normalization over mysql2's `[rows] | [ResultSetHeader]` return
 * shape so repositories can use one uniform `{ rows, rowCount }` result
 * regardless of statement kind (SELECT vs INSERT/UPDATE/DELETE). MySQL has
 * no RETURNING clause, so INSERT/UPDATE call sites that previously read
 * `RETURNING *` now issue a follow-up SELECT by primary key instead.
 */
export async function execute<T>(
  conn: PoolConnection,
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  const [result] = await conn.query<Row[] | ResultSetHeader>(sql, params as unknown[]);
  if (Array.isArray(result)) {
    return { rows: result as unknown as T[], rowCount: result.length, insertId: 0 };
  }
  return { rows: [], rowCount: result.affectedRows, insertId: result.insertId };
}

/**
 * BEGIN/COMMIT/ROLLBACK wrapper. Every multi-statement atomic repository
 * operation (device+key creation, device+all-keys revocation, invitation
 * redemption, recovery compare-and-swap, release publish+pointer update,
 * rollback) must run through this rather than as independent statements.
 *
 * Every transaction explicitly runs at READ COMMITTED, not InnoDB's default
 * REPEATABLE READ. This is a genuine, independently-verified concurrency
 * difference from PostgreSQL (whose own default IS read committed) that a
 * naive "just use transactions" port would miss: every repository's
 * "UPDATE ... WHERE guard; if zero rows affected, SELECT again to find out
 * why" pattern (invitation redemption, device/key revocation, challenge
 * consumption, relay ack, recovery CAS, release publish) depends on that
 * disambiguating SELECT observing another transaction's just-committed
 * write. Under REPEATABLE READ, a transaction's snapshot is fixed at its
 * FIRST read, so a later plain SELECT in the same transaction can miss a
 * concurrent commit entirely (confirmed by a live failure of the
 * single-key-revocation concurrency test before this was added -- some
 * callers reread a pre-revocation NULL revoked_at). READ COMMITTED gives
 * every statement a fresh snapshot, matching the isolation level the
 * PostgreSQL implementation actually relied on. Row-level locking (SELECT
 * ... FOR UPDATE, or a unique-index INSERT collision) still provides the
 * serialization these operations need; only the "does an ordinary SELECT
 * see the latest commit" behavior changes.
 */
export async function runInTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}
