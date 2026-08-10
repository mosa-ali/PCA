import pg from 'pg';

let pool: pg.Pool | null = null;

function getConnectionString(): string {
  const connectionString = process.env.PCA_DATABASE_URL;
  if (!connectionString) throw new Error('PCA_DATABASE_URL is required for PostgreSQL persistence.');
  return connectionString;
}

export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: getConnectionString() });
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

/** Postgres SQLSTATE 23505 = unique_violation. */
export function isUniqueViolation(error: unknown): error is { code: '23505'; constraint?: string } {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

/**
 * BEGIN/COMMIT/ROLLBACK wrapper. Every multi-statement atomic repository
 * operation (device+key creation, device+all-keys revocation, invitation
 * redemption, recovery compare-and-swap, release publish+pointer update,
 * rollback) must run through this rather than as independent statements.
 */
export async function runInTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
