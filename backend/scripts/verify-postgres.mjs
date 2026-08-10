import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required for the disposable database test.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'postgres'].includes(url.hostname)) {
  throw new Error('PCA_DATABASE_URL must point to the disposable Compose database.');
}

const root = new URL('../migrations/', import.meta.url);
const files = (await readdir(root)).filter((file) => file.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString });
await client.connect();
try {
  for (const file of files) {
    const migration = await readFile(fileURLToPath(new URL(file, root)), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(migration);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  const actual = rows.map((row) => row.table_name).join(',');
  const expected =
    'device_challenges,device_public_keys,devices,enrollment_invitations,families,licenses,recovery_envelopes,relay_envelopes,release_current_pointers,release_packages,schema_migrations,security_audit_metadata,service_account_family_scopes,service_accounts,service_sessions';
  if (actual !== expected) throw new Error(`Unexpected public schema: ${actual}`);
  console.log(`PostgreSQL migration/privacy gate passed (${files.length} migration(s)).`);
} finally {
  await client.end();
}
