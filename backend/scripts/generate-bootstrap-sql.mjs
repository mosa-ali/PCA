// Deterministically generates database/live-bootstrap/01_create_database_schema.sql
// from the canonical declarative schema (backend/src/db/schema.ts, imported
// here from its compiled backend/dist/db/schema.js -- run `npm run build`
// first). This is the one-directional, forward generation step: schema.ts is
// the input, SQL is the output. It never reads a live database.
//
// Table order is alphabetical (PCA_CANONICAL_SCHEMA's own order). All 82
// foreign keys reference tables that may sort after their own table
// alphabetically, so FOREIGN_KEY_CHECKS is disabled for the duration of
// table creation (the same technique mysqldump itself uses) and restored
// before the script ends; database/live-bootstrap/03_post_validation.sql
// independently re-verifies the full FK set afterward from
// information_schema, closing the risk that disabling the check could hide
// a broken reference.
import { writeFile } from 'node:fs/promises';
import { PCA_CANONICAL_SCHEMA } from '../dist/db/schema.js';

const NUMERIC_TYPES = /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|year)/i;

function backtick(id) {
  return `\`${id}\``;
}

function formatDefault(col) {
  if (col.default === null) {
    // A generated-always-implicit ON UPDATE with no DEFAULT at all is not a
    // real MySQL column shape this schema uses -- fail loudly rather than
    // silently drop the ON UPDATE clause a future migration might expect.
    if (col.onUpdateCurrentTimestamp) {
      throw new Error(`${col.name}: onUpdateCurrentTimestamp is true but default is null -- unsupported shape, extend formatDefault before regenerating.`);
    }
    return '';
  }
  if (/^CURRENT_TIMESTAMP(\(\d+\))?$/i.test(col.default)) {
    return ` DEFAULT ${col.default}${col.onUpdateCurrentTimestamp ? ` ON UPDATE ${col.default}` : ''}`;
  }
  // onUpdateCurrentTimestamp paired with a non-CURRENT_TIMESTAMP default is
  // valid MySQL (e.g. `DEFAULT 0 ON UPDATE CURRENT_TIMESTAMP`), but no
  // column in this schema currently does that, and silently dropping the ON
  // UPDATE clause here would be a real, hard-to-notice correctness bug the
  // first time one does -- fail loudly instead so it gets added deliberately.
  if (col.onUpdateCurrentTimestamp) {
    throw new Error(`${col.name}: onUpdateCurrentTimestamp is true with a non-CURRENT_TIMESTAMP default (${col.default}) -- unsupported shape, extend formatDefault before regenerating.`);
  }
  if (NUMERIC_TYPES.test(col.dataType)) {
    return ` DEFAULT ${col.default}`;
  }
  return ` DEFAULT '${col.default.replace(/'/g, "''")}'`;
}

function columnDdl(col) {
  let type = col.columnType;
  if (col.unsigned && !/unsigned/i.test(type)) type += ' unsigned';
  let charsetClause = '';
  if (col.charset && !/^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|date|datetime|timestamp|time|year|json|blob|tinyblob|mediumblob|longblob)/i.test(col.dataType)) {
    charsetClause = ` CHARACTER SET ${col.charset} COLLATE ${col.collation}`;
  }
  const nullClause = col.nullable ? ' NULL' : ' NOT NULL';

  if (col.generatedExpression !== null) {
    // Generated columns take no DEFAULT/AUTO_INCREMENT; the value is always
    // computed. Preserved exactly from the migration-built database (see
    // backend/scripts/introspect-schema.mjs's SHOW CREATE TABLE extraction).
    return `  ${backtick(col.name)} ${type}${charsetClause} GENERATED ALWAYS AS (${col.generatedExpression}) ${col.generatedStorage}${nullClause}`;
  }

  const autoInc = col.autoIncrement ? ' AUTO_INCREMENT' : '';
  return `  ${backtick(col.name)} ${type}${charsetClause}${nullClause}${formatDefault(col)}${autoInc}`;
}

function tableDdl(table) {
  const lines = [];
  for (const col of table.columns) lines.push(columnDdl(col));

  if (table.primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${table.primaryKey.map(backtick).join(', ')})`);
  }
  for (const idx of table.uniqueIndexes) {
    lines.push(`  UNIQUE KEY ${backtick(idx.name)} (${idx.columns.map(backtick).join(', ')})`);
  }
  for (const idx of table.indexes) {
    lines.push(`  KEY ${backtick(idx.name)} (${idx.columns.map(backtick).join(', ')})`);
  }
  for (const fk of table.foreignKeys) {
    lines.push(
      `  CONSTRAINT ${backtick(fk.name)} FOREIGN KEY (${fk.columns.map(backtick).join(', ')}) REFERENCES ${backtick(fk.referencedTable)} (${fk.referencedColumns.map(backtick).join(', ')}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`,
    );
  }
  for (const check of table.checkConstraints) {
    lines.push(`  CONSTRAINT ${backtick(check.name)} CHECK (${check.clause})`);
  }

  return `CREATE TABLE ${backtick(table.name)} (\n${lines.join(',\n')}\n) ENGINE=${table.engine} DEFAULT CHARSET=${table.charset} COLLATE=${table.collation};`;
}

/**
 * Exported so the negative-control harness
 * (docs/database/_work scripts, not committed) can generate SQL from a
 * deliberately mutated in-memory copy of PCA_CANONICAL_SCHEMA, to prove the
 * equivalence comparator actually detects drift -- without ever hand-editing
 * this file's own output.
 */
export function generateSqlFromSchema(schema) {
  const parts = [
    '-- database/live-bootstrap/01_create_database_schema.sql',
    '-- GENERATED by backend/scripts/generate-bootstrap-sql.mjs from backend/src/db/schema.ts.',
    '-- Do not hand-edit this file -- edit schema.ts (and the migration that',
    '-- justifies the change) and regenerate.',
    '--',
    '-- One-time creation only. This is NOT a repeatable migration and must',
    '-- never be run against a database that already holds PCA production',
    '-- tables -- see 00_preflight.sql, which must pass before this file runs,',
    '-- and OWNER_RUNBOOK.md.',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ];
  for (const table of schema) {
    parts.push(`-- ${table.name} (defined by backend/migrations/${table.createdByMigration}${table.alteredByMigrations.length ? `, altered by ${table.alteredByMigrations.join(', ')}` : ''})`);
    parts.push(tableDdl(table));
    parts.push('');
  }
  parts.push('SET FOREIGN_KEY_CHECKS = 1;');
  parts.push('');
  return parts.join('\n');
}

// CLI entrypoint: only runs when invoked directly (not when imported by the
// negative-control harness).
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('generate-bootstrap-sql.mjs')) {
  const outPath = new URL('../../database/live-bootstrap/01_create_database_schema.sql', import.meta.url);
  await writeFile(outPath, generateSqlFromSchema(PCA_CANONICAL_SCHEMA), 'utf8');
  console.log(`Wrote ${PCA_CANONICAL_SCHEMA.length} table(s) to database/live-bootstrap/01_create_database_schema.sql`);
}
