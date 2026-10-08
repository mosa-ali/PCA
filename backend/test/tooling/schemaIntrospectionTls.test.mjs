import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mysqlModule = pathToFileURL(createRequire(import.meta.url).resolve('mysql2/promise')).href;

function run(posture, ca, uri = 'mysql://test:test@localhost/disposable') {
  const scratch = mkdtempSync(path.join(tmpdir(), 'pca-introspection-tls-'));
  try {
    const capture = path.join(scratch, 'connection.json');
    const preload = path.join(scratch, 'preload.mjs');
    writeFileSync(preload, `import mysql from ${JSON.stringify(mysqlModule)};
import { writeFileSync } from 'node:fs';
mysql.createConnection = async (options) => {
  writeFileSync(process.env.CAPTURE, JSON.stringify({ ssl: options.ssl, timezone: options.timezone }));
  return { query: async (sql) => sql === 'SELECT DATABASE() AS db' ? [[{db:'disposable'}]] : [[]], end: async () => {} };
};`);
    const env = { ...process.env, NODE_ENV: 'production', PCA_SCHEMA_INTROSPECTION_URL: uri,
      PCA_SCHEMA_INTROSPECTION_OUT: path.join(scratch, 'schema.json'), CAPTURE: capture };
    delete env.PCA_DATABASE_TLS;
    delete env.PCA_DATABASE_TLS_CA;
    if (posture !== undefined) env.PCA_DATABASE_TLS = posture;
    if (ca !== undefined) env.PCA_DATABASE_TLS_CA = ca;
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
      'scripts/introspect-schema.mjs'], { cwd: root, env, encoding: 'utf8' });
    let options;
    try { options = JSON.parse(readFileSync(capture, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { ...result, options };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('introspection rejects missing, disabled and invalid production TLS before connecting', () => {
  for (const posture of [undefined, 'DISABLED', 'required']) {
    const result = run(posture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DatabaseTlsConfigurationError/);
    assert.equal(result.options, undefined);
  }
});

test('introspection passes verified TLS explicitly even when URI requests unverified TLS', () => {
  const result = run('REQUIRED', undefined,
    'mysql://test:test@localhost/disposable?ssl=%7B%22rejectUnauthorized%22%3Afalse%7D');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.options, { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, timezone: 'Z' });
});

test('introspection carries configured CA and rejects unreadable CA before connecting', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  const result = run('REQUIRED', pem);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.options.ssl.ca, pem);
  const rejected = run('REQUIRED', path.join(tmpdir(), 'pca-missing-ca-for-introspection.pem'));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /DatabaseTlsConfigurationError/);
  assert.equal(rejected.options, undefined);
});
