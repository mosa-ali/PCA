import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDatabaseTlsOption, assertDatabaseTlsConfiguration, DatabaseTlsConfigurationError } from '../../dist/db/pool.js';

/**
 * PCA-DW-E2E F-1: the database link's TLS posture must be stated explicitly and
 * fail closed.
 *
 * Why this exists, established by reading mysql2's own source rather than
 * assuming: `ConnectionConfig` resolves `this.ssl = typeof options.ssl ===
 * 'string' ? getSSLProfile(options.ssl) : options.ssl || false`. An absent
 * `ssl` option therefore means PLAINTEXT -- and `getPool()` used to pass only
 * a URI. Measured against a real MySQL 8.4.11 server, the three shapes an
 * operator might reach for behaved like this:
 *
 *   mysql://.../db                       -> ssl=false, Ssl_cipher "" (plaintext)
 *   mysql://.../db?ssl={"rejectUnauth..} -> TLS
 *   mysql://.../db?ssl-mode=REQUIRED     -> IGNORED with a stderr warning,
 *                                           ssl=false, PLAINTEXT
 *
 * The third is the standard MySQL client spelling and it fails OPEN. These
 * tests pin that PCA no longer depends on any of that.
 */

const PROD = { NODE_ENV: 'production' };
const DEV = { NODE_ENV: 'development' };
const TEST = { NODE_ENV: 'test' };

test('production-sensitive runtime with NO TLS posture stated fails closed', () => {
  assert.throws(() => resolveDatabaseTlsOption({ ...PROD }), DatabaseTlsConfigurationError);
  assert.throws(() => resolveDatabaseTlsOption({ ...PROD, PCA_DATABASE_TLS: '' }), DatabaseTlsConfigurationError);
  // An unrecognized NODE_ENV is production-like by isProductionSensitiveRuntime's
  // own contract, so it must fail closed too rather than fall through to dev.
  assert.throws(() => resolveDatabaseTlsOption({ NODE_ENV: 'staging' }), DatabaseTlsConfigurationError);
});

test('production-sensitive runtime REFUSES an explicit plaintext posture', () => {
  assert.throws(
    () => resolveDatabaseTlsOption({ ...PROD, PCA_DATABASE_TLS: 'DISABLED' }),
    DatabaseTlsConfigurationError,
  );
});

test('an unrecognized value is a hard error everywhere -- a typo never means plaintext', () => {
  for (const env of [PROD, DEV, TEST]) {
    for (const value of ['REQUIRE', 'required', 'true', '1', 'ssl-mode=REQUIRED', 'PREFERRED', 'VERIFY_CA']) {
      assert.throws(
        () => resolveDatabaseTlsOption({ ...env, PCA_DATABASE_TLS: value }),
        DatabaseTlsConfigurationError,
        `${JSON.stringify(value)} must be rejected under NODE_ENV=${env.NODE_ENV}, never treated as a posture`,
      );
    }
  }
});

test('REQUIRED resolves to verified TLS 1.2+', () => {
  const resolved = resolveDatabaseTlsOption({ ...PROD, PCA_DATABASE_TLS: 'REQUIRED' });
  assert.deepEqual(resolved, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
});

test('there is no "encrypt but do not verify" escape hatch', () => {
  const resolved = resolveDatabaseTlsOption({ ...PROD, PCA_DATABASE_TLS: 'REQUIRED', PCA_DATABASE_TLS_REJECT_UNAUTHORIZED: 'false' });
  assert.equal(resolved.rejectUnauthorized, true, 'verification must not be switchable off by any env var');
});

test('an inline PEM certificate authority is carried through', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const resolved = resolveDatabaseTlsOption({ ...PROD, PCA_DATABASE_TLS: 'REQUIRED', PCA_DATABASE_TLS_CA: pem });
  assert.equal(resolved.ca, pem);
  assert.equal(resolved.rejectUnauthorized, true);
});

test('an unreadable certificate authority fails closed rather than silently using system trust', () => {
  assert.throws(
    () =>
      resolveDatabaseTlsOption({
        ...PROD,
        PCA_DATABASE_TLS: 'REQUIRED',
        PCA_DATABASE_TLS_CA: 'C:/nonexistent/definitely-not-a-ca.pem',
      }),
    DatabaseTlsConfigurationError,
  );
});

test('test and development default to plaintext for the disposable local database', () => {
  assert.equal(resolveDatabaseTlsOption({ ...TEST }), false);
  assert.equal(resolveDatabaseTlsOption({ ...DEV }), false);
  assert.equal(resolveDatabaseTlsOption({ ...DEV, PCA_DATABASE_TLS: 'DISABLED' }), false);
});

test('the boot assertion surfaces the same failures at startup', () => {
  assert.throws(() => assertDatabaseTlsConfiguration({ ...PROD }), DatabaseTlsConfigurationError);
  assert.doesNotThrow(() => assertDatabaseTlsConfiguration({ ...PROD, PCA_DATABASE_TLS: 'REQUIRED' }));
  assert.doesNotThrow(() => assertDatabaseTlsConfiguration({ ...TEST }));
});

// ---------------------------------------------------------------------------
// Real connections against the disposable MySQL 8.4 server.
// ---------------------------------------------------------------------------

const { default: mysql } = await import('mysql2/promise');

function baseConnectionOptions() {
  const url = new URL(process.env.PCA_DATABASE_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectTimeout: 10_000,
  };
}

test('REAL: the plaintext posture genuinely produces an UNENCRYPTED session', async () => {
  const connection = await mysql.createConnection({ ...baseConnectionOptions(), ssl: undefined });
  try {
    const [rows] = await connection.query("SHOW STATUS LIKE 'Ssl_cipher'");
    assert.equal(rows[0].Value, '', 'no ssl option must mean a genuinely unencrypted session -- this is what F-1 was about');
  } finally {
    await connection.end();
  }
});

test('REAL: the REQUIRED posture REJECTS a server whose certificate does not verify', async () => {
  // The disposable Compose server presents MySQL's own auto-generated,
  // self-signed certificate. Verified TLS must refuse it outright rather than
  // fall back to plaintext -- that fallback is precisely the failure mode this
  // whole guard exists to prevent.
  const tls = resolveDatabaseTlsOption({ NODE_ENV: 'production', PCA_DATABASE_TLS: 'REQUIRED' });
  await assert.rejects(
    mysql.createConnection({ ...baseConnectionOptions(), ssl: tls }),
    (error) => {
      assert.match(String(error.code ?? error.message), /SSL|CERT|self-signed/i);
      return true;
    },
    'a REQUIRED posture must fail closed against an unverifiable certificate, never downgrade',
  );
});

test('REAL: a connection string can NEVER downgrade a REQUIRED posture', async () => {
  // mysql2 merges URI parameters only where the explicit option is falsy
  // (`if (options[key]) continue;`). A resolved REQUIRED object is truthy, so
  // a smuggled ?ssl={"rejectUnauthorized":false} in the URL cannot take effect.
  const base = baseConnectionOptions();
  const uri =
    `mysql://${encodeURIComponent(base.user)}:${encodeURIComponent(base.password)}` +
    `@${base.host}:${base.port}/${base.database}?ssl=${encodeURIComponent('{"rejectUnauthorized":false}')}`;
  const tls = resolveDatabaseTlsOption({ NODE_ENV: 'production', PCA_DATABASE_TLS: 'REQUIRED' });

  await assert.rejects(
    mysql.createConnection({ uri, ssl: tls, connectTimeout: 10_000 }),
    (error) => {
      assert.match(String(error.code ?? error.message), /SSL|CERT|self-signed/i);
      return true;
    },
    'the URL must not be able to turn verification off underneath the resolved posture',
  );

  // Control: without the explicit posture, that same URL DOES take effect and
  // connects over unverified TLS -- so the assertion above is proving the
  // explicit option won, not that the URL was inert.
  const downgraded = await mysql.createConnection({ uri, connectTimeout: 10_000 });
  try {
    const [rows] = await downgraded.query("SHOW STATUS LIKE 'Ssl_cipher'");
    assert.notEqual(rows[0].Value, '', 'control: the smuggled URL parameter is genuinely capable of establishing TLS');
  } finally {
    await downgraded.end();
  }
});
