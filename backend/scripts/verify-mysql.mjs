// Disposable-database migration/privacy gate, run as part of `npm run
// test:db`. Applies every migration to a fresh database (the Compose test
// service, or an explicitly-allowed local host) and asserts the resulting
// table set is exactly the expected minimal central schema -- catches an
// accidental new table (a privacy/scope regression) as fast as a broken
// migration.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required for the disposable database test.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL must point to the disposable local/Compose database.');
}

const root = new URL('../migrations/', import.meta.url);
const files = (await readdir(root)).filter((file) => file.endsWith('.sql')).sort();
const connection = await mysql.createConnection({ uri: connectionString, multipleStatements: true, timezone: 'Z' });
try {
  for (const file of files) {
    const migration = await readFile(fileURLToPath(new URL(file, root)), 'utf8');
    await connection.query(migration);
    await connection.query('INSERT INTO schema_migrations(version) VALUES (?)', [file]);
  }
  const [rows] = await connection.query(
    `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
  );
  const actual = rows.map((row) => row.table_name).join(',');
  const expected =
    'device_challenges,device_public_keys,devices,enrollment_invitations,envelope_data_version_ledger,envelope_message_idempotency_ledger,envelope_replay_ledger,families,licenses,recovery_envelopes,relay_envelopes,release_current_pointers,release_packages,schema_migrations,security_audit_metadata,service_account_family_scopes,service_accounts,service_sessions,sync_sequence_progress_ledger';
  if (actual !== expected) throw new Error(`Unexpected schema: ${actual}`);
  console.log(`MySQL migration/privacy gate passed (${files.length} migration(s)).`);
} finally {
  await connection.end();
}
