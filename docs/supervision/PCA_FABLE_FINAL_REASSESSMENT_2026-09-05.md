# PCA FABLE — FINAL PROGRAMME SUPERVISOR RE-ASSESSMENT

**Audit date:** 2026-09-05 / 2026-09-06
**Audit SHA:** `5dc1fc0ee7078fa50fed6e277f0be702231512f3` (`pca-dev`, working tree clean)
**Protected main:** `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd`
**Method:** 14 read-only evidence agents plus coordinator-executed verification.
**Source changes made by FABLE: 0.** No deployment. No live database.

Companion artifacts:
`PCA_FABLE_EVIDENCE_LOG.md` (everything I executed myself) ·
`PCA_FABLE_STATUS_MATRIX.csv` · `PCA_FABLE_OPEN_ACTION_REGISTER.csv` ·
`PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv` ·
`PCA_FABLE_STALE_DOCUMENTATION_REPORT.md` · `PCA_FABLE_RELEASE_ROADMAP.md`

---

## 1. THE VERDICT IN ONE PAGE

**PCA is not one product that is nearly finished. It is five products at four
different maturities, welded together by a release-gate tool that treats them as
one.** That single framing error is why the programme feels stuck.

The engineering is, in most places, genuinely good — better than the status
documents suggest. The backend passes **2,214 non-DB tests with zero failures**.
The canonical database is the most internally consistent artefact in the
repository: I built it twice from an empty server and **every one of the ten
claimed numbers was correct**. The cross-realm auth boundary between parent and
platform-admin planes is real, enforced four independent ways, and has a test
that proves both directions. Money is bigint minor units with no float anywhere.
The payment registry is empty and triple-gated on purpose.

What is missing is not code. It is **two owner decisions, one provider
integration that has never been started, and a set of gates that cannot
distinguish one release from another**.

**The single most serious product finding, verified link by link:** a parent who
chooses a data-retention window is told `accepted: true` — and **nothing stores,
delivers, or enforces that choice.** `retentionRoutes.ts:203` validates the
policy, writes an audit row, returns `{ policy, accepted: true }`, and makes **no
repository call at all**. The device independently hardcodes `FOURTEEN_DAYS` as a
default parameter (`RetentionMaintenanceCycle.kt:64-65`) and returns early anyway
because enrollment can never populate `familyId`. A parent selecting "1 month"
receives an explicit affirmative for a promise nothing keeps. That is a false
assurance about data retention, not an unimplemented feature.

Four further findings change the shape of the plan:

1. **Release B is dead one step earlier than anyone recorded.** `markVerified`
   has exactly one caller — inside `verifyEmail` — and there is no email provider
   anywhere in the repository. So **no parent account can ever reach `VERIFIED`,
   and no parent can ever log in in production.** The `familyId = null` problem
   everyone has been tracking sits *behind* that wall and is unreachable. Worse,
   the send failure is deliberately swallowed, so the parent gets a `202` and
   waits forever — the exact opposite of the "explicit, honest gap, not a silent
   failure mode" the source comment claims.

2. **`PARENT_CROSS_FAMILY_READS = 0` is not merely unverified — it is false.** I
   found and verified a live cross-family read and existence oracle in the
   eye-protection read path. The write path authorizes correctly; the read path
   is an unauthorized pass-through over SQL that ignores `familyId`. This matters
   beyond its own P2 severity: five of the six isolation counters are asserted by
   **no code and no test anywhere in the repository**, and this is the proof that
   an unasserted invariant did not just go unchecked — it went silently wrong.

3. **32 of 33 external gates block Public Release A spuriously.** Exactly one
   genuinely applies (`DEPLOYED_TLS_TERMINATION_CONFIG`). The gate checker's own
   docstring promises release-scope filtering; the implementation never had it.
   The programme's own specification already says *"a later release being blocked
   must not block an earlier release"* — the tool contradicts the spec it serves.

**Nothing is production-ready today.** Release A is closest by a wide margin and
is blocked only by owner inputs, not engineering.

---

## 2. WHAT IS TRULY COMPLETE (COMPLETE_VALIDATED)

Three areas survived independent re-derivation. I trust these.

**The canonical database.** Built from an empty datadir on a disposable MySQL
9.7: 35 migrations applied, yielding exactly **75 tables, 626 columns, 83 foreign
keys, 117 non-unique indexes, 31 non-PK unique indexes, 228 CHECK constraints,
and a primary key on all 75 tables** — every claimed figure confirmed. I then ran
the live-bootstrap package end to end on a second database: `00_preflight`,
`01_create_database_schema`, `02_reference_data` and `03_post_validation` all
exit 0, including the fail-closed `SIGNAL` gates. So **`MIGRATION_FROM_ZERO` and
`CANONICAL_BOOTSTRAP_FROM_ZERO` are both PASS by execution**, not by assertion —
the database agent had to mark both NOT_VERIFIABLE. `CENTRAL_READABLE_CHILD_FIELDS
= 0` holds two independent ways: a test that executes in my green run, and my own
scan of the live schema.

*One correction:* `MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP = EXACT_MATCH` is
**false at the database level** — see §5.

**Platform Administration.** 32 source files, 33 registered routes, 9 migrations,
21 CI-running test files, a 19-page console. MFA is mandatory and cannot be
bypassed even with a correct password; the 30-second TOTP anti-replay is a real
compare-and-swap placed *after* password verification so a wrong password cannot
burn a counter; step-up consumption is one atomic statement bound to admin,
session, scope, single-use and TTL simultaneously. UI gates are advisory and say
so; every mutation re-authorizes server-side. I asked an agent to break the
cross-realm boundary and it could not.

**PCA-0 repository and quality foundation.** Four contract catalogues, seven
tooling directories, one CI workflow with 18/18 actions pinned to full commit
SHAs, `npm ci` everywhere, zero floating tags. *Caveat:* four CI steps named
"Validate catalogue" are unconditional no-ops (§6).

---

## 3. WHAT IS SOURCE-COMPLETE BUT NOT VALIDATED (13 areas)

The largest category, and the one the status documents get most wrong. Backend
enrollment, screen time, YouTube Mode A, eye distance (with real CameraX
capture), prayer, parent RBAC, E2EE sync, i18n, parent identity, billing,
entitlements, platform admin surfaces, and Public Release A all have real,
often high-quality implementations that no current evidence exercises end to end.

The recurring reason is not laziness — it is that **the things that would
validate them are gated**: CI runs no e2e job at all, the DB suite is
deliberately excluded from CI (≈57 MySQL test files never run there), and the
crypto gate means nothing downstream of a device signature can execute.

---

## 4. WHAT IS PARTIAL, NOT STARTED, OR BLOCKED

**Partial (9):** app usage/schedule, web filtering, location, retention, tamper,
iOS, red-team/store compliance, release/deployment, parent web.

**Not started (5):** on-device AI (no model binary is tracked anywhere; Android
has no AI package at all), family beta/UAT (`uat_execution_log.json` is an honest
`NOT_EXECUTED` placeholder), the live database, **production email**, and any
deployment pipeline — CI's own header states it does not deploy, and
`permissions: contents: read` enforces that.

**Blocked external (1):** the production crypto suite. The review package exists;
its findings document is an **empty template**. The review has not been performed.

**Needs improvement (3):** family isolation, external-gate governance, repository
housekeeping (121 registered worktrees, 91 local branches of which 59 unmerged,
1,089,727 files under `.agent-runtime`).

**Orphaned code worth a decision:** `backend/src/tamper`, `src/export`, `src/ai`,
`src/model`, `src/usage`, `src/telemetry`, `src/recovery` are all reachable from
nothing. Android's `VpnEnforcementController` is constructed and never called, so
the entire 8-file VPN DNS stack can never start — the graph comment admits "no
such screen exists in this pass". Twelve iOS capability types have zero call
sites outside their own declarations.

---

## 5. WHAT CURRENT TESTS ACTUALLY DO

Executed by me at `5dc1fc0`, on a disposable local MySQL. No live infrastructure.

| Suite | tests | pass | fail | skip |
|---|---|---|---|---|
| Backend non-DB | **2,214** | 2,214 | **0** | 0 |
| Backend DB (UTC server) | **485** | 477 | **4** | 4 |

**The handoff's "4 pre-existing DB failures" is exactly right — but the
characterisation hid what they are.** All four are one drift:
`backend/test/db/parentAccount.mysql.test.mjs` calls `repository.create(...)`,
which no longer exists because production moved to `createAtomically()`. The
in-memory double retains **both** methods, which is precisely why 2,214 non-DB
tests stay green while the four tests that use the *real* repository die.

**One of the four is `MySQL SECURITY: a family-member invitation can only be
accepted by the account whose OWN registered email it was addressed to — a
stranger with a valid session gets NOT_FOUND`.** That is a cross-account IDOR
defence, and it is currently asserted by no executing test. The product code may
well be correct; there is simply no evidence.

**A trap I fell into and corrected, recorded because it will catch the next
engineer.** My first run reported **6** failures. The two extra were expiry tests
that write `expires_at = NOW(3) - INTERVAL 1 SECOND`. My MySQL was running in
Arab Standard Time, so `NOW(3)` was 10,800 s ahead of UTC while the app pool pins
`timezone: 'Z'` — the rows landed three hours in the *future* and correctly were
not expired. Under `SET GLOBAL time_zone='+00:00'` those two files go **63/63
green**. Classification: **HARNESS_DEFECT**, not a product defect. But the DB
suite has an **undocumented, unenforced UTC precondition**, and
`verify-mysql.mjs` checks neither timezone nor collation.

**The four skips** are platform-admin privilege-boundary tests needing
`PCA_MIGRATION_DATABASE_URL`. That mandatory privilege gate was **NOT_RUN**.

### The new database finding

`MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP = EXACT_MATCH` **is false at the
database level.** I built both databases on one server and diffed
`information_schema`. Indexes (275), foreign keys (84) and CHECK constraints
(228) are identical. **147 of 626 columns differ — every difference is
collation**, and only collation: migrations yield `utf8mb4_0900_ai_ci`
(case- *and* accent-insensitive) where the bootstrap yields `utf8mb4_bin`.
Affected: **7 × `family_id`**, 2 × `child_profile_id`, 2 × `password_hash`,
2 × `idempotency_key`.

Demonstrated, not inferred — a row stored as `'FamilyAlpha'`:

| Database | collation | query `'familyalpha'` | `'FàmilyAlpha'` |
|---|---|---|---|
| migration-built | `utf8mb4_0900_ai_ci` | **matches** | **matches** |
| bootstrap-built | `utf8mb4_bin` | no match | no match |

This contradicts the schema's own stated intent, quoted from
`0001_mysql_baseline.sql`: *"never a case- or accent-folded match on an opaque
reference."* Only 11 of 35 migrations pin collation; the other 24 use bare
`VARCHAR` and inherit the database default. Production starts correct because the
bootstrap pins every column — but a **future migration creating a new table with
a bare `VARCHAR family_id` inherits the database default**, and bare `VARCHAR` is
the house style. Given that family isolation has **zero foreign keys to
`families`** and rests entirely on `WHERE family_id = ?`, this invariant should
be enforced rather than assumed.

Honest severity: **P1, not P0** — family IDs are server-minted UUIDs, so a
case-folded collision between two real families is not a realistic live exploit.
It is a schema-integrity defect with latent security relevance.

*Why no agent found it:* the static differ that reported EXACT_MATCH explicitly
normalises charset/collation inheritance before comparing — the exact dimension
that diverges. Only building both databases can see it.

---

## 6. PRODUCTION STUBS AND FAIL-CLOSED COMPONENTS

**23 stubs are wired into the production composition root; 13 are release-blocking.**
**Zero test doubles are reachable from production** — verified three ways, so
there is no P0 leak.

The critical distinction the roadmap depends on: **seven of the thirteen collapse
the moment the crypto review closes. Six do not.** These six are in-memory with
**no MySQL sibling anywhere in the repository** — independent build work, not
wiring:

| Component | `main.ts` | Consequence on restart |
|---|---|---|
| `InMemoryFamilyAuditRepository` | `:278` | The shared audit store for invitation/enrollment/pairing/device/recovery/authz/retention **evaporates** |
| `InMemoryDeleteNowLedger` | `:279` | **The record of a deletion the parent was told had happened is lost** |
| `InMemoryWebRuleRepository` | `:579` | Parent-authored web filtering rules silently lost |
| `InMemoryChildRequestRepository` | `:554` | Bonus-time requests lost |
| `BonusGrantLedger` | `:556` | Granted bonus time lost |
| `resolveEnvelopeContext` placeholder | `:793-799` | Empty sender key, zero epochs — **becomes a live anti-downgrade hole the moment crypto activates** |

The last one deserves emphasis: it is currently masked by the rejecting verifier.
**Activating crypto without fixing it converts a dormant placeholder into a
security defect.**

**Production crypto: no bypass exists.** I take this as a genuine positive. The
backend reads no crypto-related environment variable; every verifier consumer
takes a required verifier and branches strictly on failure; the one `catch` that
touches a signature sets `validSignature = false` (fail-*closed*). A real,
working Ed25519 verifier does sit in production source
(`parentaccount/genesisDeviceSigner.ts:69`) and is correctly unimported — but it
is one `import` away from becoming an unreviewed production crypto suite and
deserves a CI guard.

**Green signals that assert nothing — verified by me:**

* CI runs **no Playwright job**. Six configs and 39 committed specs never execute
  automatically.
* Four CI steps named "Validate catalogue" load export-only modules and **exit 0
  unconditionally**. Even the working validator never reads `httpSurface.routes`,
  and the drift is live: `POST /v1/runtime-sync/protection-status` is registered
  but absent from the catalogue that names that route file as its authority.
* `tooling/mutation/run-mutation.mjs` executes **zero tests**; `EQUIVALENT` is
  read from the manifest, never derived. Six documents cite its output as quality
  evidence. It is not wired into CI, so deleting it costs nothing.
* `parent-web`'s contrast gate asserts nothing: jsdom reports contrast as
  *incomplete*, and the matcher reads only `results.violations`. Every WCAG ratio
  in `global.css` is a hand-written comment. (`public-web`, by contrast, has a
  **real** tiered gate — 4.5:1 text, 3.0:1 UI — that genuinely passes 30 pairs.)
* `test-results/` is gitignored in both web apps, so **every "real E2E PASS with
  committed artifact" claim from PPR-1R onward is structurally unbacked**.
* Five of six family-isolation counters appear in exactly one doc file and **zero
  code or test files**. Nothing can ever make them fail — and one of them is
  already false.

---

## 7. WHAT OLD STATUS DOCUMENTS GET WRONG

Roughly 40 stale or contradictory claims are catalogued in
`PCA_FABLE_STALE_DOCUMENTATION_REPORT.md`. The three that matter most:

1. **`docs/architecture/30_IMPLEMENTATION_PROGRAMME.md:38,44`** asserts, *on the
   strength of a stated repository survey*, that no Platform Administration or
   Billing source exists. Reality: 32 platform-admin files, 33 routes, 9
   migrations, 21 CI test files, a 19-page console, and ~300 passing billing
   tests. This is the document a new supervisor reads first. Addendum 002 §21
   repeats it across 11 workstreams.
2. **The public-web reports describe a site that no longer exists** — three main
   pages instead of four, `/download/` "deleted" when it is now the conversion
   page, 189 keys instead of 193, 14 pages instead of 16. One report contradicts
   itself in two sections on whether the Arabic review is complete.
3. **Two committed QA ledgers disagree on the same routes** — 52 rows marked
   `VERIFIED_BROWSER_PASS` in one file are `BROWSER_STATUS = NOT_TESTED` in the
   other, and the "62/62 routes responsive verified" claim is recorded by no
   ledger row at all.

Worth recording in fairness: several documents are scrupulously honest —
`uat_execution_log.json`, the release-readiness markdown set, `IOS_LOCAL_DB_HANDOFF.md`,
and `PCA_PPR2_OWNER_DECISIONS.md:240-246`, which is the only correct statement
about the mutation harness anywhere in the corpus.

---

## 8. OWNER DECISIONS AND EXTERNAL GATES

**Owner decisions still required:** the production crypto security review;
payment provider selection (plus merchant approval, currencies, bank
configuration); an email provider; OD-12 Arabic sign-off (which **may not be
self-approved** and must not be signed against the current pack); OD-13 legal
facts; the public video decision; cloud-AI siting; telemetry activation; the
`pca-dev` → `main` merge strategy.

**External gates: 33 defined, 0 CLOSED, `evidence: null` on all 33.** Plus
`PAYMENT_PRODUCTION_CERTIFICATION`, which is specified in six documents and
**absent from the JSON the checker reads** — so the gate governing real-money
go-live can never block a release, beside 35 billing requirements that carry an
empty `externalGate` array.

Two structural defects: `TELEMETRY_ACTIVATION_OWNER_SIGNOFF` gates *activating*
telemetry, so closing it means activating telemetry — it can never legitimately
close and blocks nothing, guaranteeing a permanent NOT READY. And four gate pairs
are duplicates, inflating the count by ~5.

**In `PCA_COMPLETION_V2_MATRIX.json`, 291 of 375 requirement rows carry an empty
`externalGate` array and 286 of those assert readiness** — 77.6% of the
controlled inventory claims completeness while citing no gate at all. The largest
cluster is 35 real-money billing requirements.

---

## 9. WHAT BLOCKS EACH RELEASE

| Release | Verdict | Blocking |
|---|---|---|
| **A — Public site** | **NOT_READY** (closest by far) | OD-12 Arabic (pack must be regenerated first), OD-13 legal facts, the two videos do not exist, apex DNS + certificate, TLS termination. **Engineering is essentially done** — it builds green with no dependencies |
| **B — Parent accounts** | **NOT_READY** | **No email provider exists** → no account can reach VERIFIED → no parent can log in. Then the crypto review. Then six durability components |
| **C — Parent Web** | **NOT_READY** | **No `parent-web/Dockerfile` at all**, plus ~16 core operations dead behind `CRYPTO_SUITE_APPROVED_FOR_PRODUCTION = false` — a source constant, not a config flag |
| **D — Android** | **NOT_READY** | Builds and tests clean (**1,345 tests, 1,344 pass, 0 fail**; lint 0 errors / 95 warnings offline). But `EnrollmentCoordinator.kt:150` is a kill switch that disables retention, location, geofencing, prayer, YouTube Mode A, Delete-Now and export — **and clearing the crypto review does not fix it**, because `:387` then persists `familyId = ""`. Plus 9 hardware gates, no launcher icon, no release signing config, and a placeholder domain (`api.pca.app`) in production wiring |
| **iOS** | **NOT_READY** | Four external gates *plus* a repo-solvable compile defect: the `PCADeviceActivityMonitor` target compiles one file referencing ten host-app-only types. No `DEVELOPMENT_TEAM`, no app icon, no launch screen, no `DeviceActivityCenter` call site anywhere |
| **Billing** | **NOT_READY** | Provider selection, merchant approval, certification. Domain logic is source-complete and the empty registry is correct engineering |

---

## 10. THE CORRECT NEXT SEQUENCE

Full detail in `PCA_FABLE_RELEASE_ROADMAP.md`. In brief:

1. **Decouple the release gates** — add `releaseScope` and filter on it. Until
   then no release can pass its own gate, so the gate is ignored, which is worse
   than not having one.
2. **Repair the four dead DB tests** and add a double-conformance guard.
3. **Close the collation invariant** in preflight and the migration gate.
4. **Ship Release A on owner inputs alone** — regenerate the Arabic pack first.
5. **Put the two owner decisions in front of the owner now** — crypto review and
   provider selection. Everything downstream is idle until they are made.
6. **Build the six durability components in parallel** — they are not fixed by
   crypto activation, and `resolveEnvelopeContext` must be fixed *before* it.
7. Android hardware campaign. 8. iOS as a separate future release.

**The sequencing mistake to avoid:** "finish the features, then release." The
features are largely finished and switched off. For Release B the chain is
strictly serial and **email comes first** — closing the crypto review first
delivers nothing observable, because there is no session with which to reach the
gate.

---

## 11. MACHINE-READABLE CHECKPOINT

```
AUDIT_SOURCE_SHA = 5dc1fc0ee7078fa50fed6e277f0be702231512f3
AUDIT_MAIN_SHA   = f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd

DOMAINS_REVIEWED = 35
PHASES_REVIEWED  = 20   (PCA-0 .. PCA-19, plus 12 addendum programmes)

COMPLETE_VALIDATED       = 3
COMPLETE_SOURCE_ONLY     = 13
PARTIAL                  = 9
NOT_STARTED              = 5
BLOCKED_EXTERNAL         = 1
ON_HOLD_DEFERRED         = 1    (on-device/cloud AI, POST-V1)
OWNER_DECISION_REQUIRED  = 9
NEEDS_IMPROVEMENT        = 3
STALE_DOCUMENTATION      = 1    (~40 individual claims catalogued)

CURRENT_TEST_FAILURES = 4    (backend DB suite; all one createAtomically drift)
CURRENT_TEST_SKIPS    = 4    (platform-admin privilege gate, needs PCA_MIGRATION_DATABASE_URL)
                             (backend non-DB: 2214 pass / 0 fail / 0 skip)

OPEN_ACTIONS_TOTAL = 60       (P0=10, P1=24, P2=21, P3=5)
REPO_SOLVABLE_P0   = 7
REPO_SOLVABLE_P1   = 19
OWNER_ACTION_OPEN  = 10       (4 OWNER_ACTION + 1 LEGAL + 1 SECURITY_REVIEW
                               + 1 EXTERNAL_PROVIDER + 3 INFRASTRUCTURE)
EXTERNAL_GATE_OPEN = 33       (0 CLOSED, evidence null on all 33;
                               +1 defined-but-missing: PAYMENT_PRODUCTION_CERTIFICATION)

PRODUCTION_STUBS_TOTAL            = 23
PRODUCTION_STUBS_RELEASE_BLOCKING = 13
TEST_ONLY_ACCIDENTALLY_WIRED      = 0

CENTRAL_READABLE_CHILD_FIELDS = 0    (test-backed AND independently re-derived)

PARENT_CROSS_FAMILY_READS  = 1       (VERIFIED LIVE — eye-protection read path;
                                      the documented value of 0 is FALSE)
PARENT_CROSS_FAMILY_WRITES = 0       (none found; not test-proven)
CROSS_FAMILY_EXISTENCE_ORACLES = 1   (same defect)

PUBLIC_RELEASE_A = NOT_READY   (source ready; owner inputs only)
RELEASE_B        = NOT_READY
RELEASE_C        = NOT_READY
ANDROID_RELEASE_D = NOT_READY
IOS_RELEASE      = NOT_READY

LIVE_DATABASE_CREATED           = NO
PRODUCTION_DEPLOYMENT_PERFORMED = NO
SOURCE_CHANGES_BY_FABLE         = 0
```

---

## 12. LIMITS OF THIS AUDIT — READ BEFORE ACTING

* The **platform-admin privilege gate was NOT_RUN** (needs a privileged DB URL).
* **No real-device, macOS/Xcode, provider, store, TLS, email or Azure evidence**
  was produced or simulated. Every such gate remains genuinely `BLOCKED_EXTERNAL`.
* **Live Azure state was not re-probed this session.** The two-App-Service
  topology and "nothing is deployed" are carried from a prior verified session
  and are marked UNVERIFIED_BY_ME.
* **Docker daemon was down**, so no image was built — all container findings are
  by file inspection.
* Several agents were interrupted by a session limit; I re-ran the highest-value
  parts myself. **The Android lane subsequently completed and is no longer a gap**:
  `compileDebugKotlin`, `assembleDebug` and a forced `testDebugUnitTest` all pass
  (1,345 tests, 1,344 pass, 1 skipped), and `lintDebug` gives **0 errors / 95
  warnings offline** (~149 online — the delta is 54 network-dependent checks). The
  documented "0 lint issues" is false; it was read off a green exit code, since
  warnings never fail a build. **Android instrumentation tests (4 files) have never
  run**, and because the one test covering the real `getInstance` +
  `EncryptedSharedPreferences` path is skipped for want of an `AndroidKeyStore`,
  the production composition path is exercised by **zero** tests — all 1,344
  passing tests use in-memory doubles.
* **Play Store policy could not be checked** (no network). `targetSdk 35` may be
  below Play's current floor; treat as REQUIRES_VERIFICATION.
* The reverse direction of the OD-12 key diff needs a proper CSV reader; only the
  "≥19 never reviewed" figure is solid.

* **Treat "we searched and found nothing" with more caution than a positive
  finding in this repository.** An unscoped `grep -r` or `find` from the repo root
  traverses roughly **1.45 million files** across `.agent-runtime/` (1,089,727)
  and `.claude/` (361,624). That is slow and memory-hungry, and at least one
  agent's repo-wide sweep was **killed for low memory mid-run** — which produces a
  silent truncation that is indistinguishable from a clean negative. A scoped
  ripgrep returned instantly where the raw `grep -r` died.

  My own sweeps were all scoped away from those trees — `git ls-files` for the
  tracked-secrets scan, explicit source directories for the isolation-counter
  check, and per-package paths for the env-var and `markVerified` checks — and the
  one deliberate traversal of the worktree trees ran to completion (exit 0) and
  returned results. So the coordinator-executed negatives in
  `PCA_FABLE_EVIDENCE_LOG.md` are not affected.

  **But agent-reported negatives derived from broad repo-root sweeps should be
  re-run scoped before being relied on** — particularly any "no occurrences
  anywhere" claim. This is the same failure family as the repo's other known
  false-greens: a signal that reports success while asserting nothing.

**One methodological note for the reviewers.** Three claims in this report
contradict what an agent first told me, and I corrected them by executing the
check myself: the entitlement double drift is *latent*, not an active breakage;
the backend env surface is larger than four variables (a grep artifact that would
omit `PLATFORM_ADMIN_MFA_ENC_KEY` from a deployment runbook); and parent-web i18n
is 1,079/1,079, not the 1,190 I had propagated. Parity itself is genuinely
perfect. Where this report disagrees with an agent, the evidence log says why.
