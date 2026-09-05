// Full information_schema introspection for a MySQL database.
// Usage: node introspect-schema.mjs <PCA_DATABASE_URL> <out.json>
// Produces a deterministic, normalized structural description of every table:
// engine, charset, collation, columns (ordinal/type/length/precision/unsigned/
// nullable/default/extra), primary key, unique constraints, indexes (incl.
// non-unique), foreign keys (with on_update/on_delete), and check constraints.
import { writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

/**
 * information_schema.check_constraints.check_clause and
 * information_schema.columns.generation_expression both over-escape
 * backslashes/quotes relative to valid re-executable SQL (confirmed by
 * diffing against SHOW CREATE TABLE's rendering of the identical
 * constraint/column -- e.g. a regex CHECK's `\.` round-trips through
 * check_clause as `\\\\.`, four backslashes, while SHOW CREATE TABLE
 * renders the same clause with the correct two). SHOW CREATE TABLE's own
 * text is exactly what MySQL would use to recreate the table, so it is the
 * only reliable source for expression text this tool re-emits as DDL.
 * These two helpers extract that text directly from SHOW CREATE TABLE
 * instead of trusting information_schema's expression columns.
 */
function findMatchingParen(text, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced parentheses starting at index ${openParenIndex}`);
}

function extractCheckConstraintsFromDdl(ddl) {
  const results = [];
  const re = /CONSTRAINT `([^`]+)` CHECK \(/g;
  let m;
  while ((m = re.exec(ddl))) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(ddl, openIdx);
    results.push({ name: m[1], clause: ddl.slice(openIdx + 1, closeIdx) });
  }
  return results;
}

function extractGeneratedColumnsFromDdl(ddl) {
  // Anchored to the start of a line (SHOW CREATE TABLE always puts exactly
  // one column/key/constraint per line, 2-space indented) -- unanchored,
  // `[^\`]+` can pair a column's CLOSING backtick with the NEXT column's
  // OPENING backtick as if they delimited one name, silently matching the
  // wrong column (confirmed by a failing test case: a generated column
  // immediately following a plain one was skipped entirely this way).
  const results = new Map();
  const re = /^ {2}`([^`]+)`[^\n]*? GENERATED ALWAYS AS \(/gm;
  let m;
  while ((m = re.exec(ddl))) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(ddl, openIdx);
    const expression = ddl.slice(openIdx + 1, closeIdx);
    const after = ddl.slice(closeIdx + 1, closeIdx + 20);
    const storage = /^\s*VIRTUAL/.test(after) ? 'VIRTUAL' : 'STORED';
    results.set(m[1], { expression, storage });
  }
  return results;
}

const [, , connectionString, outPath] = process.argv;
if (!connectionString || !outPath) {
  throw new Error('Usage: node introspect-schema.mjs <PCA_DATABASE_URL> <out.json>');
}

const connection = await mysql.createConnection({ uri: connectionString, timezone: 'Z' });
try {
  const [dbRows] = await connection.query('SELECT DATABASE() AS db');
  const dbName = dbRows[0].db;

  const [tableRows] = await connection.query(
    `SELECT table_name, engine, table_collation, create_options, table_comment
     FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
    [dbName],
  );

  const result = { database: dbName, generatedAt: new Date().toISOString(), tables: {} };

  for (const t of tableRows) {
    const table = t.table_name ?? t.TABLE_NAME;
    const engine = t.engine ?? t.ENGINE;
    const tableCollation = t.table_collation ?? t.TABLE_COLLATION;
    const tableComment = t.table_comment ?? t.TABLE_COMMENT ?? '';

    const [charsetRows] = await connection.query(
      `SELECT ccsa.character_set_name AS charset
       FROM information_schema.collations c
       JOIN information_schema.character_sets ccsa ON c.character_set_name = ccsa.character_set_name
       WHERE c.collation_name = ?`,
      [tableCollation],
    );
    const tableCharset = charsetRows[0]?.charset ?? null;

    const [columns] = await connection.query(
      `SELECT column_name, ordinal_position, column_type, data_type, character_maximum_length,
              numeric_precision, numeric_scale, is_nullable, column_default, extra,
              character_set_name, collation_name, column_comment,
              (column_type LIKE '%unsigned%') AS is_unsigned
       FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [dbName, table],
    );

    const [stats] = await connection.query(
      `SELECT index_name, non_unique, seq_in_index, column_name, nullable
       FROM information_schema.statistics WHERE table_schema = ? AND table_name = ?
       ORDER BY index_name, seq_in_index`,
      [dbName, table],
    );
    const indexMap = new Map();
    for (const s of stats) {
      const name = s.index_name ?? s.INDEX_NAME;
      if (!indexMap.has(name)) {
        indexMap.set(name, { name, unique: (s.non_unique ?? s.NON_UNIQUE) === 0, columns: [] });
      }
      indexMap.get(name).columns.push(s.column_name ?? s.COLUMN_NAME);
    }
    const indexes = [...indexMap.values()];
    const primaryKey = indexMap.get('PRIMARY')?.columns ?? [];

    const [fkRows] = await connection.query(
      `SELECT k.constraint_name, k.column_name, k.referenced_table_name, k.referenced_column_name,
              k.ordinal_position, r.update_rule, r.delete_rule
       FROM information_schema.key_column_usage k
       JOIN information_schema.referential_constraints r
         ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
       WHERE k.table_schema = ? AND k.table_name = ? AND k.referenced_table_name IS NOT NULL
       ORDER BY k.constraint_name, k.ordinal_position`,
      [dbName, table],
    );
    const fkMap = new Map();
    for (const fk of fkRows) {
      const name = fk.constraint_name ?? fk.CONSTRAINT_NAME;
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          name,
          columns: [],
          referencedTable: fk.referenced_table_name ?? fk.REFERENCED_TABLE_NAME,
          referencedColumns: [],
          onUpdate: fk.update_rule ?? fk.UPDATE_RULE,
          onDelete: fk.delete_rule ?? fk.DELETE_RULE,
        });
      }
      fkMap.get(name).columns.push(fk.column_name ?? fk.COLUMN_NAME);
      fkMap.get(name).referencedColumns.push(fk.referenced_column_name ?? fk.REFERENCED_COLUMN_NAME);
    }
    const foreignKeys = [...fkMap.values()];

    const [[createRow]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    const ddl = createRow['Create Table'];
    const checkConstraints = extractCheckConstraintsFromDdl(ddl);
    const generatedColumns = extractGeneratedColumnsFromDdl(ddl);

    result.tables[table] = {
      engine,
      charset: tableCharset,
      collation: tableCollation,
      comment: tableComment,
      createOptions: t.create_options ?? t.CREATE_OPTIONS ?? '',
      columns: columns.map((c) => ({
        name: c.column_name ?? c.COLUMN_NAME,
        ordinal: c.ordinal_position ?? c.ORDINAL_POSITION,
        columnType: c.column_type ?? c.COLUMN_TYPE,
        dataType: c.data_type ?? c.DATA_TYPE,
        charMaxLength: c.character_maximum_length ?? c.CHARACTER_MAXIMUM_LENGTH,
        numericPrecision: c.numeric_precision ?? c.NUMERIC_PRECISION,
        numericScale: c.numeric_scale ?? c.NUMERIC_SCALE,
        nullable: (c.is_nullable ?? c.IS_NULLABLE) === 'YES',
        default: c.column_default ?? c.COLUMN_DEFAULT,
        extra: c.extra ?? c.EXTRA,
        generatedExpression: generatedColumns.get(c.column_name ?? c.COLUMN_NAME)?.expression ?? null,
        generatedStorage: generatedColumns.get(c.column_name ?? c.COLUMN_NAME)?.storage ?? null,
        charset: c.character_set_name ?? c.CHARACTER_SET_NAME,
        collation: c.collation_name ?? c.COLLATION_NAME,
        comment: c.column_comment ?? c.COLUMN_COMMENT,
        unsigned: Boolean(c.is_unsigned ?? c.IS_UNSIGNED),
      })),
      primaryKey,
      indexes,
      foreignKeys,
      checkConstraints,
      showCreateTable: createRow['Create Table'],
    };
  }

  await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${outPath} for ${Object.keys(result.tables).length} table(s).`);
} finally {
  await connection.end();
}
