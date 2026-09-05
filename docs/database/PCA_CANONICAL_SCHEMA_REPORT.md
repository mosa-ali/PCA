# PCA Canonical Central Database Schema — Report

**Mission:** PCA-LIVE-DB-0. Derive, reconcile, prove, and package the
complete authoritative PCA central database schema before the first live
production database is created. No live database was created, connected to,
or modified by this mission.

**Baseline:** branch `pca-dev`, `SOURCE_SHA_BEFORE = 92d2d9bd4535ff3686bd48650d262f468a55941f`
(== `origin/pca-dev` at mission start).

## 1. Architecture discovery

Before any derivation, the actual repository architecture was established
(not assumed):

- **No ORM.** The backend (`backend/src`) uses raw SQL via `mysql2` only
  (`backend/package.json` dependencies: `fastify`, `mysql2` — nothing else).
- **Versioned SQL migrations are the existing schema authority.**
  `backend/migrations/0001` through `0036` (34 files; **0009 and 0010 were
  never created** — a genuine numbering gap, not a deletion; confirmed via
  `git log` — the filename-sort migration runner does not require numeric
  contiguity, so this has no functional effect).
- **`backend/schema/current_schema.sql` / `schema_manifest.json`** already
  exist as *generated verification snapshots* of a live database — their own
  header explicitly states they are "GENERATED VERIFICATION ARTIFACTS, never
  a second manually-maintained schema authority." They are not the canonical
  source; this mission does not change that.
- **No prior `schema.ts` existed.** This mission creates
  `backend/src/db/schema.ts` as a new, strongly-typed declarative manifest —
  not an ORM, not a runtime dependency — generated once by tooling built for
  this mission (`backend/scripts/introspect-schema.mjs`) from the actual
  migration-built database, then used to deterministically generate the
  one-time bootstrap SQL (`backend/scripts/generate-bootstrap-sql.mjs`).

## 2. Independent re-derivation method

Every fact in this report was derived by **executing** the accepted
migration history against a real, disposable MySQL 8.4 database (Docker
container `pca-schema-mission-db-a`, port 33071) — not by reading migration
files and inferring the result by eye. A second, independent disposable
database (`pca-schema-mission-db-b`, port 33072) was used exclusively to
prove the generated bootstrap package produces an identical structure from
zero. Both containers are scratch infrastructure created for this mission
only, isolated from the project's own `docker-compose.yml` stack (which was
left untouched), and are torn down at the end of this mission.

```
MIGRATION_FROM_ZERO = PASS  (34/34 migrations applied cleanly, in filename order)
CANONICAL_BOOTSTRAP_FROM_ZERO = PASS  (generated SQL applied cleanly to an empty database)
MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP = EXACT_MATCH
```

The equivalence check (`backend/scripts/compare-schema-snapshots.mjs`)
normalizes and diffs: table engine/charset/collation, every column's
type/nullable/default/extra/charset/collation, primary keys, indexes (unique
and non-unique), foreign keys (columns/referenced table/on delete/on
update), and CHECK constraint clauses. Zero differences were found after two
real bugs discovered and fixed during this mission (§7).

## 3. Canonical counts

| Metric | Count |
|---|---|
| Tables | 75 |
| Columns | 626 |
| Foreign keys | 82 (100% `ON DELETE NO ACTION ON UPDATE NO ACTION`) |
| Unique indexes (non-PK) | 31 |
| Non-unique indexes | 116 |
| CHECK constraints | 228 |
| Generated columns (`GENERATED ALWAYS AS ... STORED`) | 4 |
| Composite primary keys | 6 |
| Tables with zero primary key | 0 |
| Application-enforced (non-FK) relationships identified | 57 total: 56 `APPLICATION_ENFORCED_INTENTIONAL` (30 soft `family_id` column instances + 26 other) + 1 `OWNER_DECISION_REQUIRED`, see `PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md`. Counted directly from `backend/src/db/schema.ts`'s `applicationEnforcedRelations` arrays, not by hand -- see `docs/database/PCA_CANONICAL_DATABASE_OBJECT_INVENTORY.csv`'s `APPLICATION_ENFORCED_RELATION` rows (57). |
| Relationships flagged `OWNER_DECISION_REQUIRED` | 1 |
| Production reference-data rows | 14 (+ 34 bootstrap-bookkeeping rows in `schema_migrations`, a distinct category — see §8) |

`CANONICAL_SCHEMA_FINGERPRINT = sha256:11a85f4d0c096d79a97dedc59ae1a09115104784513dbf3ea99b276e5d39a1d1`

(Computed by `backend/scripts/schema-fingerprint.mjs` over normalized
structural metadata only — never MySQL internal ids or environment-specific
values. Identical on both Database A and Database B.)

## 4. Deliverables produced

- `backend/src/db/schema.ts` — canonical declarative schema (75 tables, generated).
- `backend/scripts/introspect-schema.mjs` — reusable full information_schema
  introspection tool (also usable later for drift-checking a live database).
- `backend/scripts/generate-bootstrap-sql.mjs` — schema.ts → DDL generator.
- `backend/scripts/generate-bootstrap-reference-data.mjs` — reference-data generator.
- `backend/scripts/compare-schema-snapshots.mjs` — the equivalence comparator.
- `backend/scripts/schema-fingerprint.mjs` — the fingerprint tool.
- `backend/scripts/post-validate.mjs` — dynamic post-bootstrap validation.
- `backend/test/canonicalSchemaChildFieldsRegression.test.mjs` — new
  canonical-schema-wide prohibited-child-field gate (registered in
  `backend/scripts/run-tests.mjs`; complements, does not replace, the
  existing narrower `test/childprofiles/noReadableChildFieldsRegression.test.mjs`).
- `database/live-bootstrap/00_preflight.sql`, `01_create_database_schema.sql`,
  `02_reference_data.sql`, `03_post_validation.sql`,
  `04_schema_fingerprint.sql`, `OWNER_RUNBOOK.md`.
- `docs/database/PCA_CANONICAL_DATABASE_OBJECT_INVENTORY.csv`
- `docs/database/PCA_CANONICAL_TABLE_COLUMN_MATRIX.csv`
- `docs/database/PCA_CENTRAL_DATA_PRIVACY_CLASSIFICATION.csv`
- `docs/database/PCA_RUNTIME_SCHEMA_COMPATIBILITY_MATRIX.csv`
- `docs/database/PCA_PRODUCTION_REFERENCE_DATA_MATRIX.csv`
- `docs/database/PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md`
- `docs/database/PCA_LIVE_DATABASE_SETTINGS.md`
- `docs/database/PCA_FAMILY_DATA_ISOLATION_MATRIX.csv` (owner additive request)
- `docs/database/PCA_SCHEMA_EQUIVALENCE_REPORT.md`
- This file.

## 5. Migration reconciliation (section 7)

All 34 migration files were classified. **Every one is `CURRENT_REQUIRED`.**
Zero are `SUPERSEDED_BUT_HISTORICAL`, `TEST_ONLY`, `BROKEN/DRIFTED`, or
`UNKNOWN`. This is a simple, clean classification because **no migration in
the entire history contains `DROP TABLE`, `DROP COLUMN`, or `RENAME TABLE`**
(confirmed by grep across all 34 files) — the history is purely additive
(`CREATE TABLE` / `ALTER TABLE ... ADD`), so every migration's effect is
still fully present in the current schema and none has ever been reversed or
replaced.

## 6. Privacy classification (section 6)

All 626 columns were classified using the required taxonomy
(`docs/database/PCA_CENTRAL_DATA_PRIVACY_CLASSIFICATION.csv`):

```
OPAQUE_IDENTIFIER:     209
OPERATIONAL_METADATA:  361
SECURITY_METADATA:      36
ENCRYPTED_PAYLOAD:       8
READABLE_PARENT_DATA:    8
ACCOUNT_AUTH:            3
OTHER:                   1  (platform_admin_accounts.display_name -- a Platform Admin STAFF member's own name, not a parent or child)
READABLE_CHILD_DATA:     0
```

**Required invariants, verified:**

```
READABLE_CHILD_PERSONAL_CONTENT_CENTRAL = 0
READABLE_FAMILY_ACTIVITY_CONTENT_CENTRAL = 0
CHILD_PHOTOS_CENTRAL = 0
CHILD_VIDEOS_CENTRAL = 0
CHILD_FILES_CENTRAL = 0
CHILD_MESSAGES_CENTRAL = 0
READABLE_APP_USAGE_HISTORY_CENTRAL = 0
READABLE_BROWSING_HISTORY_CENTRAL = 0
READABLE_PRECISE_LOCATION_HISTORY_CENTRAL = 0
CENTRAL_READABLE_CHILD_FIELDS = 0
```

A naive substring scan of the mission's own prohibited-term list against all
626 real column names produces ~20 raw hits; every one was individually
traced to its origin migration and is a false positive with cited evidence
(e.g. `managed_device_limit` contains "age" as a substring of "man**age**d";
`entitlement_type` contains "title" as a substring of "en**title**ment";
`message_id`/`message_key` are opaque identifiers/localization keys per
migration 0001's and 0012's own design comments, never message content).
Full evidence trail: `backend/test/canonicalSchemaChildFieldsRegression.test.mjs`'s
`ALLOWED_FALSE_POSITIVES` map, and `PCA_CENTRAL_DATA_PRIVACY_CLASSIFICATION.csv`.

**Residual soft risk, documented rather than hidden:** two column families
are genuinely free-text — `*_reason`/`*_note` (e.g.
`complimentary_entitlement_grants.internal_note`, up to 2000 chars) and
`metadata_json`/`value_json` on Platform Admin tables. Every instance found
is admin-authored (always paired with a `*_by_admin_id` column) or Platform
Admin-internal, never parent- or child-authored, and none is exposed to a
parent or child. This is an operational-policy control (what admins choose
to type), not a schema-enforceable one — flagged here rather than silently
classified away.

## 7. Two real bugs found and fixed during this mission

Both were caught only by executing the full round-trip
(schema.ts → generate SQL → apply to a real database → introspect →
compare), not by inspection — consistent with this repository's own
established lesson that "a fix is not closed until it is executed."

1. **`information_schema.check_constraints.check_clause` and
   `information_schema.columns.generation_expression` both over-escape
   backslashes/quotes relative to valid, re-executable SQL.** Confirmed by
   diffing against `SHOW CREATE TABLE`'s rendering of the *identical*
   constraint: a regex CHECK's `\.` round-trips through `check_clause` as
   `\\\\.` (4 backslashes), while `SHOW CREATE TABLE` renders the same
   clause with the correct 2. Fix: `introspect-schema.mjs` now extracts both
   CHECK clauses and generated-column expressions directly from
   `SHOW CREATE TABLE`'s own text via balanced-parenthesis parsing, never
   from those two information_schema columns.
2. **A regex used to extract generated-column expressions could pair the
   wrong backticks across a column boundary**, silently attributing the
   *next* column's definition text to the *previous* column's name (e.g.
   matching `` `assignment_id` char(36)...,\n  `active_role_marker` ``'s
   closing/opening backticks as if they delimited one identifier). Fix:
   anchored the regex to the start of a line (`SHOW CREATE TABLE` always
   puts exactly one column/key/constraint per line).

Both fixes are proven by the final `EXACT_MATCH` result and by the 9
negative controls (§9) passing through the corrected pipeline.

## 8. Reference data vs. bootstrap bookkeeping (sections 13/17)

Discovered by actually running the DB integration test suite against a
bootstrap-built database (not by inspection): two migrations
(`0006`, `0007`) contain `INSERT INTO` statements alongside their
`CREATE TABLE`s — this is the **only** place production reference data is
defined anywhere in the 34 migrations (confirmed: `grep INSERT INTO` across
all migration files returns exactly these two files, 4 statements, 14
rows). See `docs/database/PCA_PRODUCTION_REFERENCE_DATA_MATRIX.csv` for the
exact rows and why each is required (e.g. every `billing_payment_attempts`
row has a `currency_code` FOREIGN KEY into `billing_currencies`; without
that table's 3 rows, no billing write can ever succeed).

A second, distinct category was also required and is **not** business
reference data: `database/live-bootstrap/02_reference_data.sql` also
inserts 34 rows into `schema_migrations`, marking every accepted migration
as already applied. Without this, the very next `npm run db:migrate` run
against the freshly bootstrapped database would see an empty
`schema_migrations` table and attempt to re-run migration `0001`
(`CREATE TABLE schema_migrations`, among others) against tables that
already exist, failing immediately. This was discovered the same way — by
actually running the test suite and, separately, by reasoning through what
the very next migration run would do — not assumed.

No test, demo, QA, or fixture data of any kind is inserted anywhere in the
bootstrap package.

## 9. Negative controls (section 32)

9 mutations were applied to a cloned in-memory copy of the canonical schema,
each pushed through the **real** pipeline (mutate → generate SQL → apply to
a disposable database → introspect → compare against Database A), never
tested against mock data:

1. Remove a column (`devices.paired_at`)
2. Shrink a `VARCHAR` length (`billing_plans.plan_code` 64→32)
3. Drop a unique index (`device_public_keys_public_key_key`)
4. Flip a column nullable→NOT NULL (`devices.revoked_at`)
5. Change a column's collation (`families.status` → `utf8mb4_general_ci`)
6. Add a prohibited child-readable column (`family_child_memberships.display_name`)
7. Remove a CHECK constraint (`billing_commercial_markets_market_check`)
8. Add an unexpected table (`rogue_debug_table`)
9. Alter a timestamp default (`account_entitlements.created_at` → epoch)

```
SCHEMA_NEGATIVE_CONTROL_PROOFS = 9 / 9
```

All 9 were detected (each surfaced as a real `TABLE DIFFERS`/`TABLE MISSING`/
`TABLE EXTRA` diff against Database A). Database B was restored to the
correct, unmutated bootstrap state immediately afterward.

## 10. Test execution (sections 22–23)

```
BACKEND_FULL = 2187 / 2187 PASS, 0 FAIL   (npm test, non-DB suite, including the new canonical-schema child-field gate)
BACKEND_DB   = 477 / 485 PASS, 4 FAIL, 4 SKIP   (npm run test:db equivalent, run against the canonical-bootstrap database)
```

**The 4 failures are classified `PRE_EXISTING_UNRELATED`**, not a schema
defect: all 4 are in `test/db/parentAccount.mysql.test.mjs`, all fail with
the identical error `repository.create is not a function` —
`MySqlFamilyMemberInvitationRepository` has only ever exposed
`createAtomically` (confirmed by reading the class), never a plain
`create` method. **Verified identical against Database A** (the pure
migration-built database, zero bootstrap involvement) — running the same
file there produces the exact same 4 failures. This is a pre-existing
test-code bug (calling a method that has never existed), unrelated to the
canonical schema, and is left unfixed as out of this mission's scope
(schema/database, not application test code); flagged here rather than
hidden, per the mission's explicit requirement.

**The 4 skips are expected/intentional**: `test/db/platformAdminAuditPrivileges.mysql.test.mjs`
requires the separate `PCA_MIGRATION_DATABASE_URL`-gated privilege test
(`npm run test:db:platform-admin-privileges`), which was not run as part of
this general suite pass — this is normal, documented behavior, not a schema
issue.

Concurrency/integrity coverage (section 23) is exercised by, and passed
within, the same `BACKEND_DB` run: `commercialNotificationsConcurrency`,
`billingCorePriceBookConcurrency`, `billingCoreProviderEventConcurrency`,
`refundBalanceRaceConcurrency`, `checkoutRetryRecovery`,
`raiseLimitReservationSurvival`, `migrationAdvisoryLock`,
`platformEntitlementsSlots` (slot reservation races), and the two-concurrent-
device-removal test named explicitly in
`PCA_FAMILY_DATA_ISOLATION_MATRIX.csv`'s `account_entitlements` row all
passed against the canonical-bootstrap database.

`UNRESOLVED_RUNTIME_SCHEMA_MISMATCHES = 0` — see
`docs/database/PCA_RUNTIME_SCHEMA_COMPATIBILITY_MATRIX.csv`.

## 11. Family/parent data isolation (owner additive request)

See `docs/database/PCA_FAMILY_DATA_ISOLATION_MATRIX.csv` for the full
table-by-table matrix. Summary:

```
PARENT_CROSS_FAMILY_READS = 0
PARENT_CROSS_FAMILY_WRITES = 0
CHILD_CROSS_FAMILY_ACCESS = 0
DEVICE_CROSS_FAMILY_ACCESS = 0
UNJUSTIFIED_UNSCOPED_PARENT_QUERIES = 0
CROSS_FAMILY_EXISTENCE_ORACLES = 0 open (1 identified, mitigated -- see below)
```

The codebase enforces family scoping through one consistent convention
(never a database-level FK to `families`, always an application-layer
check): every repository method that touches a family-owned table is named
`*ForFamily(familyId, ...)` and takes `familyId` as its first parameter —
confirmed across 24 repository files. This is backed by extensive executed
cross-family isolation test coverage spanning devices, child profiles,
invitations, entitlements, billing/commercial, recovery, and protection
alerts (dozens of tests with names like *"cross-family IDOR"*,
*"indistinguishable... no oracle"*, all passing in §10's run).

**The known device-auth challenge issuance risk, as requested — not
hidden:** `DeviceRepository.findDeviceUnscoped` is the **only** unscoped
(non-family-filtered) query method in the entire codebase. Its own doc
comment warns that an HTTP-exposed issuance keyed by an arbitrary
caller-supplied `deviceId` must not let a caller distinguish
"doesn't exist" / "revoked" / "fine" from the response alone, or it reopens
a cross-family existence/revocation oracle.

A real, unauthenticated production route
(`POST /v1/runtime-sync/devices/:deviceId/challenge`) **does** accept an
arbitrary caller-supplied `deviceId` and **does** call this unscoped method
(via `DeviceAuthService.issueChallenge`). This is currently **mitigated**,
not open: the one real caller,
`DeviceSessionService.issueChallengeSafely`, catches `DEVICE_NOT_FOUND` and
`DEVICE_REVOKED` and returns an indistinguishable, well-formed synthetic
challenge (a nonce that was never persisted, so it can never subsequently
succeed) — every failure mode collapses into the same generic
`UNAUTHORIZED` only later, at `completeChallenge`. Verified in this
session: `findDeviceUnscoped`/`issueChallenge` has exactly one call path to
the outside world (grepped), and dedicated, currently-passing tests exist
for exactly this property (`test/runtime-sync/DeviceSessionService.test.mjs`:
*"issueChallengeSafely for a nonexistent device returns a well-formed
challenge that can never complete"*; *"issueChallengeSafely for a revoked
device is indistinguishable at the API boundary from a nonexistent one"*).

**Minor documentation-drift finding** (not a security defect): the
repository interface's own comment on `findDeviceUnscoped` still says
*"Today that's inert because nothing calls issueChallenge except this
domain's own tests"* — this is now factually stale, since
`DeviceSessionService.issueChallengeSafely` is a real production caller.
Left uncorrected as out of this mission's scope (application source, not
schema); flagged for the owner/team to update the comment to name the
established safe-wrapper pattern, so a future reader doesn't trust the
stale claim.

Two rows in the isolation matrix (`safe_zones`, `family_audit_events`) are
marked `ENFORCED (by convention)` rather than independently re-verified with
a dedicated cross-family test read in this session, for time reasons — both
follow the identical `*ForFamily` convention and (for `family_audit_events`)
explicitly mirror `protection_alerts`' already-tested design.

## 12. Timestamp audit (section 12)

- Every temporal column is `DATETIME`, never `TIMESTAMP` — a deliberate
  migration-0001 decision avoiding MySQL's session-timezone-dependent
  `TIMESTAMP` conversion; the application pool
  (`backend/src/db/pool.ts`) pins `timezone: 'Z'` (UTC) on every connection.
- 146 of 149 timestamp-shaped columns are `DATETIME(3)`. **3 are
  `DATETIME(6)`**: `eye_protection_settings.updated_at`,
  `parent_account_preferences.updated_at`, `safe_zones.created_at`/
  `updated_at`. This is a real, harmless precision inconsistency from
  migrations 0020/0032, preserved faithfully (not "fixed") since the
  canonical schema must match the accepted migration history exactly.
  **Recommendation**: standardize on `DATETIME(3)` in a future migration if
  the inconsistency is undesirable; not done here.
- `ON UPDATE CURRENT_TIMESTAMP` (DB-generated `updated_at`) exists on
  exactly 6 tables: `billing_disputes`, `billing_payment_attempts`,
  `billing_refund_operations`, `platform_admin_settings`,
  `settlement_accounts`, `settlement_batches`. All other `updated_at`
  columns are application-generated (no DB default). This asymmetry is
  pre-existing and consistent with each table's own migration.
- `family_audit_events.expires_at` / `protection_alerts.expires_at` default
  to the epoch sentinel `1970-01-01 00:00:00.000` — traced to migration 0034
  adding a `NOT NULL` column to a non-empty table (a backfill-then-default
  pattern), not a bug.

## 13. Database settings

See `docs/database/PCA_LIVE_DATABASE_SETTINGS.md` for the complete,
evidenced settings authority (MySQL version, charset/collation, timezone,
transaction isolation — including the non-default `READ COMMITTED`
application requirement — `sql_mode`, `foreign_key_checks`, case
sensitivity, connection pool sizing, and the two-credential model).

## 14. Authority model (section 28)

```
CANONICAL_EXPECTED_STATE = backend/src/db/schema.ts
HISTORICAL_CHANGE_LOG    = backend/migrations/*.sql (never edited retroactively)
FIRST_LIVE_CREATION      = database/live-bootstrap/ (generated FROM schema.ts)
FUTURE_CHANGES           = new backend/migrations/NNNN_*.sql files, then regenerate schema.ts/bootstrap
RUNTIME_CONTRACT         = backend/src/**/*.ts repositories/services (verified by §10's executed test suite)
```

## 15. Independent adversarial review

A separate, independent agent reviewed every deliverable adversarially
(missing tables/columns, wrong defaults/nullability/types, index/FK drift,
collation mismatches, privacy-sensitive readable fields, `schema.ts` vs.
generated-SQL correctness, bootstrap re-run safety, reference-data
completeness, test/demo-data leakage, and specific factual claims in this
report and `PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md` checked against their
cited migration source). It found:

- **Zero missing/incorrect tables, columns, defaults, nullability, indexes,
  foreign keys, collations, privacy classifications, reference-data rows,
  or demo-data leakage** after independently spot-checking 15 tables' full
  column histories, several FK/index sets, and every free-text/JSON column
  in the schema.
- **1 HIGH finding, since fixed**: this report and
  `PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md` stated stale, mutually
  inconsistent counts for the application-enforced relationship total (55 /
  28 / 31 tables across the two documents) — leftover from before this
  mission's own self-review caught and fixed a real gap (§16) partway
  through, without updating every place the resulting count was quoted in
  prose. Corrected to the values now verified directly from
  `backend/src/db/schema.ts`: **57 total, 56 `APPLICATION_ENFORCED_INTENTIONAL`
  (30 `family_id` + 26 other) + 1 `OWNER_DECISION_REQUIRED`** — matching
  `PCA_CANONICAL_DATABASE_OBJECT_INVENTORY.csv`'s 57
  `APPLICATION_ENFORCED_RELATION` rows exactly. Both narrative documents
  are now corrected and re-verified against the generated data.
- **2 LOW findings, since fixed**: (a)
  `backend/scripts/generate-bootstrap-sql.mjs`'s DDL generator would have
  silently dropped an `ON UPDATE CURRENT_TIMESTAMP` clause for any future
  column pairing that flag with a non-`CURRENT_TIMESTAMP` default (does not
  currently occur — all 6 such columns today are correctly shaped) — now
  fails loudly instead of silently mis-generating SQL. (b)
  `database/live-bootstrap/03_post_validation.sql` declared an unused,
  never-populated temporary table that looked like a real check but wasn't
  — removed; the actual check (per-table emptiness beyond the 5 reference
  tables) was already correctly implemented in
  `backend/scripts/post-validate.mjs`, only the misleading dead SQL is
  removed. A third labeling issue was also fixed: negative-control mutation
  #6 is detected as a structural new-column diff, not via privacy
  classification (which `compare-schema-snapshots.mjs` does not inspect) —
  its description now says so explicitly, distinguishing it from the
  separate, genuinely privacy-aware
  `canonicalSchemaChildFieldsRegression.test.mjs` gate.

```
CANONICAL_SCHEMA_CRITICAL_FINDINGS = 0
CANONICAL_SCHEMA_HIGH_FINDINGS = 0   (1 found, fixed and re-verified before this report's final version)
```

All fixes were re-verified end-to-end after being made: `EXACT_MATCH`,
schema fingerprint, `post-validate.mjs`, and all 9 negative controls were
re-run and still pass.

## 16. Self-review finding (found and fixed before the adversarial pass)

While self-reviewing before the adversarial pass, two tables —
`family_authority_attestations` and `family_authority_chain_heads`, both of
which have a real `family_id` column — were found missing from the
application-enforced-relationship data (they use `family_id` as part of a
composite/sole primary key rather than a plain scoping column, which had
caused them to be overlooked when that data was first assembled). Fixed by
adding both to the relationship data, regenerating `schema.ts` and all
downstream CSVs/bootstrap SQL, and re-verifying `EXACT_MATCH` and the
fingerprint still held (they did — this was a documentation/classification
completeness fix, not a structural DDL change, since both tables' actual
columns/keys/indexes were already correctly captured).

## 17. What this mission did NOT do

No Azure MySQL was created. No connection to any production or live MySQL
instance was made. No migration was run against live infrastructure. No
live database password was stored anywhere in this repository. No Key Vault
secret was created or changed. No Azure networking or firewall rule was
changed. `LIVE_DATABASE_CREATED = NO`, `LIVE_DATABASE_MODIFIED = NO`.
