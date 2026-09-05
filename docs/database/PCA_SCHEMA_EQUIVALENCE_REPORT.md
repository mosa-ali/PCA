# PCA Schema Equivalence Report

Required acceptance gate (mission section 20): prove that a database built
by applying the complete historical migration set from zero is
structurally identical to a database built by applying the new one-time
canonical bootstrap package from zero.

**Updated for the PCA-LIVE-DB-0 closure pass**: migration `0037` (adding
the owner-decided `enrollment_bootstrap_attempts.invitation_id` foreign
key) changed the schema after the original version of this report was
written. Every number and fingerprint below reflects the post-closure
state (35 migrations); re-derived and re-verified the same way as the
original pass, not merely edited.

## Method

Two disposable, isolated MySQL 8.4 containers were created for this mission
only (`pca-schema-mission-db-a` port 33071, `pca-schema-mission-db-b` port
33072 — separate from, and never touching, this repository's own
`docker-compose.yml` stack or any shared/persistent database).

- **Database A**: empty → `node backend/scripts/migrate.mjs` (all 35 files
  in `backend/migrations/`, in filename order) → introspected via
  `backend/scripts/introspect-schema.mjs`.
- **Database B**: empty → `database/live-bootstrap/01_create_database_schema.sql`
  (generated from `backend/src/db/schema.ts` by
  `backend/scripts/generate-bootstrap-sql.mjs`) →
  `database/live-bootstrap/02_reference_data.sql` → introspected the same
  way.

Both introspections capture, per table: engine, charset, collation, and per
column: exact type, nullability, default, extra (including
`GENERATED ALWAYS AS` expressions and `ON UPDATE CURRENT_TIMESTAMP`),
charset, collation; plus primary key, every index (unique and non-unique),
every foreign key (columns, referenced table/columns, `ON DELETE`/
`ON UPDATE`), and every CHECK constraint's clause — extracted from
`SHOW CREATE TABLE`'s own text (not `information_schema.check_constraints`/
`generation_expression`, both of which were found during this mission to
over-escape backslashes/quotes relative to valid SQL — see
`PCA_CANONICAL_SCHEMA_REPORT.md` §7).

`backend/scripts/compare-schema-snapshots.mjs` normalizes both introspections
(sorting indexes/foreign keys/checks so ordering differences are never
mistaken for real differences) and does a full structural diff.

## Result

```
MIGRATION_FROM_ZERO = PASS
CANONICAL_BOOTSTRAP_FROM_ZERO = PASS
MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP = EXACT_MATCH
```

Zero differences between Database A and Database B across all 75 tables,
626 columns, 83 foreign keys, 31 unique indexes, 117 non-unique indexes, 228
CHECK constraints, and 4 generated columns.

Independently confirmed by a second, differently-computed method: the
deterministic schema fingerprint
(`backend/scripts/schema-fingerprint.mjs`, SHA-256 over normalized
structural metadata only — never MySQL internal ids or environment-specific
values) is **identical** for both databases:

```
CANONICAL_SCHEMA_FINGERPRINT = sha256:a7a31c6fb1e3f89d9a44bb885ac76550cd41964b48ddb287f5939e041658a495
```

(Changed from the original mission's `sha256:11a85f4d0c096d79a97dedc59ae1a09115104784513dbf3ea99b276e5d39a1d1`
— expected, since the schema structurally changed.)

And by a third, independently-implemented, SQL-native method requiring only
a `mysql` client (`database/live-bootstrap/04_schema_fingerprint.sql`,
hashing columns/indexes/foreign keys via `SHA2()` over `GROUP_CONCAT`ed
`information_schema` rows — a different input format from the Node
fingerprint, so its own value is not expected to equal the one above, but is
expected to be internally reproducible):

```
PCA_SQL_NATIVE_SCHEMA_FINGERPRINT = 63bff4ad4d99aaf66b4e7debd12033d2992f192a0e2501fb23e8eb74b26a986d
```

...identical for both Database A and Database B.

## Reference-data equivalence

Structural equivalence alone was insufficient in practice: the first
bootstrap attempt produced a structurally-identical-but-functionally-broken
database, because `backend/src/db/schema.ts`/the bootstrap SQL generator
capture table *structure* only, not the `INSERT INTO` reference-data
statements two migrations (`0006`, `0007`) contain alongside their
`CREATE TABLE`s. This was caught by actually running the backend DB
integration test suite against the bootstrap-built database (110 failures,
all `ER_NO_REFERENCED_ROW_2` on `billing_currencies`/etc. foreign keys),
not by inspection. `database/live-bootstrap/02_reference_data.sql` was
built to close this gap (see `PCA_PRODUCTION_REFERENCE_DATA_MATRIX.csv`);
after adding it, the same test run dropped to exactly the 4 pre-existing,
schema-unrelated failures documented in
`PCA_CANONICAL_SCHEMA_REPORT.md` §10.

## Two bugs found and fixed while proving this

Documented in full in `PCA_CANONICAL_SCHEMA_REPORT.md` §7: an
information_schema backslash-escaping quirk, and a backtick-boundary regex
bug in the mission's own generated-column extractor. Both were caught only
by the executed round-trip described above, both are fixed in
`backend/scripts/introspect-schema.mjs`, and the `EXACT_MATCH` result above
is from the corrected pipeline.

## Reproducing this result

```
node backend/scripts/introspect-schema.mjs "<database-A-url>" /tmp/a.json
node backend/scripts/introspect-schema.mjs "<database-B-url>" /tmp/b.json
node backend/scripts/compare-schema-snapshots.mjs /tmp/a.json /tmp/b.json
# -> EXACT_MATCH
```
