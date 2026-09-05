// Deterministic canonical-schema fingerprint. Hashes only normalized
// structural facts (tables/columns/types/nullability/defaults/PKs/
// uniques/indexes/FKs/checks/collation) -- never MySQL internal ids,
// AUTO_INCREMENT counters, or any environment-specific metadata -- so the
// SAME fingerprint is produced by a from-zero migration build, a
// canonical-bootstrap build, and (later) the real live database, as long as
// their structure agrees. Used to prove the live database matches the
// accepted schema at any later point without re-running a full diff.
//
// Usage: node schema-fingerprint.mjs <introspection.json>
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function normalizedFingerprint(introspection) {
  const tables = Object.keys(introspection.tables).sort();
  const normalized = tables.map((name) => {
    const t = introspection.tables[name];
    return {
      name,
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
        generatedExpression: c.generatedExpression,
        generatedStorage: c.generatedStorage,
      })),
      primaryKey: [...t.primaryKey],
      indexes: [...t.indexes].map((i) => ({ name: i.name, unique: i.unique, columns: [...i.columns] })).sort((a, b) => a.name.localeCompare(b.name)),
      foreignKeys: [...t.foreignKeys]
        .map((fk) => ({ columns: [...fk.columns], referencedTable: fk.referencedTable, referencedColumns: [...fk.referencedColumns], onDelete: fk.onDelete, onUpdate: fk.onUpdate }))
        .sort((a, b) => a.columns.join(',').localeCompare(b.columns.join(','))),
      checkConstraints: [...t.checkConstraints].map((c) => c.clause).sort(),
    };
  });
  const canonicalJson = JSON.stringify(normalized);
  const hash = createHash('sha256').update(canonicalJson).digest('hex');
  return { hash, tableCount: tables.length, canonicalJson };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('schema-fingerprint.mjs')) {
  const [, , introspectionPath] = process.argv;
  if (!introspectionPath) throw new Error('Usage: node schema-fingerprint.mjs <introspection.json>');
  const introspection = JSON.parse(await readFile(introspectionPath, 'utf8'));
  const { hash, tableCount } = normalizedFingerprint(introspection);
  console.log(`CANONICAL_SCHEMA_FINGERPRINT = sha256:${hash}`);
  console.log(`(${tableCount} tables)`);
}
