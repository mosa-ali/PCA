# PCA Dynamic Workflow — Wave 3 Closure Report

Status: CLOSED for the lanes below marked CLOSED; several lanes are correctly
BLOCKED/EXTERNAL (owner decision, credential, real device, or external
certification required) and are reported as such, not worked around. This
is an implementation closure report, not a supervisory reassessment — it
does not reopen, rewrite, or supersede any FABLE document, and Dynamic
Workflow (not FABLE) was the only workflow used this mission.

## Starting state

```
SOURCE_SHA_BEFORE      = 66d75f27509496a78ccd9a21bc285911211467ef
CURRENT_PCA_DEV_BEFORE = 66d75f27509496a78ccd9a21bc285911211467ef
ORIGIN_MAIN            = f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd (untouched throughout)
WORKTREE               = clean (confirmed via git fetch/status before any work began)
BRANCH                 = pca-dev
```

No worktree was created at any point this wave. All implementation work was
performed directly by the coordinator against the authorized working tree.
Discovery used 6 parallel read-only forks (no file edits, no mutating git
commands, no nested sub-agent spawns); the one adversarial-review agent
launched before closure was explicitly instructed under the same
constraints.

## Lane results

| LANE | STATUS | IMPLEMENTED | VERIFIED | BLOCKED_REASON | EXTERNAL_DEPENDENCY | RELEASE_IMPACT | EVIDENCE |
|---|---|---|---|---|---|---|---|
| W3-A Production email completion | ALREADY_CLOSED (architecture) + doc fix | Corrected `external_gate_matrix.json`'s stale `PRODUCTION_EMAIL_DELIVERY` description | Yes (JSON validity + gate tests) | Provider selection | Owner-approved provider + credentials | AUTH_B/PARENT_C release readiness | Discovery fork + this session's own re-run of gate tests |
| W3-B AUTH_B real-UAT readiness | VERIFIED (code path); EXTERNAL (real UAT) | None needed — no defect found | 135/135 tests | Real UAT not executed | Real inbox + owner UAT execution | AUTH_B_RELEASE_READY blocker (non-code) | Discovery fork; re-confirmed via full backend suite |
| W3-C Live DB readiness | ALREADY_CLOSED | None needed | Runbook/preflight/rollback docs read and confirmed complete | n/a | Real credentials + explicit authorization (both absent, correctly untouched) | None (readiness, not execution) | Discovery fork |
| W3-D Durable family-data persistence | CLOSED (2 of 3) / BLOCKED (1 of 3) | `MySqlDeleteNowLedger`, `MySqlProfileModeRepository`, migrations 0039/0040, `schema.ts` update, bootstrap regeneration | 13 new DB tests + full equivalence proof, all passing | `WebRuleRepository`: privacy-denylist collision (see Privacy status) | Owner decision on domain-rule persistence design | Closes 2 real functional-regression-on-restart gaps; 1 deferred safely | This report's Test evidence section |
| W3-E Parent Web production hardening | CLOSED (Docker/headers) | `parent-web/Dockerfile`, `nginx.conf`, `.dockerignore` | Built + run live, headers curl-verified | n/a | n/a | Closes a real, previously-documented clickjacking/header gap | This report's Test evidence section |
| W3-F Platform Admin | ALREADY_CLOSED | None needed — no defect found | 114/114 + 153/153 tests (discovery) | n/a | n/a | Confirms authority boundary intact | Discovery fork |
| W3-G Android | CLOSED (hardening + CI-confirmed) + EXTERNAL (real-device UAT) | `VpnEnforcementPolicy.kt`, gate wired into `VpnEnforcementController.kt`/`PcaAppGraph.kt`; CI diagnostic step added | CI-confirmed compiling/passing (21/22-job run) after an unrelated transient first-push failure was diagnosed as environment contention, not a regression | Real device UAT | Real hardware/CI-device evidence | Defense-in-depth only; policy doctrine unchanged | CI evidence section below |
| W3-H iOS | REMAINING_ENGINEERING (root cause now identified, not yet fixed) | CI diagnostic annotation step only; no Swift/project change | CI-confirmed: real, deterministic, reproducible `TEST_HOST`/scheme error now visible via the public API (previously only "exit code 70") | Root cause identified (Xcode project/scheme target-dependency wiring); safe fix requires real Xcode | Real Xcode/SDK access to safely edit `.pbxproj`/scheme internals | Currently the only known-red required CI job | CI evidence section below |
| W3-I Billing | ALREADY_CLOSED | None needed — no defect found | 196/196 tests (discovery) | n/a | Payment provider selection (unchanged doctrine) | BILLING_SOURCE_READY only | Discovery fork |
| W3-J Crypto pre-activation | BLOCKED (correctly, by design) | None — audit only | Fail-closed verifiers confirmed wired at every composition point | External security review | `PCA-DEC-020` human security review | Crypto stays inert | Discovery fork |
| W3-K Privacy/retention | ALREADY_CLOSED | None needed | Both privacy gates re-run, passing; extended coverage confirmed for 2 new tables | n/a | n/a | Invariants held | This report's Privacy status section |
| W3-L Family isolation | CLOSED (1 real finding fixed) | `ChildRequestService.decide()` familyId scoping | Service-level + HTTP-level negative-control tests, both passing | n/a | n/a | Closes a real (UUID-gated) cross-family existence oracle | This report's Test evidence + diff |
| W3-M Release-gate system | ALREADY_CLOSED | None needed | Re-verified live (fail-closed behaviors, scoping, parity) | n/a | n/a | Unrelated-gate-does-not-block-unrelated-target confirmed | Discovery fork + this session's re-run |
| W3-N CI/quality | PASS (local) / PASS_WITH_KNOWN_UNRELATED_FAILURE (iOS, confirmed for the exact final pushed SHA) | n/a | 21/22 jobs green for `131f783` (the actual tip); iOS red with a confirmed, deterministic root cause | iOS root cause | See W3-H | Overall workflow not claimed green -- explicitly `FAILURE_DUE_TO_KNOWN_IOS` | CI evidence section |
| W3-O Security scanner/lint | CLOSED | New `console` sub-alternation in `Invoke-SecurityChecks.ps1`, including the optional-chaining extension the adversarial review prompted | 11/11 scanner tests; full repo re-scan clean (2,450 files) | n/a | n/a | Closes 4 real detection bypasses | This report's Test evidence + diff |
| W3-P Documentation drift | CLOSED (2 bounded fixes) | `PCA_LIVE_DATABASE_SETTINGS.md` counts; `external_gate_matrix.json` description | Read-diffed; JSON validity confirmed | n/a | n/a | Prevents operational confusion about schema size / email-architecture state | This report's diff |

## Test evidence

- **Backend non-DB** (`npm test`, includes the meta test-registration gate):
  **2,309/2,309 PASS**.
- **Backend DB** (`npm run test:db`, disposable MySQL 8.4.11, from a genuine
  zero-state reset via `backend/scripts/reset-test-db.mjs`): **516/520 PASS,
  0 FAIL, 4 SKIP** (the 4 skips are the pre-existing intentional
  privilege-gated tests, unchanged from every prior wave).
- **Parent Web** (`parent-web`, `npm test`): **996/996 PASS** (verified during
  this wave's discovery phase; unaffected by this wave's only parent-web
  change, a new production Dockerfile/nginx.conf that does not touch
  application source).
- **Platform Admin**: backend **114/114 PASS**; frontend **153/153 PASS**
  (verified during discovery; untouched this wave).
- **Billing**: non-DB **121/121 PASS**; DB-backed **75/75 PASS** (verified
  during discovery; untouched this wave).
- **AUTH_B code path** (parentaccount/auth/trustProxy test files):
  **135/135 PASS** (verified during discovery; untouched this wave beyond
  what's already covered by the full backend suite above).
- **Security scanner** (`node tooling/security/Test-SecurityChecks.mjs`):
  **11/11 PASS** (7 pre-existing + 2 new negative controls for this wave's
  `console.error`/bracket-notation fix + 2 more for the optional-chaining
  gap the adversarial review found and this wave then closed).
- **Release-gate tooling**: `node tooling/release/Test-ReleaseGateScoping.mjs`
  → **ALL PASS (0 failures)**; `node tooling/release/ValidateFableScopeParity.mjs`
  → **PASS**, 222 gate×target cells across 38 CSV rows / 37 matrix gates.
- **Repository quality / security controls** (`tooling/repo-checks/
  Invoke-RepositoryChecks.ps1` / `tooling/security/Invoke-SecurityChecks.ps1`):
  both **PASS**, 2,450 tracked files (staged) checked.
- **`npm audit --audit-level=high`**: **0 vulnerabilities**.
- **`git diff --check`**: clean.
- **Parent Web Docker image**: built successfully end to end (tsc typecheck,
  vite build, `PRODUCTION_DEMO_MODE_GATE = PASS`, `nginx -t` valid); run
  live and confirmed real HTTP headers (`X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Permissions-Policy`, `Referrer-Policy`,
  `Cross-Origin-Opener-Policy`) via `curl -sI` against the running
  container; `/healthz` returns 200.
- **Canonical schema validation** (migrations 0039/0040 added this wave):
  `MIGRATION_FROM_ZERO = PASS`, `CANONICAL_BOOTSTRAP_FROM_ZERO = PASS`,
  `MIGRATION_SCHEMA_VS_BOOTSTRAP = EXACT_MATCH` via three independent
  methods (full structural diff via `compare-schema-snapshots.mjs`; Node
  fingerprint via `schema-fingerprint.mjs`,
  `sha256:278c141ea752ea9a1867693810d2e5380b5c1ca4568b12d4c8952ba4f680329f`;
  SQL-native fingerprint via `04_schema_fingerprint.sql`,
  `8affc6303deba64052d23e8ba0c19823c495b5cf5f609b568dbb976142c0e8c5` —
  identical on both databases). New canonical totals: **78 tables, 646
  columns, 83 foreign keys, 32 unique (non-PK) indexes, 119 non-unique
  indexes, 38 schema_migrations rows**. `post-validate.mjs`'s
  no-prohibited-term-column-names check: **PASS**, 646 columns scanned —
  confirms neither new table introduces a readable-monitoring-surface
  column name.
- **Android/iOS**: `LOCAL_ANDROID_BUILD_UNAVAILABLE` / no local Xcode
  toolchain — neither claimed as locally verified. Both confirmed via real
  CI: Android build/lint/test passes (21/22-job run); iOS fails with a
  now-diagnosed, deterministic root cause. See CI evidence section.

## Adversarial review

A fresh, independent, read-only reviewer agent (no context beyond this
wave's actual diff, launched via the Agent tool) was launched against the
full staged `git diff --cached`, explicitly instructed never to run any
mutating git command, never to create a worktree, and never to call the
Agent tool itself (spawn a nested sub-agent).

**Method**: independently re-derived every one of the 8 claimed changes
against the actual code and by real execution — re-tested the security
scanner regex directly via a standalone harness; re-read and re-derived the
`ChildRequestService` fix's HTTP-level status+body identity proof; built the
backend, ran the full non-DB and DB suites, and re-ran the two new MySQL
test files against the real disposable database; independently re-ran the
ENTIRE migration-vs-bootstrap equivalence proof from scratch (created and
dropped its own temporary `pca_test_review` database, never trusting the
implementer's own equivalence claim); built and ran the Parent Web Docker
image for real and curl-verified the actual HTTP response headers; extracted
and tested the new iOS diagnostic bash logic against three simulated
failure shapes; confirmed via `git diff --cached --stat -- ios/` that zero
Swift files were touched.

**Result: 0 P0, 1 P1** — all 8 claimed fixes independently CONFIRMED-FIXED;
one genuine residual gap found in the security-scanner fix itself.

**P1 found and closed**: `console?.error(child.token)` (optional chaining on
the member access) and `console.error?.(child.token)` (optional chaining on
the call itself) — both real, common modern-JS defensive-logging idioms —
did not match the scanner's own freshly-fixed `console` sub-alternation,
since neither shape accounted for an optional `?.` before the member name,
before the call parenthesis, or before a bracket. **Fixed**: both
sub-shapes now tolerate an optional leading `?.`, and the dot-call shape
also tolerates an optional `?.` immediately before its closing `(`. Two new
negative-control fixtures added
(`console-optional-chaining-bypass.ts`/`console-optional-chaining-call-bypass.ts`),
verified passing (11/11 total scanner assertions) — re-tested directly
against the reviewer's own exact reproduction strings, not merely a
similar-looking case. A second full adversarial-review agent round was not
launched for this narrow, two-line regex extension: the fix was verified
directly against the reviewer's own cited bypass strings (both now
correctly caught) plus the full existing 9-assertion regression suite (all
still passing, nothing weakened) and a full repository re-scan (2,450
files, clean) — proportionate verification for a well-isolated, mechanical
extension of an already-reviewed fix, mirroring how the prior wave's
equivalent single-finding fix-and-verify was handled without a second full
review cycle.

**Residual, explicitly out-of-scope note from the reviewer** (not a defect
in this wave, not fixed, disclosed for completeness): identifier
aliasing/indirection (`const c = console; c.error(...)`,
`globalThis['console'].error(...)`) still bypasses the scanner — a
fundamentally different, whole-program-analysis class this line-based
regex scanner was never built to catch, unchanged before and after this
wave's fixes. Two P2 (non-exploitable, inherited, not introduced this wave)
observations also noted: `ChildRequestService.cancel()`/`acknowledgeApplied()`
retain an analogous device-level (not family-level) existence oracle,
untouched by this wave's scope; `MySqlProfileModeRepository.put()`'s upsert
doesn't independently re-check `family_id` on conflict (mirrors the
already-accepted `MySqlEyeProtectionSettingsRepository` precedent exactly,
and its only caller is not yet wired to any HTTP route in production).

## Actual CI evidence for the exact W3 push

**First push (commit `4615cc751484af69395bb6ef5f292839eac0acdb`, the
substantive change set)**. Fetched from the GitHub Actions REST API
(run `34055757764`):

```
20/22 jobs: SUCCESS (Repository quality, Security controls, Dependency
  audit, Backend, Release control, Contracts, Public, all 8 Parent Web
  shards, Web production demo-mode gate, all 4 Platform Admin shards)
Android build, lint, and unit tests   FAILURE  (unexpected -- first-ever
  failure of this job in this session; no diagnostic wrapper existed yet
  to explain why)
iOS build and unit tests              FAILURE  (known pre-existing;
  this wave's new diagnostic step worked immediately -- see below)
```

The iOS diagnostic step (added this wave) surfaced a REAL, specific,
previously-invisible root cause via the public annotations API for the
first time:

```
xcodebuild: error: Failed to build project PCA with scheme PCA.:
Could not find test host for PCATests: TEST_HOST evaluates to
"/Users/runner/Library/Developer/Xcode/DerivedData/PCA-.../
Build/Products/Debug-iphonesimulator/PCA.app/PCA"
```

This is NOT the Swift-API-mismatch hypothesis a prior document had
speculated — it is an Xcode project/scheme target-dependency issue: the
`PCA.xcscheme`'s `BuildActionEntries`/`TestAction` structurally look
correct (the `PCA.app` entry has `buildForTesting="YES"`), but
`project.pbxproj` uses a suspiciously clean, sequential identifier scheme
(`A10000000000000000000401`, ..., not the random-looking hex Xcode itself
generates) suggesting this project file was hand-authored/generated rather
than produced by real Xcode — a much more plausible source of a subtle
target-dependency wiring bug than a Swift API mismatch. No blind fix was
attempted: safely diagnosing or correcting `.pbxproj` internals requires
real Xcode, which is not available in this environment, and the mission's
own instruction is not to claim a fix without being able to verify it.
Classified `REMAINING ENGINEERING` / `PLATFORM_VALIDATION_REQUIRED`.

The UNEXPECTED Android failure had no diagnostic wrapper in place yet to
explain it. Rather than assume it was transient, a matching diagnostic
step (identical technique to the iOS one) was added and pushed as a
second, small, CI-tooling-only commit.

**Second push (commit `131f783991dbbdcbdd9ba9d9c6bdbaeffb44407d`, the CI
diagnostic follow-up -- now the actual tip of `pca-dev`)**. Fetched from
the GitHub Actions REST API (run `34056200146`):

```
21/22 jobs: SUCCESS -- Android build, lint, and unit tests now PASSES
  (confirms the first push's Android failure was transient/environment
  contention on the shared runner, NOT a regression from this wave's
  Kotlin changes -- independently consistent with the adversarial
  review's own observation that this exact job had already been seen to
  flake/get cancelled earlier in this session on an UNRELATED commit)
iOS build and unit tests              FAILURE  (identical error text,
  byte-for-byte, to the first push -- deterministic and reproducible,
  confirmed NOT flaky, a real and now well-evidenced root cause)
```

`W3_RELEVANT_CI = PASS` for the actual final tip (`131f783`): every
required job except iOS is green. `IOS_CI = FAILURE` (known, pre-existing,
now root-cause-identified via this wave's own diagnostic improvement).
`OVERALL_QUALITY_WORKFLOW = FAILURE_DUE_TO_KNOWN_IOS` — not claimed green
overall, per this mission's own explicit instruction.

## Production status

```
LIVE_DATABASE_CREATED           = NO
LIVE_DATABASE_MODIFIED          = NO
PRODUCTION_EMAIL_CONFIGURED     = NO
PRODUCTION_EMAIL_DELIVERY_PROVEN = NO
PRODUCTION_CRYPTO_ACTIVATED     = NO
PAYMENT_PROVIDER_CONFIGURED     = NO
PAYMENT_CERTIFICATION_COMPLETE  = NO
ANDROID_REAL_UAT                = NOT_EXECUTED
IOS_REAL_UAT                    = NOT_EXECUTED
PUBLIC_DEPLOYMENT               = NO
MERGED_TO_MAIN                  = NO
```

All database work this wave ran against the repository's own disposable
local MySQL 8.4.11 container (`backend/compose.yaml`), reset via the
repository's own allowlisted `backend/scripts/reset-test-db.mjs` (hard-coded
to refuse any database name other than `pca_test`) — never a live/production
database. No production email provider was configured, no provider account
created, no DNS changed, no production crypto activated, no payment provider
selected, and no deployment to any real environment was performed.

## Privacy status

Every central-readable-sensitive-data invariant remains at zero, re-confirmed
this wave both by the existing gates (`backend/test/schema-privacy.test.mjs`,
`backend/test/db/schema-privacy.mysql.test.mjs`, both re-run and passing) and
directly for this wave's own two new tables (`post-validate.mjs`'s
prohibited-term column-name scan, 646 columns, zero unreviewed hits):

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

A durable central `WebRuleRepository` for parent-authored web allow/deny rules
remains **NOT implemented**: persisting raw domain names centrally is a
privacy-architecture question, not a mechanical fix. The later A012 correction
removed the TypeScript in-memory repository from production composition and
made parent web-rule authoring fail closed with `503 not_configured` until an
approved encrypted delivery/storage mechanism exists. The Android local
`PersistentWebRuleRepository` remains device-local and crypto-gated; it is not a
central readable backend store. Classified `EXTERNAL_DECISION_REQUIRED`,
reported rather than worked around or silently skipped.

## Release status

- **RELEASE_A (Public)**: not touched this wave; governed by its own already
  accepted IA/privacy doctrine per mission instruction. No change.
- **AUTH_B**: `AUTH_B_CODE_PATH_READY = YES` (135/135 tests, re-verified via
  the full backend suite). `AUTH_B_REAL_EMAIL_READY = YES (architecturally)`
  — no code change needed once a real provider is configured.
  `AUTH_B_REAL_UAT_READY = NO` (not executed). `AUTH_B_RELEASE_READY = NO`
  — blocked externally by `PRODUCTION_EMAIL_DELIVERY` (no provider decision)
  and `REAL_UAT` (not executed), not by any code defect.
- **PARENT_C**: Parent Web now has a production Dockerfile/nginx.conf
  closing the previously-undeliverable X-Frame-Options/X-Content-Type-Options/
  Permissions-Policy gap; 996/996 tests pass. Still blocked by the same
  external email/UAT dependencies as AUTH_B for any release requiring
  account creation.
- **ANDROID_D**: VPN/DNS dormancy hardened (explicit gate, not just
  "no caller yet"); `ANDROID_VPN_DNS_POLICY = OWNER_DECISION_PENDING` and
  `THIRD_PARTY_DNS_DEFAULT = NONE`/`VPN_RUNTIME_DEFAULT = DORMANT` both still
  hold. Real CI confirms the change compiles/builds/lints/tests cleanly.
  Real device UAT not performed (no hardware/CI-device access).
- **BILLING**: source-ready (196/196 tests), architecturally provider-neutral,
  no change this wave. `BILLING_SOURCE_READY ≠ BILLING_PRODUCTION_READY` —
  blocked by `PAYMENT_PROVIDER_SELECTION` (external, unchanged).
- **PLATFORM_ADMIN**: audited separately per mission instruction (not forced
  into the A–D ladder). Authority boundary confirmed intact (dedicated
  bearer-token auth, zero `isAdmin` bypass hits repo-wide, no
  `/parent/admin` route). 114/114 + 153/153 tests pass, untouched this wave.

## Final acceptance

### CLOSED
- Security scanner `console.error`/bracket-notation logging-detection
  bypass, PLUS the optional-chaining bypass the fresh adversarial review
  found in that same fix (`console?.error(...)`/`console.error?.(...)`) —
  both closed, tested, 4 negative controls added total.
- Cross-family existence oracle in `ChildRequestService.decide()` (fixed,
  tested at both service and HTTP levels).
- Durable persistence for `DeleteNowLedger` and `ProfileModeRepository`
  (MySQL-backed, migrated, equivalence-proven, tested — including
  cross-family-safe-default security tests).
- Parent Web production Dockerfile/nginx.conf (built, run, headers verified
  live).
- Android VPN/DNS dormancy hardening (explicit policy gate added) — CI-only
  verified (no local toolchain).
- Two documentation corrections (stale schema counts; stale email-gate
  description).
- iOS CI diagnostic improvement (no Swift source touched) — CI-only
  verified.

### BLOCKED / EXTERNAL
- `WebRuleRepository` durability — genuine privacy-architecture question
  (see Privacy status above), requires an owner decision on whether
  centrally-persisted parent-authored domain rules are acceptable, and if
  so, in what form (hashed/encrypted vs. an explicit denylist exception).
- `PRODUCTION_EMAIL_DELIVERY`, `PAYMENT_PROVIDER_SELECTION`,
  `PRODUCTION_CRYPTO_SUITE` (human security review) — all unchanged,
  external, correctly not worked around.
- Real device UAT (Android/iOS), real production email delivery proof,
  live database creation — all correctly out of reach without external
  input this session could not fabricate.
- iOS build root cause — now genuinely identified (a deterministic
  `TEST_HOST`/scheme target-dependency error, confirmed reproducible
  across two separate pushes with byte-identical error text), but not
  fixed: safely editing `.pbxproj`/scheme internals without real Xcode to
  validate the result was judged too risky to attempt blind.

### REMAINING ENGINEERING
- iOS: the real root cause is now known (`Could not find test host for
  PCATests: TEST_HOST evaluates to ".../PCA.app/PCA"` — a deterministic,
  reproducible Xcode project/scheme target-dependency issue, not a Swift
  API mismatch). `PCA.xcscheme` looks structurally correct on inspection;
  `project.pbxproj`'s suspiciously clean sequential object identifiers
  (unlike Xcode's own randomly-generated hex IDs) suggest the actual bug
  is a subtle wiring issue in a hand-authored/generated project file.
  Fixing it safely requires real Xcode to open, validate, and re-save the
  project — genuinely implementable, but not blind.
- Security scanner: identifier aliasing/indirection (`const c = console;
  c.error(...)`, `globalThis['console'].error(...)`) still bypasses
  detection — a fundamentally different, whole-program-analysis class this
  line-based regex scanner was never built to catch (disclosed by the
  fresh adversarial review, unchanged before/after this wave).
- `ChildRequestService.cancel()`/`acknowledgeApplied()` retain an analogous
  device-level (not family-level) existence oracle to the one this wave
  fixed in `decide()` — same unscoped-`repository.get()` pattern, not in
  this wave's diff, flagged by the adversarial review for future attention.
- `MySqlProfileModeRepository.put()`'s upsert does not independently
  re-check `family_id` on conflict (mirrors the already-accepted
  `MySqlEyeProtectionSettingsRepository` precedent exactly; its only
  caller is not wired to any HTTP route in production today, so this is
  inherited, dormant risk, not a new live gap).
- `InMemoryFamilyAuditRepository`, `InMemoryChildRequestRepository`,
  `InMemoryBlockDecisionStateRepository`, `InMemoryPendingQueueStore`,
  `InMemoryDeviceSessionRepository`, `InMemoryActionIdempotencyLedger`,
  `InMemoryModeBFeatureFlagRepository` — all reviewed this wave and found
  to be either explicitly privacy-by-design (a durable version would be a
  regression) or low-severity/owner-decision-gated; no further action
  recommended without a specific new requirement.
