# PCA Azure Disposable Database Validation Report

Date: 2026-09-07. Target: the authorized Azure MySQL **disposable/integration**
database only. This is not, and is nowhere treated as, the PCA production
database.

## Outcome in one line

```
PHASE_1_PREFLIGHT = BLOCKED — the server is MySQL 8.0.45-azure, not 8.4.x.
```

Per this phase's own instruction ("If the server is not MySQL 8.4, STOP and
report the mismatch before performing migrations"), **no migration, DDL, DML or
test was run against the Azure database.** The mismatch was established without
using the credential at all, so nothing was connected, created or modified.

---

## 1. Repository baseline

```
BRANCH        = pca-dev
HEAD          = 3b1e39fa4932585cd1c6c5e7df98fde0ef731dfe
ORIGIN_MAIN   = f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd   UNTOUCHED
WORKTREE      = clean at session start
```

The stated W3 tip `d594450` **was** the tip at session start and was verified as
such. It is no longer the tip: three commits were added earlier in this session
(release-A evidence fixes, an Android CI diagnostic, and an Android test race
fix) — see the External Readiness report for those. `4615cc7` remains in
history as the W3 substantive commit.

**Migration state (repository side, counted here):**

```
MIGRATION_FILES   = 38   (0001_mysql_baseline .. 0040_delete_now_ledger)
NUMBERING_GAPS    = 0009, 0010 absent  (38 files across a 1..40 range)
MIGRATION_ENGINE  = backend/scripts/migrate.mjs  (npm run db:migrate)
JOURNAL_TABLE     = schema_migrations, keyed by migration FILENAME
CONCURRENCY_GUARD = MySQL advisory lock around the journal read + apply
```

The numbering gap is pre-existing and benign: the journal keys on filename, not
on a contiguous sequence, so absent numbers cannot desynchronise it.

`STATUS = PASS` (repository baseline established).

---

## 2. Azure database identity

```
HOST              = ims-platform.mysql.database.azure.com
RESOLVED_ADDRESS  = 74.162.137.166
PORT              = 3306   TCP reachable from this machine
DATABASE (target) = disposable
USER              = scnwkdpcjb
CONNECTED         = NO — no authenticated connection was opened
```

Network path and firewall allow-listing are therefore **already working** — one
fewer unknown for whenever this resumes.

**The credential was never supplied and was never requested in chat.** No
password for this server exists anywhere on this machine: the environment
carries no matching variable, and the repository's only Azure env file
(`.env.azure`, gitignored and untracked) is a placeholder template — it names
`your-db-server.mysql.database.azure.com`, user `dbadmin@your-db-server`,
database `pca_prod`, under legacy `POSTGRES_*` key names.

`STATUS = PASS_WITH_FINDINGS` (identity and reachability confirmed; see
finding F-3 on the stale env template).

---

## 3. MySQL version and configuration

**This is the blocker.**

```
SERVER_VERSION  = 8.0.45-azure
REQUIRED        = exactly 8.4.x
VERDICT         = MISMATCH
```

**How this was determined without credentials.** MySQL sends its version in the
initial handshake packet, before authentication. Reading that packet directly
returned `8.0.45-azure` on **three consecutive independent connections** —
stable, not a transient or a gateway artifact. Protocol version 10, and the
server advertises the `CLIENT_SSL` capability flag.

**The repository already fails closed on this**, by design and without any
change from me. `backend/scripts/verify-mysql.mjs` pins the version exactly:

```
REQUIRED_MAJOR_VERSION = 8
REQUIRED_MINOR_VERSION = 4
→ throws: "Unsupported MySQL version: must be exactly 8.4.x. Found: 8.0.45-azure"
```

That check is the **first** thing `npm run test:db` runs, before any test file.
So the entire database-backed suite would refuse to start against this server —
correctly. The gate is doing its job.

This is also exactly the position the repository already documents.
`docs/database/PCA_LIVE_DATABASE_SETTINGS.md` states that MySQL 8.0.x is "very
likely compatible … but is UNVERIFIED by this mission — Database A and B were
both built on 8.4. Pin production to 8.4 unless the owner independently
verifies 8.0."

**Not done, deliberately:** the version gate was not relaxed, and the
application was not adapted to 8.0.x. Either would be exactly the "silently
adapt" outcome this phase forbids, and it would discard the only control
currently preventing an unvalidated engine version from being treated as
validated.

`STATUS = FAIL` (against the 8.4 requirement) → phase halted here.

---

## 4. TLS / SSL verification

```
SERVER_ADVERTISES_TLS = YES  (CLIENT_SSL capability flag set in the handshake)
SESSION_TLS_CONFIRMED = NOT_TESTED  (requires an authenticated connection)
require_secure_transport = NOT_TESTED
```

Independently of Azure, a **repository-side TLS defect** was found and proved by
execution — see finding **F-1**, which is security-relevant and does not depend
on the version mismatch.

`STATUS = PASS_WITH_FINDINGS` for what could be observed; `NOT_TESTED` for the
session-level confirmation.

---

## 5. Migration execution

`STATUS = BLOCKED` — halted by §3, as instructed. No migration was executed, no
DDL ran, and nothing on the Azure server was created, altered or dropped.

---

## 6. Schema inventory

Repository side only. The live side was not read.

| Object | Repository / canonical | Source |
|---|---|---|
| Tables | 78 | 75 in the canonical inventory + 2 added by 0039/0040 + `schema_migrations` |
| Columns | 646 | W3 real-database measurement |
| Foreign keys | 83 | canonical inventory, unchanged |
| Unique (non-PK) indexes | 32 | 31 inventory + 1 from W3 |
| Non-unique indexes | 119 | 117 inventory + 2 from W3 |
| `schema_migrations` rows after a clean run | 38 | one per migration file |
| Views / triggers / procedures | 0 | none defined in any migration |
| Application-enforced (soft) relations | 56 | deliberate, documented convention |

`AZURE_SCHEMA_INVENTORY = NOT_TESTED`.

**Minor documentation drift (F-4):**
`docs/database/PCA_CANONICAL_DATABASE_OBJECT_INVENTORY.csv` still records the
pre-W3 totals (75 tables / 117 indexes / 31 unique). W3 updated
`PCA_LIVE_DATABASE_SETTINGS.md` but not this CSV. The two reconcile exactly once
the 0039/0040 tables and `schema_migrations` are added, so this is staleness,
not disagreement.

`STATUS = PASS_WITH_FINDINGS` (repository side) / `NOT_TESTED` (Azure side).

---

## 7. Schema equivalence

`STATUS = NOT_TESTED`. Equivalence requires a migrated Azure schema to compare
against, which §3 blocks. The methodology is ready and unchanged
(`compare-schema-snapshots.mjs`, `schema-fingerprint.mjs`, and the SQL-native
`04_schema_fingerprint.sql`), and it reproduced cleanly on 8.4 during W3.

---

## 8. Application connectivity

Not exercised against Azure. Two things were established locally by execution:

- **Env override works.** Node's `--env-file` does *not* override a variable
  already present in the environment (verified directly). So exporting
  `PCA_DATABASE_URL` in the shell cleanly redirects `npm run test:db` at another
  server **without editing any repository file** — the right mechanism for this
  phase, when it can resume.
- **The connection path is `PCA_DATABASE_URL` only.** `backend/src/db/pool.ts`
  builds its pool from that single URI with `timezone: 'Z'`,
  `connectionLimit: 10`, keep-alive, and a 10s connect timeout.

`STATUS = NOT_TESTED`.

---

## 9–14. Database-backed tests, family isolation, constraints, email outbox, privacy, reset

All `NOT_TESTED` — every one of these requires a migrated Azure schema.

Two things worth recording now, so they are not discovered late:

**Reset/repeatability has a hard blocker of its own (F-2).**
`backend/scripts/reset-test-db.mjs` allow-lists exactly one database name:

```js
const ALLOWED_TEST_DATABASES = new Set(['pca_test']);
```

It refuses any other name before any `DROP DATABASE` runs. So the repository's
own reset mechanism **cannot** target `disposable`, and Phase 11 has no
repository-supported path today. **This guard must not be widened casually** —
it is the control that stops a mistyped variable from dropping the wrong
database. Extending it is an owner decision, and the safer shape is a separate,
explicitly-named disposable-reset path rather than adding a second entry to the
production-adjacent allow-list.

**Privacy invariants are unaffected by this phase.** Nothing was written
anywhere, so no central readable sensitive-data surface could be created. The
schema-level gates were re-run locally this session and pass (30/30). All nine
invariants remain at 0.

**Test-evidence classification, stated explicitly as required:**

```
UNIT / TEST DOUBLE       = PASS   (backend suite, unchanged, green in CI)
LOCAL MYSQL 8.4          = PASS   (W3 evidence; not re-run this session)
AZURE DISPOSABLE MYSQL   = NOT_TESTED
REAL EXTERNAL PROVIDER   = NOT_TESTED
REAL DEVICE              = NOT_TESTED
```

No test result anywhere in this report is claimed against the Azure database.

---

## 15. Defects discovered

### F-1 — The database connection has no TLS enforcement, and fails open to plaintext (security-relevant)

`getPool()` passes only `uri` to mysql2 and sets no `ssl` option. Parsing real
connection strings through mysql2's own config yielded:

| `PCA_DATABASE_URL` | resulting `ssl` |
|---|---|
| `mysql://…/disposable` | `false` — **plaintext** |
| `mysql://…/disposable?ssl={"rejectUnauthorized":true}` | proper TLS config |
| `mysql://…/disposable?ssl-mode=REQUIRED` | `false` — **silently ignored** |

The third row is the dangerous one. `ssl-mode=REQUIRED` is the standard MySQL
client spelling and the form an operator is most likely to reach for; mysql2
emits only a stderr warning ("Ignoring invalid configuration option") and
connects **unencrypted**. Whether PCA's database traffic — credentials and all
family data — is encrypted therefore rests entirely on an operator writing one
exact JSON fragment into a URL, with a plausible near-miss that fails open and
is easy to overlook in logs.

Nothing in the code, and no gate in the external gate matrix, enforces or checks
this. `DEPLOYED_TLS_TERMINATION_CONFIG` covers HTTPS termination at the edge,
not the application-to-database link.

**Reported, not fixed.** This phase authorises the smallest justified fix only
for a defect that *genuinely prevents the disposable-database validation*, and
this one does not — the version mismatch does. The fix is also a real design
decision (making TLS mandatory unconditionally would break the local plaintext
test container), so it needs an owner call between requiring TLS whenever the
runtime is production-sensitive versus requiring it for any non-loopback host.
Either way it needs a regression test, since the failure mode is silent.

`SEVERITY = HIGH for any deployed environment. Not currently exploitable —
nothing is deployed.`

### F-2 — The reset mechanism cannot target the authorized database

See §9–14. Correct, protective behaviour; recorded because it blocks Phase 11
until an owner decides how a disposable reset should be expressed.

### F-3 — `.env.azure` is a stale placeholder under the wrong key names

Gitignored and untracked, so it leaks nothing, but it uses `POSTGRES_*` names
(the pre-MySQL era) pointing at a `.mysql.database.azure.com` host and a
database called `pca_prod`. Anyone reaching for it as the Azure configuration
model would find the wrong variable names entirely — the backend reads
`PCA_DATABASE_URL`. It should be deleted or rewritten to the real key names.

### F-4 — Canonical object inventory CSV is one wave stale

See §6. Cosmetic; reconciles exactly.

**No defect was found in the migration engine, schema, or repository layer** —
none of those was reached.

---

## 16. Source changes made for this phase

**None.** No source, migration, script or configuration file was modified for
the Azure phase. The version mismatch is an environment fact, not a code defect,
and the repository's response to it is already correct.

(Three commits were made earlier in this session under the separate external
readiness phase; they are unrelated to the database layer and are documented in
that report.)

---

## 17. CI status

Current tip `3b1e39f`, run 34097745170: **21 of 22 green**.
`iOS build and unit tests` is the only failure — the known, root-caused,
`REAL_XCODE_BLOCKED` one. The Android job is green again after the test race fixed
in that same commit.

No release-control, backend, parent-web, platform-admin, public-web, security or
repository-quality job is red.

---

## 18. Production-readiness implications

This phase produced **no** evidence toward production readiness, and its result
must not be read as any. Specifically:

- `PCA schema works on Azure MySQL 8.4` — **still unproven**. The available
  server is 8.0.45.
- `PCA application connects to Azure` — **still unproven**.
- The one substantive new signal is negative and useful: the approved engine
  version is **not currently available on this server**, and the repository's
  own gate would have caught it before any migration — which is the gate
  behaving exactly as designed.

Everything in the External Readiness report stands unchanged. No release target
moved.

---

## 19. Remaining external blockers for this phase

1. **An Azure MySQL Flexible Server running 8.4.x** — or an explicit, recorded
   owner decision to qualify 8.0.45 as a supported engine, which would require
   its own validation and a deliberate change to the version gate, not a quiet
   relaxation of it.
2. **The `disposable` database password**, supplied out of band. It must never
   be pasted into a chat message. The workable route is a file outside the
   repository — for example `~/.pca-azure-disposable.env` containing
   `PCA_AZURE_DB_PASSWORD=…` — written directly by the owner, which tooling can
   then read into an environment variable without it ever being echoed.
   (A repository path would work too but sits one `git clean -x` from deletion.)
3. **An owner decision on F-2** — how a disposable-database reset should be
   expressed without widening the `pca_test` allow-list.

---

## 20. Exact next actions

**Blocking, in order:**

1. Provision or identify a **MySQL 8.4.x** Flexible Server for the disposable
   database, or record an explicit decision to qualify 8.0.x. Nothing else in
   this phase can proceed first.
2. Place the password in a file outside the repository, as above.

**Then, unchanged and ready to run:**

3. Preflight (`scratchpad/azure-preflight.mjs`, already written and
   guard-tested): it refuses to run without the password, refuses any database
   name other than `disposable`, keeps certificate verification on, and redacts
   the password from every line of output — including error messages.
4. `PCA_DATABASE_URL=… npm run db:migrate`, then `npm run db:verify`, then the
   schema-equivalence proof.
5. `PCA_DATABASE_URL=… npm run test:db` — the shell variable overrides
   `test.db.env`, so no repository file needs editing.
6. Phases 7–11 (family isolation, constraints, email outbox, privacy, reset)
   against the migrated Azure schema.

**Independent of all of the above:**

7. Decide **F-1**. It is the one finding here with real security weight, it
   applies to every deployed environment rather than only to this phase, and it
   is currently invisible to every gate in the release-control system.

---

## Status summary

```
1  Repository baseline .................... PASS
2  Azure database identity ................ PASS_WITH_FINDINGS
3  MySQL version / configuration .......... FAIL   (8.0.45, requires 8.4.x)
4  TLS / SSL verification ................. PASS_WITH_FINDINGS / NOT_TESTED
5  Migration execution .................... BLOCKED
6  Schema inventory ....................... PASS_WITH_FINDINGS / NOT_TESTED
7  Schema equivalence ..................... NOT_TESTED
8  Application connectivity ............... NOT_TESTED
9  Database-backed tests .................. NOT_TESTED
10 Family isolation tests ................. NOT_TESTED
11 Soft-delete / audit / constraints ...... NOT_TESTED
12 Email outbox persistence ............... NOT_TESTED
13 Privacy verification ................... PASS   (schema gates, local; nothing written)
14 Reset / repeatability .................. BLOCKED (F-2)
15 Defects discovered ..................... 4 (1 HIGH, security-relevant)
16 Source changes ......................... NONE
17 CI status .............................. 21/22 green, iOS known-red
18 Production-readiness implications ...... NONE GAINED
19 Remaining external blockers ............ 3
20 Next actions ........................... 7

DATABASE_TARGET      = disposable        (authorized, not connected)
MYSQL_TARGET         = 8.4.x             NOT MET (8.0.45-azure)
SSL_REQUIRED         = NOT_TESTED
AZURE_DB_MODIFIED    = NO
PRODUCTION_DB_TOUCHED = NO
ORIGIN_MAIN_MODIFIED = NO
```
