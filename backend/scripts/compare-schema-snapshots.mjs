// Deep structural diff between two introspection JSON files produced by
// introspect-schema.mjs (Database A: migration-from-zero; Database B:
// canonical-bootstrap-from-zero). Used for the mandatory equivalence proof
// (docs/database/PCA_SCHEMA_EQUIVALENCE_REPORT.md) and for the negative
// controls (proving this comparator can actually detect drift). Never
// connects to a database itself -- pure JSON-in, diff-out.
import { readFile } from 'node:fs/promises';

function normalizeTable(t) {
  return {
    engine: t.engine,
    charset: t.charset,
    collation: t.collation,
    columns: t.columns.map((c) => ({
      name: c.name,
      columnType: c.columnType,
      nullable: c.nullable,
      default: c.default,
      extra: c.extra,
      charset: c.charset,
      collation: c.collation,
      unsigned: c.unsigned,
    })),
    primaryKey: [...t.primaryKey],
    indexes: t.indexes
      .map((i) => ({ name: i.name, unique: i.unique, columns: [...i.columns] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: t.foreignKeys
      .map((fk) => ({
        columns: [...fk.columns],
        referencedTable: fk.referencedTable,
        referencedColumns: [...fk.referencedColumns],
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      }))
      .sort((a, b) => a.columns.join(',').localeCompare(b.columns.join(','))),
    checkConstraints: t.checkConstraints
      .map((c) => ({ clause: c.clause }))
      .sort((a, b) => a.clause.localeCompare(b.clause)),
  };
}

export function compareSchemas(a, b) {
  const diffs = [];
  const tablesA = new Set(Object.keys(a.tables));
  const tablesB = new Set(Object.keys(b.tables));

  for (const t of tablesA) if (!tablesB.has(t)) diffs.push(`TABLE MISSING in B: ${t}`);
  for (const t of tablesB) if (!tablesA.has(t)) diffs.push(`TABLE EXTRA in B: ${t}`);

  for (const t of [...tablesA].filter((x) => tablesB.has(x))) {
    const na = normalizeTable(a.tables[t]);
    const nb = normalizeTable(b.tables[t]);
    const sa = JSON.stringify(na);
    const sb = JSON.stringify(nb);
    if (sa !== sb) {
      diffs.push(`TABLE DIFFERS: ${t}`);
      if (na.engine !== nb.engine) diffs.push(`  engine: A=${na.engine} B=${nb.engine}`);
      if (na.charset !== nb.charset) diffs.push(`  charset: A=${na.charset} B=${nb.charset}`);
      if (na.collation !== nb.collation) diffs.push(`  collation: A=${na.collation} B=${nb.collation}`);
      if (JSON.stringify(na.primaryKey) !== JSON.stringify(nb.primaryKey)) {
        diffs.push(`  primaryKey: A=${JSON.stringify(na.primaryKey)} B=${JSON.stringify(nb.primaryKey)}`);
      }
      const colNamesA = na.columns.map((c) => c.name);
      const colNamesB = nb.columns.map((c) => c.name);
      for (const name of new Set([...colNamesA, ...colNamesB])) {
        const ca = na.columns.find((c) => c.name === name);
        const cb = nb.columns.find((c) => c.name === name);
        if (!ca) diffs.push(`  column MISSING in B: ${t}.${name}`);
        else if (!cb) diffs.push(`  column EXTRA in B: ${t}.${name}`);
        else if (JSON.stringify(ca) !== JSON.stringify(cb)) diffs.push(`  column DIFFERS: ${t}.${name}: A=${JSON.stringify(ca)} B=${JSON.stringify(cb)}`);
      }
      if (JSON.stringify(na.indexes) !== JSON.stringify(nb.indexes)) {
        diffs.push(`  indexes: A=${JSON.stringify(na.indexes)}`);
        diffs.push(`           B=${JSON.stringify(nb.indexes)}`);
      }
      if (JSON.stringify(na.foreignKeys) !== JSON.stringify(nb.foreignKeys)) {
        diffs.push(`  foreignKeys: A=${JSON.stringify(na.foreignKeys)}`);
        diffs.push(`               B=${JSON.stringify(nb.foreignKeys)}`);
      }
      if (JSON.stringify(na.checkConstraints) !== JSON.stringify(nb.checkConstraints)) {
        diffs.push(`  checkConstraints: A=${JSON.stringify(na.checkConstraints)}`);
        diffs.push(`                    B=${JSON.stringify(nb.checkConstraints)}`);
      }
    }
  }
  return diffs;
}

// CLI entrypoint: node compare-schema-snapshots.mjs <a.json> <b.json>
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('compare-schema-snapshots.mjs')) {
  const [, , pathA, pathB] = process.argv;
  const a = JSON.parse(await readFile(pathA, 'utf8'));
  const b = JSON.parse(await readFile(pathB, 'utf8'));
  const diffs = compareSchemas(a, b);
  if (diffs.length === 0) {
    console.log('EXACT_MATCH');
  } else {
    console.log(`MISMATCH (${diffs.length} difference(s)):`);
    for (const d of diffs) console.log(d);
    process.exitCode = 1;
  }
}
