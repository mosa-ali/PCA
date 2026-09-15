# PCA Session 2D — Canonical Schema Reconciliation + Production DB Pre-Bootstrap Certification

Date: 2026-09-15
Repository: `D:\PCA\pca-app`, branch `pca-dev`
Required starting baseline: `40e2f4c00e320b0f55ebd3311fc76be60b598436` — confirmed exact at session start
(local, remote, and worktree clean).

Production bootstrap remains **UNAUTHORIZED**. No production APP_OWNER was
created. `bootstrap-platform-owner.mjs` was never run against production.
`mdrwesh@outlook.com` was never activated or modified. No production
database was mutated. No deploy happened. `pcaSafe` was not touched. No
database credential, connection string, or Key Vault *value* is printed
anywhere in this document or was printed in this session's terminal output.

## A. Baseline

```text
LOCAL_HEAD=40e2f4c00e320b0f55ebd3311fc76be60b598436
REMOTE_HEAD=40e2f4c00e320b0f55ebd3311fc76be60b598436
BRANCH=pca-dev
WORKTREE_CLEAN=YES
```

Confirmed via `git fetch` + `git rev-parse` before any other action.

## B. CI observation for commit `40e2f4c`

Queried the GitHub Actions REST API directly (this repository is public, so
check-run data is readable unauthenticated; job *logs* required an
authenticated request, made using the already-trusted git credential for
`github.com`, never printed, used only in an `Authorization` header for a
read-only API call).

```text
CI_RUN_ID=35010662198
CI_RUN_NUMBER=(not separately queried; run ID above is authoritative)
CI_BOOTSTRAP_JOB_PRESENT=YES
CI_BOOTSTRAP_JOB_STATUS=completed
CI_BOOTSTRAP_JOB_CONCLUSION=failure
```

**This job actually ran and actually failed** — not a YAML-inspection
guess. Its real log (job id `104521493912`) shows:

```
Error: Unsupported time zone: GLOBAL and SESSION time_zone must both be +00:00 (UTC). Found GLOBAL=SYSTEM SESSION=SYSTEM.
```

**Root cause**: `backend/scripts/verify-mysql.mjs`'s `assertSupportedEnvironment`
requires the MySQL server's `GLOBAL`/`SESSION` `time_zone` to be exactly
`+00:00`. The repository's own `docker-compose.yml` gets this by passing
`--default-time-zone=+00:00` to the `mysql:8.4.11` container's startup
command. GitHub Actions' `services:` schema has **no equivalent** of
docker-compose's `command:` override to pass that flag to the container's
entrypoint, so the CI service container booted with the default `SYSTEM`
time zone instead, and the check correctly, honestly failed rather than
silently passing against a differently-configured server.

**Fix**: added a step, "Set disposable MySQL service to UTC," that runs
`SET GLOBAL time_zone = '+00:00'` via the backend's own `mysql2` dependency
immediately after `npm ci` and before `npm run test:db:bootstrap`. Verified
locally: the exact command was run against the local disposable MySQL and
confirmed both `@@GLOBAL.time_zone` and `@@SESSION.time_zone` become
`+00:00` afterward.

A second job also failed on the same commit — `Backend build and unit
tests`, conclusion `failure`. Its real log confirms this is **the same
pre-existing schema-drift defect closed in §C/D below**
(`test/scripts/disposableBootstrapArtifact.test.mjs`'s two failures), not a
new or separate problem:

```
not ok 2182 - the committed artifacts match what the repository generates today
not ok 2183 - every expected count is derived from the canonical schema, not typed in
```

Both fixes are included in this session's commit; neither CI run has been
re-observed passing yet (see §O's `CI_BOOTSTRAP_JOB_CONCLUSION`, which
reports the ALREADY-OBSERVED failing run above, not a prediction).

## C. Canonical schema drift — investigated, not assumed

**What `PCA_CANONICAL_SCHEMA` actually represents** (from `backend/src/db/schema.ts`'s
own header, read in full before touching anything): the single declarative
source of truth for the complete PCA schema, derived by applying every
accepted migration from empty and introspecting the result. Its own
`AUTHORITY MODEL` comment explicitly documents the process for adding a new
migration: *"this file should then be regenerated/diffed for drift, not
hand-edited ahead of the migration."* Before this session, the file's own
header stated its derivation boundary as *"migrations 0001 through 0040"* —
`platform_admin_activation_tokens` (migration `0041`) was never added after
0041 landed. This is exactly the mechanical regeneration lag the file's own
process describes, not a considered decision to exclude the table, and not
random hand-editing.

**Compared against**: migration `0041_platform_admin_activation_tokens.sql`
(read in full); `verify-mysql.mjs` (already found broken by this same gap
in the prior certification session, already fixed there); a disposable
MySQL 8.4.11 database migrated from zero with all 39 migrations (introspected
directly — not assumed); `test/canonicalSchemaChildFieldsRegression.test.mjs`
(the actual privacy-aware consumer — see below); `test/scripts/disposableBootstrapArtifact.test.mjs`
(the schema.ts-vs-generated-artifact consistency gate).

**Runtime consumers checked**: `compare-schema-snapshots.mjs` and
`schema-fingerprint.mjs` have **no awareness of the `privacy` field at
all** — confirmed by reading their source; they compare/hash only
structural facts (types, keys, indexes, FKs, checks). The **actual**
privacy-aware gate is `test/canonicalSchemaChildFieldsRegression.test.mjs`,
which scans every column's name against a prohibited-term list and asserts
zero columns are ever classified `READABLE_CHILD_DATA`.

**Classification, by direct precedent, not invented**: `platform_admin_sessions.token_hash`
— structurally identical to the new table's `token_hash` (`char(64)`
ascii, a SHA-256 hex digest of a bearer token, unique-keyed, regex-checked)
— is already classified `SECURITY_METADATA`, note: *"Authentication/
verification/integrity hash material, never a raw secret or raw identifying
value."* The new table's `token_hash` is classified identically, for the
identical reason: migration `0041`'s own header states *"Only a SHA-256
token digest is stored; the bearer token exists only in the issuing request
and encrypted email outbox payload"* — confirmed independently by reading
`PlatformAdminActivationService.generateActivationToken`/`hashActivationToken`,
which never persist the raw token anywhere.

```text
CANONICAL_SCHEMA_DRIFT=YES
ACTIVATION_TABLE_CLASSIFICATION=activation_id=OPAQUE_IDENTIFIER, admin_id=OPAQUE_IDENTIFIER, token_hash=SECURITY_METADATA, purpose=OPERATIONAL_METADATA, created_at/expires_at/used_at/revoked_at=OPERATIONAL_METADATA
PRIVACY_IMPACT=NONE_NEGATIVE — no column carries a raw password, raw activation token, raw TOTP secret, or any family/child/message content; token_hash is a one-way SHA-256 digest, never reversible to the bearer token
CENTRAL_READABLE_CONTENT_IMPACT=NONE — zero columns classified READABLE_PARENT_DATA/READABLE_CHILD_DATA; canonicalSchemaChildFieldsRegression.test.mjs passes with this table present (no column name matches any prohibited central-child-data term); the structural comparators (compare-schema-snapshots.mjs, schema-fingerprint.mjs) have no privacy awareness at all, so adding this table cannot silently change what those specific tools would flag as "readable"
```

## D. Fix applied — smallest source correction

Added exactly one `TableDefinition` entry (`platform_admin_activation_tokens`)
to `backend/src/db/schema.ts`, in its correct alphabetical position, with
every structural fact (column types, charsets, collations, PK, unique
index, non-unique index, FK, three CHECK constraints) taken directly from a
fresh `introspect-schema.mjs` run against a from-zero-migrated disposable
database — never hand-guessed. Also corrected the file's own header comment,
which was already stale before this session (it said "76 tables"; the
array actually held 78 entries, matching `post-validate.mjs`'s own "77th/78th
tables" comment after migrations 0039/0040 — a separate, pre-existing,
now also-corrected inaccuracy).

Updated the corresponding artifacts, all mechanically regenerated or
directly re-derived, never hand-typed:

- `backend/scripts/post-validate.mjs` — `EXPECTED_FINGERPRINT` updated to
  the new, independently-verified hash (see below).
- `docs/database/bootstrap/PCA_MYSQL_8_4_DISPOSABLE_BOOTSTRAP.sql` and
  `..._VERIFY.sql` — regenerated via `node scripts/generate-disposable-bootstrap.mjs`.
- `docs/database/PCA_CENTRAL_DATA_PRIVACY_CLASSIFICATION.csv` — 8 new rows
  added, matching `schema.ts` exactly.
- `docs/database/PCA_CANONICAL_SCHEMA_REPORT.md` — a new, explicitly-scoped
  §20 addendum (does **not** rewrite or re-verify the report's earlier
  narrative for migrations 0038–0040, which remains separately, honestly
  flagged as not re-audited here).
- `backend/test/canonicalSchemaChildFieldsRegression.test.mjs` — stale
  hardcoded counts removed from prose comments (the test logic itself never
  hardcoded a count).

**Real verification, not assumption** — a second disposable database was
created, the regenerated bootstrap SQL applied to it, both databases
introspected, and compared:

```text
MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP=EXACT_MATCH (compare-schema-snapshots.mjs, run against two real introspections)
CANONICAL_SCHEMA_FINGERPRINT=sha256:3a736bd2d1d39378f7e83af7fc68164033e38c6b02f292268178c24f5b98ccf3
  (independently computed identically from BOTH the migration-built database and the schema.ts-generated bootstrap-built database; previous value was sha256:278c141ea752ea9a1867693810d2e5380b5c1ca4568b12d4c8952ba4f680329f)

SCHEMA_CHANGED=NO
MIGRATION_ADDED=NO
```

(`SCHEMA_CHANGED=NO` here means: no migration was added or modified, and no
database schema was altered anywhere, disposable or production — only the
TypeScript description of an already-existing, already-migrated table was
corrected. The generated SQL artifacts changed as a mechanical consequence,
per their own "regenerate, never hand-edit" contract.)

### Regression (mission §D/§M)

```text
BACKEND_TYPECHECK=PASS (npm run build / tsc, zero errors)
SCHEMA_TESTS=PASS (test/canonicalSchemaChildFieldsRegression.test.mjs, test/scripts/disposableBootstrapArtifact.test.mjs — 41 tests total across both, 0 fail)
PRIVACY_TESTS=PASS (test/schema-privacy.test.mjs, included in the same 41)
DB_VERIFY=PASS (scripts/verify-mysql.mjs, part of test:db:bootstrap's chain, against a fresh 39-migration disposable database)
DB_BOOTSTRAP_CERTIFICATION=PASS (npm run test:db:bootstrap, 10/10, re-run twice this session)
BACKEND_TESTS=PASS (npm test, full non-DB suite: 2364/2364 — was 2362/2364 before this fix; the 2 new failures were exactly the disposableBootstrapArtifact.test.mjs ones this section closes)
```

## E. Production DB — read-only facts, secret-free mechanisms only

**What was NOT done**: the app's `PCA_DATABASE_URL` setting is a Key Vault
*reference* (`@Microsoft.KeyVault(VaultName=pca-key;SecretName=PCA-DATABASE-URL)`),
never a raw value in App Service configuration — confirmed, and its value
was never resolved or read. The backend's own temporary diagnostic endpoint
that could have answered several of these questions
(`GET /platform-admin/internal/db-runtime-diagnostic`) requires an
authenticated `PLATFORM_ADMIN`/`APP_OWNER` session — obtaining one would
require activating or otherwise touching the existing Platform Admin
account, which this mission explicitly forbids, so it was never called
(confirmed only reachable-but-unauthenticated: a probe with no credentials
returned `401`, proving the route exists and correctly refuses without
touching the account). An attempt to get a direct runtime shell into the
App Service container (`az webapp ssh`, to run a read-only DNS/TLS check)
was **blocked by this session's own sandbox policy** as sensitive remote
execution; this was not attempted again by another route.

**What secret-free mechanisms remained, and what they proved**, all via
Azure Resource Manager metadata (never a database connection, never a
credential):

```text
DB_RUNTIME_ACCOUNT=UNVERIFIED (no secret-free mechanism available this session to observe the actual connected MySQL user; would require either the (now-removed) diagnostic endpoint under proper authorization, or an owner-relayed SELECT CURRENT_USER())
ACTIVE_DATABASE=pca_pro (CONFIRMED — `az mysql flexible-server db list`, a management-plane call requiring no database credential, lists exactly one application database: pca_pro, utf8mb4/utf8mb4_bin)
MYSQL_VERSION=8.4.9 (CONFIRMED — `az mysql flexible-server show`, fullVersion field)
TLS_PROTOCOL=TLSv1.2 or TLSv1.3 (CONFIRMED as the enforced RANGE, not the exact negotiated session value — the server's `tls_version` parameter is set to exactly `TLSv1.2,TLSv1.3`, and `require_secure_transport=ON`, both confirmed via Azure Resource Manager server-parameter queries, no DB credential needed. The app is separately configured `PCA_DATABASE_TLS=REQUIRED` (a non-secret app-setting value, safe to read). Any connection that succeeds at all is therefore provably encrypted with TLS 1.2 or 1.3; the EXACT protocol/cipher negotiated by a live connection was not independently observed.)
TLS_CIPHER=UNVERIFIED (same reason as DB_RUNTIME_ACCOUNT -- needs a live connection's session status, not exposed by the management plane)
DB_TLS_RUNTIME=PASS (server-enforced: require_secure_transport=ON; server only permits TLSv1.2/TLSv1.3; app configured to require TLS. A successful connection cannot be plaintext or below TLS1.2, by server-side enforcement independent of app behavior.)
```

## F. Private network path — proof attempted, partially blocked

**Configuration evidence gathered** (all via Azure Resource Manager, no
credentials):

- The `pca` App Service has regional VNet integration into
  `vnet-uqtkeyex/subnet-vtfnysly`.
- `pca-mysql` (the flexible server) has an **approved** private endpoint
  connection (`pca-mysql-pe`) in the **same resource group** as the App
  Service.
- A private DNS zone `privatelink.mysql.database.azure.com` exists, is
  linked to that **same** VNet (`vnet-uqtkeyex`), and contains an `A`
  record for `pca-mysql`, auto-created by that same private endpoint.

This is the standard, documented shape of a working Azure Private Link
setup: a client resolving `pca-mysql.mysql.database.azure.com` from inside
`vnet-uqtkeyex` should receive the private endpoint's private IP via that
linked zone, not the server's public IP.

**However**, the flexible server resource itself also has
`publicNetworkAccess: Enabled` — the server is not exclusively private at
the resource level, both paths exist as configured. Determining which path
the App Service's *actual runtime traffic* takes requires either an
in-container DNS lookup (blocked this session — see §E) or the app's own
diagnostic endpoint (auth-gated, correctly not used). Per the mission's own
explicit instruction ("prove, rather than infer from configuration"), this
is reported as unproved rather than inferred-and-asserted:

```text
DB_PRIVATE_PATH_RUNTIME=UNPROVED (strong supporting configuration evidence above; no in-session mechanism to observe actual DNS resolution/connection path from inside the App Service's network context)
DB_HOST_CLASSIFICATION=UNPROVED (the MySQL server resource itself has BOTH publicNetworkAccess=Enabled AND an approved private endpoint present -- a mixed posture at the resource level; which one the app's connection actually uses was not independently observed)
```

## G–J. Production schema/migration/grants/APP_OWNER state — blocked, honestly reported

Every one of these requires querying **database content** inside `pca_pro`
(row/table introspection, `SHOW GRANTS`, `SELECT ... FROM schema_migrations`,
`SELECT ... FROM platform_admin_role_assignments`), which needs an actual
authenticated MySQL connection. No secret-free mechanism for this exists
that this session could use without violating an explicit constraint:

- The app's DB credential is a Key Vault reference — resolving it violates
  "do not expose Key Vault values."
- The app's own diagnostic endpoint that reports exactly these facts
  requires a `PLATFORM_ADMIN`/`APP_OWNER` session — obtaining one requires
  touching the existing Platform Admin account, explicitly forbidden, and
  that endpoint has now been removed from source anyway (§L).
- A direct runtime shell was blocked by sandbox policy (§E).
- No human operator was available in this session to relay owner-run,
  read-only SQL results (the mechanism the prior session, `PCA_SESSION_2C_LIVE_ACCEPTANCE_2026-09-15.md`,
  successfully used).

```text
PRODUCTION_TABLE_COUNT=UNVERIFIED
PRODUCTION_SCHEMA_FINGERPRINT=UNVERIFIED
ACTIVATION_TOKEN_TABLE_PRESENT=UNVERIFIED
PRODUCTION_MIGRATION_COUNT=UNVERIFIED
PRODUCTION_LATEST_MIGRATION=UNVERIFIED
MIGRATION_0022_STATUS=UNVERIFIED
MIGRATION_0041_STATUS=UNVERIFIED
PRODUCTION_SCHEMA_READY=UNVERIFIED — per the mission's own instruction ("If production lacks required migrations... STOP before bootstrap authorization"), an UNVERIFIED state is treated as NOT ready. This alone is sufficient to keep READY_FOR_FIRST_APP_OWNER_BOOTSTRAP=NO regardless of every other finding in this document.

DB_LEAST_PRIVILEGE=UNVERIFIED
ACTIVATION_TABLE_RUNTIME_ACCESS=UNVERIFIED
EXCESSIVE_PRIVILEGES=UNVERIFIED

ACTIVE_APP_OWNER_COUNT=UNVERIFIED_THIS_SESSION (the prior session's owner-relayed, human-run SELECT reported 0 on 2026-09-15, before this session; not independently re-confirmed here, and the mission explicitly asked for reconfirmation, not reuse of the prior value)
PLATFORM_ADMIN_EXISTS=UNVERIFIED_THIS_SESSION (prior session's owner-relayed result: YES, role PLATFORM_ADMIN, status ACTIVE, MFA PENDING_SETUP -- not independently re-confirmed here)
PLATFORM_ADMIN_ROLE=UNVERIFIED_THIS_SESSION
PLATFORM_ADMIN_STATUS=UNVERIFIED_THIS_SESSION
PLATFORM_ADMIN_MFA_STATUS=UNVERIFIED_THIS_SESSION
```

**This is a real, material gap**, not a formality: the mission's own §J
"Expected prior state" language shows the owner already knows what the
answer *should* be; what's missing is this session's own independent
re-proof, which a genuine pre-bootstrap certification requires and which
this session could not obtain without violating one of its own explicit
constraints.

## K. SMTP precondition — read-only, secret-free

Checked via Key Vault secret **version metadata** only (`az keyvault
secret list-versions`) — version identifiers, creation timestamps, and
`enabled` flags, never a secret value:

```text
SMTP_REPLACEMENT_VERSION_PRESENT=YES (a second PCA-SMTP-PASSWORD version exists, created 2026-09-13, enabled=true; the original version, created 2026-09-07, also remains enabled=true)
SMTP_CURRENT_REFERENCE=VALID (the app's PCA_SMTP_PASSWORD setting references the vault/secret name with no version pinned, so it always resolves to the current/latest enabled version -- the 2026-09-13 replacement)
OLD_SMTP_VERSION_STATUS=ENABLED (the original, 2026-09-07 version is still enabled in Key Vault -- not disabled, not deleted. Per the mission's own instruction this is a standing security-cleanup item and was NOT rotated/disabled/deleted here, as not separately authorized.)
```

## L. Temporary diagnostic cleanup — found still present, source now removed

`backend/src/http/routes/platformadmin/dbRuntimeDiagnosticRoutes.ts`
existed at the session baseline, wired into
`backend/src/http/routes/platformadmin/index.ts`, and its own header
comment says: *"This route is intentionally platform-admin authenticated,
fixed-query only, read-only, and returns no connection material. It must
be removed after the owner captures the evidence; it is not a product
API."* That evidence has been captured across the prior sessions.

**Confirmed still live in the currently-deployed production container**,
by an unauthenticated, credential-free HTTP probe (no request body, no
auth header sent):

```text
GET https://pca-....azurewebsites.net/platform-admin/internal/db-runtime-diagnostic -> HTTP 401 (route exists, correctly requires auth -- a 404 would mean absent)
GET https://pca-....azurewebsites.net/health -> HTTP 200 (app is live and reachable)
```

**Fixed**: the route registration and its dedicated file were removed from
source this session (`backend/src/http/routes/platformadmin/index.ts`,
`dbRuntimeDiagnosticRoutes.ts` deleted). Rebuilt and re-ran the full 2364-test
non-DB suite afterward with zero failures — nothing else referenced this
route.

```text
TEMP_DB_DIAGNOSTIC_ROUTE=PRESENT (in the currently-deployed production container; unaffected by this session, since this mission does not deploy)
TEMP_DB_DIAGNOSTIC_SOURCE=REMOVED (fixed this session, in this commit; will be absent from the NEXT deploy)
TEMP_DIAGNOSTIC_IMAGE=ACTIVE (confirmed via the probe above; remains true until a future deployment out of this mission's scope)
```

This is an honest, not-yet-fully-closed item: the source fix prevents the
route from surviving into the next deploy, but the mission's own "Do NOT
deploy new application code" constraint means the currently-running
container still exposes it (behind authentication) until that next deploy
happens, which this mission correctly does not perform.

## M. Regression — see §D's regression block above

All required checks (`BACKEND_TYPECHECK`, `SCHEMA_TESTS`, `PRIVACY_TESTS`,
`DB_VERIFY`, `DB_BOOTSTRAP_CERTIFICATION`, `BACKEND_TESTS`) were run for
real, twice each in places, against a real disposable MySQL database. No
blocked test was reinterpreted as passing.

## Summary: what this session closed vs. what remains genuinely open

**Closed**: the CI bootstrap-certification job's root cause (MySQL service
container time zone); the canonical-schema drift for
`platform_admin_activation_tokens` (source, generated artifacts, and the
CI job that depends on them, all reconciled and re-verified); the
temporary DB diagnostic route's presence in source (pending the next
deploy to also close it in production).

**Genuinely still open**, and none of them were closed here because doing
so would have required violating one of this mission's own explicit
constraints (touching Key Vault values, touching the existing Platform
Admin account, or bypassing a sandbox safety control): production schema
inventory, migration journal, least-privilege grants, current
`ACTIVE_APP_OWNER_COUNT`, current Platform Admin account state, and
runtime (not configuration-inferred) proof of the private network path.
**`PRODUCTION_SCHEMA_READY` cannot be asserted YES**, and therefore neither
can bootstrap-readiness, until a human operator relays sanitized,
read-only SQL results (the mechanism that worked in the prior session) or
a properly-authorized alternative is used.
