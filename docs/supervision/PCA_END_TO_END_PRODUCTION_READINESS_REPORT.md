# PCA — End-to-End Production Readiness & Deployment Report

Date: 2026-09-07. Mission: continuous Dynamic Workflow from Azure disposable DB
through database, email, AUTH_B, Android, security, production DB and
production deployment.

**Nothing was deployed. No production infrastructure was touched.** The
workflow ran as far as the available engine version, credentials, provider,
device and approvals allow, and stopped at each real gate rather than through
it.

---

## 1. Executive status

```
IMPLEMENTATION_BASELINE   = ACCEPTED, re-verified independently
DATABASE_READINESS        = PROVEN on MySQL 8.4 (local disposable) /
                            BLOCKED on Azure (wrong engine version)
EMAIL_READINESS           = CODE_READY_EXTERNAL_BLOCKED (no provider)
AUTH_B_READINESS          = CODE_READY_EXTERNAL_BLOCKED (blocked behind email)
ANDROID_READINESS         = CODE_READY_UAT_BLOCKED (no physical device)
CRYPTO_READINESS          = SECURITY_REVIEW_BLOCKED
PRODUCTION_DB_READINESS   = LIVE_DB_NOT_AUTHORIZED (prerequisites unmet)
PRODUCTION_DEPLOYMENT     = NOT_READY, not authorized, not performed
PUBLIC_RELEASE_A          = LEGAL_NOT_AUTHORIZED

OVERALL_RELEASE_STATUS    = PARTIALLY_READY
```

`PARTIALLY_READY` is chosen deliberately over anything stronger. The database
layer moved from *asserted* to *proven* this session on the approved engine.
Every other stage remains blocked on something no amount of engineering here
can produce.

**The single most valuable outcome of this session** is a production defect that
only appeared by running the real backend, in production mode, against a real
migrated database — described in §27.

---

## 2. Repository baseline

```
BRANCH                = pca-dev
HEAD_AT_MISSION_START = 23c3a543c1410cfd7b146a5c606ebafbc8c5513d
HEAD_NOW              = 00efb35d464970ff48e036b6cfd90b285f5ee3cd
ORIGIN_MAIN           = f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd   UNTOUCHED
WORKTREE              = clean
STASH                 = 1 pre-existing entry, preserved
P0_OPEN = 0    P1_OPEN = 0
```

**Divergence from the stated W3 tip is expected and accounted for.** The mission
named `d594450`; that was the tip at the start of the *previous* phase in this
same session. Five commits have landed since, all documented:

## 3. Git SHA history

| SHA | What |
|---|---|
| `d594450` | W3 final tip (mission's stated start point) |
| `b0af12c` | OD-12 Arabic sign-off made producible, honest and reproducible |
| `4f631f1` | Android CI made able to name a failing test |
| `3b1e39f` | Racy Android enrollment-audit persistence test fixed |
| `23c3a54` | External readiness + Azure disposable-DB reports |
| `00efb35` | **This mission:** production email boot guard (§27) |

`4615cc7` remains in history as the W3 substantive commit. `origin/main` was
never modified, rebased or force-pushed; no `.agent-runtime/` worktree was
touched.

---

## 4. Azure disposable database

```
HOST     = ims-platform.mysql.database.azure.com   resolves, TCP 3306 reachable
DATABASE = disposable        USER = scnwkdpcjb
CONNECTED = NO — no authenticated connection was opened
STATUS   = BLOCKED
```

Two independent blockers, either of which alone stops the stage:

1. **Engine version** (§5).
2. **No credential.** No password for this server exists anywhere on this
   machine. It was never requested in chat, per the mission's own rule.

A guard-tested preflight harness is written and ready
(`scratchpad/azure-preflight.mjs`): it refuses to run without the password,
refuses any database name other than `disposable`, keeps certificate
verification on, and redacts the password from every line of output including
error messages.

## 5. MySQL version — the blocker

```
AZURE_SERVER_VERSION = 8.0.45-azure
REQUIRED             = exactly 8.4.x
VERDICT              = MYSQL_VERSION_MISMATCH
```

Established **without using the credential**: MySQL sends its version in the
handshake before authentication. Confirmed stable across three independent
connections in the previous phase and re-confirmed once at the start of this
one — four readings, all `8.0.45-azure`.

`backend/scripts/verify-mysql.mjs` pins the version to exactly 8.4.x and throws
otherwise. It runs *first* in `npm run test:db`, so the entire database suite
would refuse to start against this server. **The gate was not relaxed and the
application was not adapted to 8.0.x.**

**A second, independent Azure blocker (F-5), corrected from the previous
report.** `verify-mysql.mjs` also enforces a hostname allowlist —
`127.0.0.1`, `localhost`, `mysql` — and refuses anything else outright:
*"PCA_DATABASE_URL/PCA_MIGRATION_DATABASE_URL must point to the disposable
local/Compose database."* Confirmed by executing it against the Azure host. The
earlier report stated that exporting `PCA_DATABASE_URL` would redirect the suite
at another server; that was wrong. Even on a correct 8.4 server, pointing the
suite at Azure requires widening a deliberate safety control — an owner
decision, like the reset allow-list (F-2), not a quiet edit.

---

## 6–8. Schema inventory, migration validation, equivalence — all PROVEN

Run this session against **real MySQL 8.4.11** (the repository's own disposable
Compose container), from a genuine zero-state reset.

**Migration execution: PASS.** 38 migrations applied cleanly from an empty
database. Journal consistent: 38 `schema_migrations` rows.

**Schema inventory — measured, not assumed:**

| Object | Measured | W3 baseline |
|---|---|---|
| Tables (BASE) | **78** | 78 ✓ |
| Columns | **646** | 646 ✓ |
| Primary keys | **78** | — |
| Foreign keys | **83** | 83 ✓ |
| Unique non-PK indexes | **32** | 32 ✓ |
| Non-unique indexes | **119** | 119 ✓ |
| CHECK constraints | **233** | — |
| Views / triggers / routines | **0 / 0 / 0** | — |
| `schema_migrations` rows | **38** | 38 ✓ |

Every historical figure reproduced exactly. Migration files: 38, numbered
0001–0040 with 0009 and 0010 absent — a pre-existing, benign gap, since the
journal keys on filename rather than a contiguous sequence.

**Equivalence: EXACT_MATCH by three independent methods.**

```
migrated schema   fingerprint = 278c141ea752ea9a1867693810d2e5380b5c1ca4568b12d4c8952ba4f680329f
bootstrap schema  fingerprint = 278c141ea752ea9a1867693810d2e5380b5c1ca4568b12d4c8952ba4f680329f
structural diff (compare-schema-snapshots.mjs) = EXACT_MATCH
SQL-native fingerprint, both DBs = 8affc6303deba64052d23e8ba0c19823c495b5cf5f609b568dbb976142c0e8c5
```

Both hashes match W3's recorded values byte-for-byte. The canonical bootstrap
SQL also regenerates byte-identically from `schema.ts` (`git status` clean after
regeneration), so schema source and shipped bootstrap artifact are in sync.

**The production bootstrap runbook was executed end-to-end** on a scratch
database — the same package a production cutover would run:

```
00_preflight.sql          PCA-LIVE-DB-0 PREFLIGHT: ALL CHECKS PASSED
01_create_database_schema PASS (78 tables)
02_reference_data.sql     PASS (3 currencies, 3 markets, 1 entitlement default)
03_post_validation.sql    PCA-LIVE-DB-0 POST-VALIDATION: ALL CHECKS PASSED
04_schema_fingerprint.sql 8affc630…c0e8c5  (matches)
post-validate.mjs         ALL PASSED — 646 columns scanned, fingerprint matches
```

Both scratch databases were dropped afterwards. `STATUS = PASS`.

---

## 9. Database-backed application tests

**Environment: LOCAL MYSQL 8.4.11 (disposable Compose container).**
Explicitly **not** Azure — that remains `NOT_TESTED` per §5.

```
npm run test:db                          516 / 520 PASS, 0 FAIL, 4 SKIP
npm run test:db:platform-admin-privileges  4 /   4 PASS, 0 FAIL, 0 SKIP
                                        ─────────────────────────────
effective                                520 / 520 PASS, 0 FAIL
```

The 4 skips are the pre-existing privilege-gated tests, and they are not left
skipped: they have a dedicated mandatory gate requiring
`PCA_MIGRATION_DATABASE_URL`, which was run and passed. That is a step beyond
W3, which recorded them as skips.

Coverage spans every area the mission names: AUTH, FAMILY, CHILD, INVITATION,
ENROLLMENT, DEVICE, PARENT WEB, PLATFORM ADMIN, ENTITLEMENT, AUDIT, EMAIL
OUTBOX, FAMILY ISOLATION, SOFT DELETE, CONSTRAINTS.

**Application connectivity — real, not mocked.** The backend was started
against the migrated database:

```
/health      {"service":"pca-backend","status":"ok"}
/health/db   {"status":"ok","database":"connected"}
POST /api/parent/register  ->  HTTP 202 {"status":"PENDING_VERIFICATION"}
             ... 1 parent_accounts row, 1 verification-code row, written by
                 the application through its own pool and transactions
```

Startup is fail-closed on environment: with `NODE_ENV` unset the process
refuses to start — *"NODE_ENV must be exactly one of test, development, or
production … Refusing to start with an unrecognized runtime environment."*

**Evidence classification, as required:**

```
UNIT / TEST DOUBLE       = PASS   (2346/2347, see §26)
LOCAL MYSQL 8.4          = PASS   (520/520 effective, this session)
AZURE DISPOSABLE MYSQL   = NOT_TESTED
REAL EXTERNAL PROVIDER   = NOT_TESTED
REAL DEVICE              = NOT_TESTED
```

## 10. Family isolation / IDOR

`STATUS = PASS` on real MySQL 8.4. Fifteen distinct cross-family isolation
tests passed, including several that specifically target existence oracles:

- a childProfileId belonging to a **different family** is rejected with the
  **same shape as nonexistent** — no cross-family existence oracle;
- `resolveMembership` returns `NOT_MEMBER_OR_NOT_FOUND` **identically** for
  cross-family and nonexistent;
- zero foreign `family_id` leakage across many foreign-family reads of the same
  real child;
- cross-family cancel rejected as `NOT_FOUND` before the service runs;
- `updateAutoRenew` cross-family IDOR returns `NOT_FOUND`, never family A's row;
- cross-family recovery-token adversarial test;
- cross-family entitlement, notification, slot-reservation and revoked-key
  isolation.

**The W3-disclosed residual P2 remains present and remains P2.**
`ChildRequestService.cancel()` / `acknowledgeApplied()` still call
`repository.get(requestId)` unscoped and return `NOT_FOUND` (404) when absent
versus `NOT_THE_REQUESTER` (403) when the row exists but belongs to another
device — so the oracle *is* observable over HTTP. It is gated behind a
`randomUUID()` request id (122 bits), reveals existence only and never content,
and is device-level rather than family-level. **Blocks no release target.**
Unchanged from W3, re-verified rather than reopened.

## 11. Privacy verification

`STATUS = PASS`. Synthetic data only; every account created used
`@example.invalid` addresses and all of it has since been dropped.

```
READABLE_CHILD_PERSONAL_CONTENT_CENTRAL   = 0
READABLE_FAMILY_ACTIVITY_CONTENT_CENTRAL  = 0
CHILD_PHOTOS_CENTRAL                      = 0
CHILD_VIDEOS_CENTRAL                      = 0
CHILD_FILES_CENTRAL                       = 0
CHILD_MESSAGES_CENTRAL                    = 0
READABLE_APP_USAGE_HISTORY_CENTRAL        = 0
READABLE_BROWSING_HISTORY_CENTRAL         = 0
READABLE_PRECISE_LOCATION_HISTORY_CENTRAL = 0
```

Enforced and re-run this session: `schema-privacy.test.mjs` (30/30),
`schema-privacy.mysql.test.mjs` (in suite), the SQL post-validation privacy
scan, and `post-validate.mjs`'s prohibited-term column scan — **646 columns
scanned, zero unreviewed hits**. No schema shortcut was introduced.

---

## 12–13. Email provider

`STATUS = CODE_READY_EXTERNAL_BLOCKED`. No approved provider is configured, so
**no real delivery test was run and none is claimed.**

Architecture re-verified by execution this session, not only by reading:

- `EmailService` is the sole production sending boundary.
- The durable outbox is production-only by design: test and development use
  `TestSandboxEmailSender` with no outbox at all. Confirmed by observation —
  a development-mode registration wrote 0 outbox rows, correctly.
- With **no provider selected**, production boots and `/health/email` reports
  honestly: `{"status":"no_provider_configured","provider":"REJECTING_NO_PROVIDER_CONFIGURED"}`.
- With a provider **named but credentials incomplete**, the process refuses to
  start: `EmailProviderConfigError: PCA_EMAIL_FROM_ADDRESS is required when
  PCA_EMAIL_PROVIDER=SMTP is selected.`

**Correction to the previous report.** It stated that a production-sensitive
runtime "throws at boot" when no provider is configured. That is wrong for the
*unset* case: `main.ts` uses `createEmailProviderAdapterForProduction`, which
deliberately returns the rejecting adapter and boots, rather than
`resolveEmailProviderAdapter`, which throws. The throw applies to the
*incomplete-credentials* case only. Both behaviours are correct; the earlier
description was not.

**Complete configuration contract** (see §29 for the user action):

| Always | SMTP | Microsoft Graph |
|---|---|---|
| `PCA_EMAIL_PROVIDER` | `PCA_SMTP_HOST` | `PCA_GRAPH_TENANT_ID` |
| `PCA_EMAIL_FROM_ADDRESS` | `PCA_SMTP_PORT` | `PCA_GRAPH_CLIENT_ID` |
| `PCA_EMAIL_FROM_NAME` *(optional)* | `PCA_SMTP_SECURE` (`true`/`false` exactly) | `PCA_GRAPH_CLIENT_SECRET` |
| `PCA_EMAIL_REPLY_TO_ADDRESS` *(optional)* | `PCA_SMTP_USERNAME` | `PCA_GRAPH_SENDER_USER_ID` |
| **`PCA_EMAIL_OUTBOX_ENCRYPTION_KEY`** (base64, 32 bytes) | `PCA_SMTP_PASSWORD` | |

## 14. AUTH_B real UAT

`STATUS = CODE_READY_EXTERNAL_BLOCKED`. **Not executed, and no automated test
is offered as a substitute.**

`uat_execution_log.json` remains `NOT_EXECUTED` with an empty case array. The
four planned cases `UAT-AUTH-01…04` are correctly scoped and already require a
*real* inbox and explicitly forbid a sandbox sender. They cannot run until a
provider exists — item 1 in §29.

## 15. Android physical UAT

`STATUS = CODE_READY_UAT_BLOCKED`.

Build and CI are current and green (§26). The catalogue does not need
authoring: **43 cases are already written and mapped to `ANDROID_D`** in
`docs/release_readiness/UAT_TEST_PLAN.md`, covering installation, enrollment,
device authentication, family association, lifecycle, screen time, break
shield, schedule, app control, location, web filtering, VPN/DNS, eye
protection, prayer, wellbeing, network transitions, recovery, tamper and i18n.

`deviceMatrixPopulated: false`, `casesLogged: 0`. No emulator or CI result is
counted as physical-device evidence. Needs item 3 in §29.

Unchanged and still open: Android has **no release build type and no signing
configuration** anywhere in the repository, and CI only ever builds
`assembleDebug`.

## 16. iOS

`STATUS = REAL_XCODE_BLOCKED`. The only red CI job, deterministic and
reproducible across five pushes with byte-identical error text. Not in scope for
any current executable release target; it blocks `IOS_FUTURE` only, and was
correctly not allowed to derail this mission. No Swift or project file touched.

## 17. Billing

`STATUS = PROVIDER_BLOCKED`. Zero payment-provider SDKs anywhere in the tree;
`providerContract.ts` states plainly that none is imported and marks where an
adapter would go. No provider is represented as configured, and nothing was
fabricated. Seven external gates remain, starting with provider selection.

## 18. Security / crypto

`STATUS = SECURITY_REVIEW_BLOCKED`. Re-verified on this tip:

```
PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW
```

**No bypass is possible, structurally.** A repository-wide search for classes
implementing `DeviceSignatureVerifier` or `EnvelopeSignatureVerifier` returns
exactly one file — `RejectingCryptoVerifiers.ts`. There is no production
verifier to activate, so no misconfiguration can switch one on. `main.ts` wires
the rejecting verifiers at 12 composition points. The release gate derives this
signal from source, so no flag can override it.

Required evidence: an assigned external reviewer, a completed findings
document, and a recorded `PCA-DEC-020` approval entered by hand by the
accountable owner — the register's own schema note forbids a script or agent
closing it.

---

## 19–22. Production DB and deployment

```
PRODUCTION_DB_AUTHORIZATION = NOT REQUESTED — prerequisites are not met
PRODUCTION_DB_CREATED       = NO
PRODUCTION_DB_MIGRATED      = NO
AZURE_OR_DNS_CHANGED        = NO
PRODUCTION_DEPLOYMENT       = NO
```

The mission gates production-database authorization behind a specific
prerequisite list. Against that list:

| Prerequisite | State |
|---|---|
| Disposable Azure DB validation passes | **NO** — engine version mismatch |
| Migrations frozen | YES |
| DB-backed application tests pass | YES (local MySQL 8.4) |
| Schema equivalence passes | YES (three methods) |
| Family isolation passes | YES |
| Production configuration reviewed | PARTIAL — see §27 and F-1 |
| Backup/restore + rollback documented | YES (`OWNER_RUNBOOK.md`, `ROLLBACK_CHECKLIST.md`) |
| Release-control gates satisfied | **NO** |
| Security approval exists | **NO** |
| AUTH_B real UAT passes | **NO** |
| Android physical UAT passes | **NO** |

Six prerequisites are unmet, so **production database authorization was
deliberately not requested.** Asking for it now would invite an authorization
the evidence does not support. The earlier disposable-database authorization
was not treated as production authorization at any point.

Production application preparation and Azure deployment (§21–22) are therefore
not started. Smoke tests (§23) and post-deployment security checks (§24) are
`NOT_TESTED` — there is nothing deployed to test.

---

## 23–25. Public Release A, legal, contact

Verified in a **real browser** in the previous phase of this session and
unchanged by this mission's commits:

```
PUBLIC_LOGIN_VISIBLE         = NO      DOWNLOAD_ACTION_VISIBLE      = YES (52 actions)
PUBLIC_SIGNUP_VISIBLE        = NO      DOWNLOAD_AVAILABILITY_HONEST = PASS
FAKE_STORE_BADGES            = 0       FAKE_DOWNLOAD_LINKS          = 0
EN/AR parity                 = 193 keys each
axe WCAG 2.1 A+AA            = 0 violations across 16 page runs
RELEASE_A_REPO_CRITICAL/HIGH = 0 / 0
```

```
LEGAL_PUBLICATION_STATUS = NOT_AUTHORIZED   (OD-13 unresolved)
CONTACT_CHANNEL          = PARTIAL          (inbound verified; reply identity NOT_READY)
OWNER_VISUAL_UAT         = BLOCKED
OD_12 (Arabic sign-off)  = AWAITING_OWNER_SIGNOFF — sheet now producible
```

No legal entity, jurisdiction, controller identity, postal address or effective
date was invented.

## 26. CI status

Current tip `00efb35`: **21/22 green**, `iOS build and unit tests` the only
failure — the known, root-caused, `REAL_XCODE_BLOCKED` one. `Backend build and
unit tests` **passed**, confirming the email change.

Local backend non-DB suite: **2346/2347**. The single failure was
`platformadmin/authService` *"login timing: unknown email pays the same real
password-hashing cost…"* — a wall-clock timing-oracle test that lost its margin
under this session's own Docker/MySQL/multi-node contention. **Re-run in
isolation it passes 42/42**, and CI passed it too. Reported rather than
rounded up.

## 27. Open defects — one found and fixed this session

### D-6 — Production email booted "healthy" over a dead auth path (HIGH, fixed)

Found by doing what no test did: running the real backend in `NODE_ENV=production`
against a real migrated MySQL 8.4 database. With SMTP **fully configured** and
only `PCA_EMAIL_OUTBOX_ENCRYPTION_KEY` absent:

```
/health                    -> {"service":"pca-backend","status":"ok"}
/health/email              -> {"status":"ok","provider":"SMTP"}
POST /api/parent/register  -> HTTP 500 {"error":"internal_error"}
```

…and the `parent_accounts` row was created anyway, with **zero `email_outbox`
rows**. The key is resolved during encryption, which happens *before* the outbox
insert — so the durable retry path never saw the message either. An account
created, no email, nothing queued, nothing to retry, and **both health signals
an operator checks before a production cutover reporting green.**

Provider credentials were already validated at boot. The outbox key is equally
required and on the same critical path, but was resolved lazily at first send.
`assertProductionEmailConfigurationComplete()` now resolves it during
`createEmailInfrastructure`, so the misconfiguration behaves like the
incomplete-credentials case it belongs with: refuse to start.

Deliberately scoped to a *selected* provider — with none configured, a missing
key is the honest not-yet-configured state that must keep booting, which is
every environment today. A negative control pins that.

**Verified end-to-end against the real backend**, not only in unit tests:
provider + no key → refuses to start; provider + key → starts and `/health/email`
reports honestly. 7 new tests, registered in the suite the meta gate enforces.
Committed `00efb35`, CI green.

### Open, unchanged

| ID | Item | Why not fixed |
|---|---|---|
| F-1 | DB connection has no TLS enforcement; `?ssl-mode=REQUIRED` is silently ignored by mysql2 and fails open to plaintext | Real design decision (would break the local plaintext container); needs an owner call. **HIGH for any deployed environment**, not exploitable today — nothing is deployed |
| F-2 | Reset script allow-lists only `pca_test`, so it cannot target `disposable` | Correct, protective; widening it is an owner decision |
| F-5 | `verify-mysql.mjs` hostname allowlist blocks the DB suite from any non-local host | Same class as F-2 |
| O-1 | Android has no release build type or signing config | Requires a keystore that must not be fabricated |
| O-2 | `PUBLIC_A`'s `REAL_UAT` term is structurally unsatisfiable | Editing release-control semantics is an owner decision |
| O-4 | Device-level existence oracle (§10) | Assessed P2, UUID-gated, blocks no target |
| O-5 | Auth rate limiter is in-process | Deployment-topology decision |

## 28. Remaining external blockers

1. Azure MySQL **8.4.x** server (current: 8.0.45) — or a recorded decision.
2. Azure `disposable` password, supplied out of band.
3. Owner decision on F-5 (and F-2) before the suite can target Azure.
4. Approved email provider + credentials + proven delivery.
5. Physical Android device and QA execution of the 43 mapped cases.
6. Human production-crypto security review (`PCA-DEC-020`).
7. OD-13 legal facts; OD-12 Arabic sign-off; owner visual UAT; reply identity.
8. TLS termination at the host (every target).
9. Payment provider selection.
10. Real macOS/Xcode; Apple Family Controls entitlement; physical iOS device.
11. Owner decision on F-1.
12. Explicit production-database authorization — **not yet warranted**.

## 29. Exact evidence inventory

| Gate | Status | Evidence | Environment | SHA |
|---|---|---|---|---|
| Migration from zero | PASS | 38 applied, journal 38 rows | Local MySQL 8.4.11 | `00efb35` |
| Schema inventory | PASS | 78/646/83/32/119, measured | Local MySQL 8.4.11 | `00efb35` |
| Schema equivalence | PASS | `278c141e…`, `8affc630…`, structural diff | Local MySQL 8.4.11 | `00efb35` |
| Production bootstrap runbook | PASS | steps 00–04 all passed | Local MySQL 8.4.11 | `00efb35` |
| DB-backed tests | PASS | 520/520 effective, 0 fail | Local MySQL 8.4.11 | `00efb35` |
| Family isolation | PASS | 15 cross-family tests | Local MySQL 8.4.11 | `00efb35` |
| Privacy invariants | PASS | 9 at zero; 646 columns scanned | Local MySQL 8.4.11 | `00efb35` |
| App connectivity | PASS | `/health/db` ok; real 202 registration | Local MySQL 8.4.11 | `00efb35` |
| Email boot guard | PASS | refuses to start; 7 tests | Real backend, production mode | `00efb35` |
| Crypto fail-closed | PASS | only `Rejecting*` exists | Source | `00efb35` |
| Release-control conformance | PASS | 112 assertions, parity 222 cells | Source | `00efb35` |
| CI | 21/22 | iOS known-red | GitHub Actions | `00efb35` |
| Azure disposable DB | BLOCKED | 8.0.45-azure ≠ 8.4.x | Azure | — |
| Real email delivery | NOT_TESTED | no provider | — | — |
| AUTH_B real UAT | NOT_TESTED | blocked on email | — | — |
| Android physical UAT | NOT_TESTED | no device | — | — |
| Security approval | NOT_TESTED | no reviewer assigned | — | — |
| Production DB | NOT_AUTHORIZED | prerequisites unmet | — | — |
| Production deployment | NOT_PERFORMED | not authorized | — | — |

## 30. Final release decision

| TARGET | CODE | DATABASE | PROVIDER | REAL UAT | SECURITY | DEPLOY | STATUS |
|---|---|---|---|---|---|---|---|
| PUBLIC_A | READY | n/a | n/a | not mapped | n/a | NO | `LEGAL_NOT_AUTHORIZED` |
| AUTH_B | READY | PROVEN (8.4) | none | 0/4 | n/a | NO | `CODE_READY_EXTERNAL_BLOCKED` |
| PARENT_C | READY | PROVEN (8.4) | none | 0/22 | no review | NO | `SECURITY_REVIEW_BLOCKED` |
| ANDROID_D | READY | PROVEN (8.4) | n/a | 0/43 | no review | NO | `CODE_READY_UAT_BLOCKED` |
| IOS_FUTURE | NOT BUILDING | n/a | n/a | 0/0 | no review | NO | `REAL_XCODE_BLOCKED` |
| BILLING_FUTURE | SOURCE READY | PROVEN (8.4) | none | 0/0 | n/a | NO | `PROVIDER_BLOCKED` |

**No target is READY. Nothing was deployed. `OVERALL_RELEASE_STATUS =
PARTIALLY_READY`** — the database layer is now genuinely proven on the approved
engine, and everything downstream of it waits on external input.
