// Generates backend/schema/current_schema.sql and
// backend/schema/schema_manifest.json from the ACTUAL current state of the
// database named by PCA_DATABASE_URL (expected to already have every
// migration applied -- run `npm run db:migrate` first). These are
// GENERATED VERIFICATION ARTIFACTS, never a second manually-maintained
// schema authority -- the versioned SQL migrations in backend/migrations/
// remain the only schema source of truth. Re-run this script and diff the
// output whenever migrations change, to catch schema drift.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required to snapshot the schema.');

const outDir = new URL('../schema/', import.meta.url);
await mkdir(outDir, { recursive: true });

const connection = await mysql.createConnection({ uri: connectionString, timezone: 'Z' });
try {
  const [tableRows] = await connection.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
  );
  const tables = tableRows.map((row) => row.table_name ?? row.TABLE_NAME);

  const ddlParts = [];
  const manifest = { database: 'mysql', generatedFrom: 'live schema', tables: {} };

  for (const table of tables) {
    const [[createRow]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    const createStatement = createRow['Create Table'];
    ddlParts.push(`-- ${table}\n${createStatement};\n`);

    const [columns] = await connection.query(
      `SELECT column_name, column_type, is_nullable, column_default, column_key, extra
       FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
      [table],
    );
    const [indexes] = await connection.query(
      `SELECT index_name, non_unique, seq_in_index, column_name
       FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY index_name, seq_in_index`,
      [table],
    );
    const [foreignKeys] = await connection.query(
      `SELECT constraint_name, column_name, referenced_table_name, referenced_column_name
       FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = ? AND referenced_table_name IS NOT NULL`,
      [table],
    );

    manifest.tables[table] = {
      columns: columns.map((c) => ({
        name: c.column_name ?? c.COLUMN_NAME,
        type: c.column_type ?? c.COLUMN_TYPE,
        nullable: (c.is_nullable ?? c.IS_NULLABLE) === 'YES',
        default: c.column_default ?? c.COLUMN_DEFAULT,
        key: c.column_key ?? c.COLUMN_KEY,
        extra: c.extra ?? c.EXTRA,
      })),
      indexes: indexes.map((i) => ({
        name: i.index_name ?? i.INDEX_NAME,
        unique: (i.non_unique ?? i.NON_UNIQUE) === 0,
        column: i.column_name ?? i.COLUMN_NAME,
        seq: i.seq_in_index ?? i.SEQ_IN_INDEX,
      })),
      foreignKeys: foreignKeys.map((fk) => ({
        constraint: fk.constraint_name ?? fk.CONSTRAINT_NAME,
        column: fk.column_name ?? fk.COLUMN_NAME,
        referencedTable: fk.referenced_table_name ?? fk.REFERENCED_TABLE_NAME,
        referencedColumn: fk.referenced_column_name ?? fk.REFERENCED_COLUMN_NAME,
      })),
    };
  }

  await writeFile(fileURLToPath(new URL('current_schema.sql', outDir)), ddlParts.join('\n'), 'utf8');
  await writeFile(fileURLToPath(new URL('schema_manifest.json', outDir)), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Snapshot written for ${tables.length} table(s): backend/schema/current_schema.sql, backend/schema/schema_manifest.json`);
} finally {
  await connection.end();
}
