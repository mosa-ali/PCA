# PCA FABLE — STALE DOCUMENTATION REPORT

Audit SHA `5dc1fc0`. **Nothing in this report has been corrected.** It is a
findings list only, per the mission's read-only mandate.

Severity: **P0** blocks a decision that is about to be taken · **P1** would
mislead a supervisor or owner on status · **P2** materially inaccurate ·
**P3** cosmetic / dated-snapshot.

---

## 0. THE HEADLINE

The controlled architecture documents assert, **on the strength of a stated
repository survey**, that the single largest built subsystem in the codebase
does not exist. This is the most consequential documentation defect in the
programme, because `30_IMPLEMENTATION_PROGRAMME.md` is the document a
supervisor opens first.

| Doc:line | Claim | Reality |
|---|---|---|
| `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md:38` | "**No Platform Administration or Billing source exists anywhere in the repository** (confirmed by targeted search for billing/payment/invoice/subscription/stripe/paypal terms)" | **False.** `backend/src/billing/`, `backend/src/platformadmin/`, `backend/src/commercialmaintenance/`, `backend/src/commercialnotifications/`, `backend/src/entitlements/`, `backend/src/familycommercial/`, `platform-admin-web/` (130 tracked files), 12+ billing migrations, ~300 executed tests |
| `…:44` | "A new programme, fully specified but **with no source implementation** … Every workstream … is `SOURCE_COMPLETE = NO`" | False for PCA-PA-1/2, PCA-BILL-1/2/3, PCA-MYKIDS-BILL-1 |
| `docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md:9` | "ARCHITECTURE ONLY — **NOT YET IMPLEMENTED**; no `PCA-PA-*`/`PCA-BILL-*` source exists in this repository" | False |
| `…:456-469` (Section 21) | All 11 workstreams `NOT_STARTED / NOT_STARTED / NOT_STARTED` | 6 are source-complete |
| `…:483` | "every requirement is at the earliest of all three tiers: **no source exists (confirmed by repository survey)**" | False |

**Severity P1.** Note the contrast: `docs/implementation/PCA_COMPLETION_V2_MATRIX.json:7206`
**was** corrected ("source-complete, see corrected entries above"). The
architecture doc and Addendum 002 were not. Anything downstream that inherited
`SOURCE_COMPLETE = NO` for `PCA-BILL-*` inherited a falsehood.

---

## 1. P0 — THE ONE THAT BLOCKS A DECISION IN FLIGHT

| Doc:line | Claim | Reality | Proof |
|---|---|---|---|
| `docs/public/reports/RELEASE_A_ARABIC_REVIEW_GUIDE.md:11,211` | "Rows **189** (one per Arabic content key)"; "the pack must stay at exactly 189 rows" | The live corpus is **193** keys. `RELEASE_A_ARABIC_REVIEW_PACK.csv` and the OD-12 sign-off sheet `RELEASE_A_ARABIC_OWNER_SIGNOFF.csv` are keyed to the older 189-key set | Coordinator-executed set arithmetic: **≥19 live Arabic keys have never been in the pack**, including *every string on the `/download/` page* — the Release-A conversion page. The build itself reports "AR native review 193 key(s) = the whole Arabic corpus" and "new copy to review 37 key(s)" |

**Consequence: OD-12 must not be signed against the current pack.** The owner
would be approving a corpus that is at least 19 keys short. Regenerate the pack
from the live 193-key corpus, then add a gate asserting
`pack keys ≡ AR_REVIEW_PENDING` — the existing check guards the *in-memory*
derived list, not the *exported artifact*, which is exactly why this drifted
through commit `e7f1206`.

---

## 2. P1 — CLAIMS THAT WOULD MISLEAD A SUPERVISOR

### 2.1 Evidence that is claimed as committed but is structurally impossible

| Doc:line | Claim | Reality |
|---|---|---|
| `docs/pre-production/PCA_PPR1R_REMEDIATION_REPORT.md:104` | "**Real-E2E now emits a committed JSON artifact**" | `parent-web/.gitignore:9` and `platform-admin-web/.gitignore:5` both ignore `test-results`; both `playwright.real.config.ts:26` write to `test-results/real-e2e-results.json`. **The artifact can never be committed.** |
| `PCA_PPR1R_DEFECT_REGISTER.csv:40` (`PPR1R-D052`) | `FIXED` — "real-E2E claims now have an artifact a gate script can read" | False closure |
| `PCA_PPR2_STEP5_LOCAL_INTEGRATION_REPORT.md:225`, `PCA_PPR2_OWNER_DECISIONS.md:655,781-783` | `PARENT_REAL_E2E = PASS`, "JSON evidence committed" | Written locally, never committed |
| `PCA_PPR2_BROWSER_UAT_REPORT.md:186-190` | `PLAYWRIGHT_REAL_BROWSER = PASS (33/33)` | `parent-web/playwright.config.ts:8` is `reporter: [['list']]` — emits nothing machine-readable, and the output dir is gitignored regardless |

**This one root cause invalidates every "real E2E PASS with committed artifact"
claim from PPR-1R onward.** Compounding it: **CI runs no Playwright job at all**
(coordinator-verified), so these specs never execute automatically either.

### 2.2 CI capability claims that are simply out of date

| Doc:line | Claim | Reality |
|---|---|---|
| `PCA_PPR1_FINAL_REPORT.md:208-211`, `PCA_PPR1_RELEASE_READINESS_GAPS.md:194-196` | "**CI runs no JavaScript/TypeScript unit suite at all** — 2,055 backend and ~150 web tests never gate a PR" | False. `quality-gates.yml` runs `backend-tests`, `parent-web-unit-tests` (8 shards), `platform-admin-web-unit-tests` (4 shards), plus 4 contract catalogue tests |
| `PCA_PPR1R_DEFECT_REGISTER.csv:36` (`PPR1R-D044`) | `OPEN` / `OWNER_DECISION_REQUIRED` — "a genuine CI cost and latency decision" | Already implemented in CI a day later |
| `PCA_PPR1_RELEASE_READINESS_GAPS.md:197` | "The dependency audit **excludes `parent-web`**" | The `dependency-audit` job covers all six workspaces |

### 2.3 iOS — a forbidden claim, already ruled against

| Doc:line | Claim | Reality |
|---|---|---|
| `PCA_PPR1R_REMEDIATION_REPORT.md:92-93` | "CI runs `xcodebuild test` on a `macos-14` runner that **builds 32 of 32 sources and all 3 extensions**" | The `PCADeviceActivityMonitor` extension target has **one** source file yet references **ten** host-app-only types — it cannot compile. `PCA_PPR2_OWNER_DECISIONS.md:19-32` explicitly forbids this wording: *"a CI job existing is not a job passing. Never write that iOS builds, compiles, or passes CI."* |

### 2.4 Source adjudications that are now flatly wrong

| Doc:line | Claim | Reality |
|---|---|---|
| `docs/product-completion/PCA_PRODUCT_COMPLETION_PLAN.md:29` | "**No forgot-password / account-recovery flow exists anywhere** (frontend or backend)" | `parent-web/src/pages/auth/ForgotPassword.tsx` + `ResetPassword.tsx` routed at `App.tsx:60-61`; `backend/migrations/0029_parent_password_reset_codes.sql` |
| `…:63` and `PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md:57` | "no family-authority backend exists at all"; "Family member invitations (**does not exist yet**)" | `backend/src/familymembers/*`, `http/routes/familyMemberRoutes.ts`, `migrations/0027_family_member_invitations.sql`. The P0-A/P0-C writer briefs are obsolete |
| `PCA_DYNAMIC_WORKFLOW_FINAL_REPORT.md:126` | auto-renew — "**No auto-renew concept exists**" | `migrations/0031_billing_subscription_auto_renew.sql`, `billing/subscription.ts`, `Subscription.tsx:40-95` renders a working `cancelAutoRenew()` |
| `…:127` | eye-protection — "**zero `EYE_PROTECTION` references**" in backend | `backend/src/eyeprotection/`, `http/routes/eyeProtectionRoutes.ts`, `migrations/0032_eye_protection_settings.sql` |
| `…:31` | "**no `docker-compose.yml` exists at the repo root**" | It is tracked at the root |
| `PCA_PPR2_SECURITY_AND_MUTATION_REPORT.md:258` | "**No automated mutation-testing framework is configured in this repo**" | `tooling/mutation/run-mutation.mjs` exists and is discussed by name in PPR-1 §6/§7 |

### 2.5 Closure reached by changing the denominator

| Doc:line | Claim | Reality |
|---|---|---|
| `PCA_ROUND2_CLOSURE_REPORT.md:57-58` | P1 `REMAINING 0`, P2 `REMAINING 0` | Reached by replacing a 299-finding register (110 repo-solvable open) with a 162-behaviour ledger, of which **30 are `BLOCKED_OWNER` and 29 `BLOCKED_EXTERNAL`**, and whose own `AUDIT_STATUS` column shows only **16 of 162 `COMPLETE`** (47 PARTIAL, 26 WORKFLOW_INCOMPLETE, 25 UI_COMPLETE_BACKEND_INCOMPLETE, 21 SOURCE_COMPLETE_UI_INCOMPLETE). Only 3 defects were actually fixed |
| `…:113-116` | "`RESPONSIVE_SCOPE` = **62/62 routes at 375×812, 0 horizontal overflow** … complete rather than carried forward" | No ledger row records it. `PCA_PAGE_QA_LEDGER.csv` has `RESPONSIVE_STATUS = NOT_TESTED` on **70 of 78** rows; `PCA_PAGE_AUDIT.csv` has `BROWSER_STATUS = NOT_TESTED` on **all 62** |
| `…:124` | "Targeted mutation — 14 mutants, 14 KILLED" | No such artifact exists anywhere |
| `PCA_NOT_STARTED_COMPLETION_REPORT.md:106,114,220-222,233,245` | `REPO_SOLVABLE_NOT_STARTED = 0`; `OPEN_SECURITY_FINDINGS = 0`; `PARENT_REAL_E2E = PASS`; verdict `VERIFIED_READY_FOR_PRE_PRODUCTION_RECONCILIATION` | All three exit facts refuted by `PCA_PPR1_FINAL_REPORT.md:236-239` |

### 2.6 Two committed QA ledgers that contradict each other on the same routes

`PCA_PAGE_QA_LEDGER.csv` stamps **52 rows `VERIFIED_BROWSER_PASS`** (including
all billing/settlement/subscription routes) while the *same rows* carry
`RESPONSIVE_STATUS`/`ACCESSIBILITY_STATUS`/`RETEST_STATUS = NOT_TESTED`, and
`PCA_PAGE_AUDIT.csv` marks the identical routes `BROWSER_STATUS = NOT_TESTED`.
**Neither is safely citable.** P1.

### 2.7 The R3 manifest set contradicts itself and `docs/`

| Doc | Claim | Reality |
|---|---|---|
| `.agent-runtime/manifests/pca-r3-final/R3_PROGRESS_LEDGER.md` | `REAL_SOURCE_GAP = 0`, `SOURCE_SOLVABLE_OPEN = 0` | `R3_SOURCE_BACKLOG.csv` still carries **29 open rows**; the audit's own `SOURCE_SOLVABLE` column marks **127 rows CANDIDATE** |
| same | vs `R3_VALIDATION_BACKLOG.csv` | `R3_REQUIREMENT_AUDIT.csv` marks **2** requirements validation-pending; the backlog marks **144**. Both were regenerated by the same tool in the same commit |
| same | "Docker unavailable", "disposable MySQL validation `NOT_EXECUTED`", "spawn EPERM" | Falsified — the DB suite runs (coordinator executed it; 485 tests) |
| `docs/implementation/R3_FINAL_CURRENT_GAP_REDERIVATION.csv` | **9 `REAL_SOURCE_GAP`** rows | The manifest says 0. Spot-checks (`PCA-ADD-ENR-012`, `-016/017`, `-020`) confirm all three are **closed in source**. The `docs/` copy is the stale one — and it is the more discoverable of the two. **P1: mark it superseded** |
| `R3_EXECUTION_SCHEDULE.csv` | 5 writers `ACTIVE_LEASE` at `CURRENT_SHA=c5a444f` | That SHA is 17 days and ~60 commits behind HEAD. Five "active leases" have been open and unworked across two completed programmes. Abandoned scheduler state |

### 2.8 Public-web IA reports describe a site that no longer exists

The last four commits (`bb7c3ff`, `e7f1206`, `76c2def`) moved the site to a
**four-page** IA with `/download/` as a main page and grew the corpus to 193
keys. **No report was updated afterward.**

| Doc:line | Claim | Reality (coordinator-executed build) |
|---|---|---|
| `PUBLIC_2_5_IMPLEMENTATION_REPORT.md:21,44-45,54,112` | 16 routes / 32 pages; `/why-pca/`, `/features/`, `/parents/`, `/security/`; "every primary CTA to `/download/`" | 8 routes / **16 pages**; those four routes do not exist; `resolvePrimaryCta()` → `/how-it-works/` |
| `…:174-188` | DEF-1 **OPEN / BLOCKED_OWNER**, "blocks `/features/` for Release A" | `/features/` deleted; DEF-1 recorded resolved |
| `…:195-205` | `HEAD 74e5ad5`; `public-web/` untracked; BLOCK-1 stands | HEAD `5dc1fc0`; tracked; Part M published |
| `PUBLIC_IA_CONSOLIDATION_CHECKPOINT.md:12,58,60,122` | `PRIMARY_PUBLIC_PAGES = 3`; "**`/download` deleted**"; 7 routes / 14 pages; EN 181 / AR 181 | 4 main pages; `/download/` **re-created as main page #4**; 8 routes / 16 pages; **193/193** |
| `RELEASE_A_PREDEPLOY_REPORT.md:39,49,58,67,122,130,441-444` | 14 pages; **189/189** parity; sitemap 10 entries; "`AR_REVIEW_PENDING` … cannot be narrower than the corpus" | 16 pages; 193/193; 12 sitemap entries. Every count is 4 pages / 4 keys short |
| `…:132` **vs** `…:349,352` | §C `NATIVE_ARABIC_REVIEW = NOT_STARTED` … §H "reviewer **completed all 189 rows**" | Two contradictory statements **inside one document** |
| `RELEASE_A_ARABIC_REMEDIATION_REPORT.md:10-11` vs `RELEASE_A_PREDEPLOY_REPORT.md:356-357` | applied **40** / deferred **20** vs applied **42** / deferred **18** | Commit `4c1a9f6` applied the two owner-released rows; the remediation report was not updated |
| `RELEASE_A_LEGAL_OWNER_INPUT.md:81` | "the **three** main public pages … are content-complete" | Four. `/download/`, the conversion page, is omitted from the readiness statement entirely |
| `RELEASE_A_INFRA_FOLLOWUPS.md:222` | Check "the untracked **`azure-pipelines.yml`** at the repository root" before disabling the ACR admin user | That file does not exist. **This is the only actionable instance** — see the note below |

**Narrowing note on the three vanished root files** (`azure-pipelines.yml`,
`Dockerfile.backend`, `Dockerfile.platform-admin-web`). A completed scoped sweep
found **zero references outside `docs/`** — no build script, workflow, tooling
module or package manifest mentions any of them, so **nothing executable is
broken by their absence**. All references live in five lines across three
documents, and two of those already record the correct state
(`DOCKER_AZURE_SUPPORT_REVIEW.md:49,302` "REJECT_UNSAFE — removed";
`PUBLIC_0_DISCOVERY_REPORT.md:124` "NOT_FOUND"). A third,
`RELEASE_A_PREDEPLOY_REPORT.md:26`, is stale but harmless — it describes a past
session's working conditions.

So this finding is **narrower and sharper than "three docs disagree"**: exactly
one line is a live mis-instruction, and it sits inside the ACR credential-rotation
runbook, telling the owner to inspect a phantom file as a prerequisite to
disabling the admin user. The runbook's surrounding advice ("confirm nothing else
uses them… a CI pipeline") is sound — the answer is simply **nothing does**, and
the owner can now be told that directly instead of being asked to verify it.

Source-internal drift from the same commits: `public-web/src/content/routes.mjs:4,118`
and `src/content/index.mjs:4` all still say "**three** main public pages" while
the same files define four (`routes.mjs:73`). **P2.**

### 2.9 Infrastructure claims contradicted by the files themselves

| Doc:line | Claim | Reality |
|---|---|---|
| `docs/deployment/DOCKER_AZURE_SUPPORT_REVIEW.md:180,408` | "**both base images pinned by digest**" | `platform-admin-web/Dockerfile:58` runtime stage is `FROM nginxinc/nginx-unprivileged:1.27-alpine` — **no digest**. Only the builder stage is pinned, so the image that actually ships is unpinned |
| `docs/database/PCA_LIVE_DATABASE_SETTINGS.md:13-15` | MySQL **8.4** "consistently across `backend/compose*.yaml` **and the root `docker-compose.yml`**" | Root `docker-compose.yml:104` is **`mysql:8.0`** — the version the doc's own §1 warns not to use unverified |
| `…:26` | server collation `utf8mb4_bin` ("never case- or accent-folded") | Root `docker-compose.yml:105` sets **`utf8mb4_unicode_ci`** — case- **and** accent-folding |
| `…DOCKER_AZURE…:275` | port 33061 "matching **`README.md`'s existing convention**" | `README.md` is 33 lines and contains no `33061`, `mysql` or `docker` |

---

## 3. P2 — MATERIALLY INACCURATE

| Doc:line | Claim | Reality |
|---|---|---|
| `docs/database/PCA_CANONICAL_DATABASE_OBJECT_INVENTORY.csv:150,154` | `DEFINING_MIGRATION = backend/migrations/0003_…` for the new invitation FK and index | Both were created by **`0037`**. `grep -c 0037` over that CSV returns **0**. Provenance is wrong in the one CSV whose job is provenance |
| `backend/src/db/schema.ts:5` | "every accepted migration (`0001 through 0036`)" | `0001 through 0037` |
| `backend/scripts/generate-bootstrap-sql.mjs:7` | "All **82** foreign keys…" | **83** |
| `docs/release_readiness/EXTERNAL_GATE_MATRIX.md:14-22` | a 7-row table | The JSON holds **33 gates**. Self-disclosed at `:7-12`, but this is still the human-readable surface most readers open, and it is 26 gates short |
| `docs/release_readiness/evidence/latest.json` | "latest" | **Byte-identical** to `evidence-20260813T051806Z.json`; taken at `fcf80e6`, **474 commits / 1,590 files** behind HEAD, on a dirty tree, with Android skipped and **zero platform-admin-web coverage** |
| `PCA_PPR1_FINAL_REPORT.md:227` etc. | "**442 commits** and 1,296 files behind" | 474 commits / 1,590 files |
| `PCA_PPR1_FINAL_REPORT.md:39-52,58` | `REAL_SOURCE_DEFECT = 11` | **Zero** rows in `PCA_PPR1_PRODUCTION_BASELINE.csv` carry that value; PPR-1R rewrote the CSVs in place and the prose was orphaned |
| `PCA_PPR1_FINAL_REPORT.md:130-131` vs `:264` vs `:176-181` | "FOUND 38 · FIXED 13 · OPEN 23" and `REAL_SOURCE_DEFECTS_OPEN = 23` | The same file's own correction block says 39/12/3/24. Both live in the file |
| `PCA_CHILD_FOCUSED_COPY_GAP_REPORT.md:136-140` vs `:185-187` | `OPEN_COPY_FINDINGS = 30`, `NOT_COMPLETE` … then `= 0`, `COMPLETE` | Two contradictory verdicts published in one file with only an `ADDENDUM` heading between them |
| `docs/database/legacy-postgresql/` | — | Obsolete PostgreSQL DDL for a MySQL project, referenced by **nothing** (`grep` returns zero hits), with **no README or SUPERSEDED marker**. An agent grepping `docs/database/*.sql` can land on Postgres DDL as if authoritative |
| `CURRENT_DIRTY_PATHS.txt` (tracked, root) | A "coordinator-held" inventory dated 2026-08-18 | Matches neither `git status` (clean) nor `stash@{0}`. `PUBLIC_0:431` already says "do not treat it as current" — yet it remains tracked at the repository root |

---

## 4. FINDINGS CONTRIBUTED BY THIS AUDIT'S OWN EXECUTION

| Doc / claim | Status after coordinator execution |
|---|---|
| `MIGRATION_SCHEMA_VS_CANONICAL_BOOTSTRAP = EXACT_MATCH` | **NOT falsified — but its environment precondition is undocumented and unenforced.** The accepted result was established on the supported MySQL **8.4** / `utf8mb4_bin` target and stands (`CANONICAL_SCHEMA_8_4_BIN_EQUIVALENCE = NOT INVALIDATED BY THIS AUDIT`). On an unsupported 9.7 server the two paths diverge on collation for 147 of 626 columns incl. 7 × `family_id`, so `ENVIRONMENT_INVARIANT_EQUIVALENCE = FAIL`. The documentation defect is that the claim is stated unconditionally, while `00_preflight.sql:69` admits MySQL 9 despite its own "must be 8.x" message and nothing asserts default collation or UTC. See `PCA_FABLE_EVIDENCE_LOG.md §3.2` |
| `PCA_LIVE_DATABASE_SETTINGS.md` UTC mandate | Real requirement, **entirely unverified by tooling**. A non-UTC MySQL server silently produces two phantom DB-suite failures |
| "4 pre-existing DB failures" | **Confirmed exactly** (485 tests / 477 pass / 4 fail / 4 skip on a UTC server) — but the characterisation "pre-existing" hid that all four are one live `repository.create is not a function` drift, and that one of them is an **IDOR-defence test**, so that security property is asserted by no executing test |
| `PAYMENT_PRODUCTION_CERTIFICATION` | Specified in six documents, **absent from `docs/release_readiness/external_gate_matrix.json`**. Because `Invoke-ReleaseGateCheck.ps1` iterates only that JSON, the gate governing real-money go-live **can never block a release** |
| Public videos | **NOT a documentation defect — this row is retained only to record the correction.** Zero video files exist and both are placeholders, but that is a *supported shipping state*, not a gap: `videos.mjs:12-19` renders an honest "Coming later" poster-and-transcript card, emits **no `<video>` element**, and renders the transcript in both states as an accessibility requirement. `VIDEOS_BLOCK_RELEASE_A = NO` |

---

## 5. DOCUMENTS THAT ARE HONEST AND SHOULD BE PRESERVED AS-IS

Recording these matters as much as the defects — they are the reference standard:

* `docs/release_readiness/uat_execution_log.json` — a genuine placeholder
  (`NOT_EXECUTED`, 0 cases, `goNoGoDecision: null`). The most honest artifact in
  the corpus.
* `docs/release_readiness/RELEASE_GATE.md`, `README.md`, `UAT_TEST_PLAN.md:3-8`,
  `NETWORK_MATRIX.md:49`, `ROLLBACK_CHECKLIST.md` — all state NOT READY / NOT
  EXECUTED accurately.
* `PCA_PPR2_OWNER_DECISIONS.md:240-246` — the **only** correct statement about
  the mutation harness anywhere in the corpus ("the harness executes zero
  tests … `EQUIVALENT` is manifest-asserted rather than derived … never as
  standalone assurance"), and `:19-32` correctly forbids the iOS-builds claim.
* `docs/implementation/addenda/IOS_LOCAL_DB_HANDOFF.md` — self-declares
  `BLOCKED_EXTERNAL_PLATFORM_VALIDATION` and states plainly that no persistence
  code exists. Still exactly true. **Honest and untouched, not stale.**
* `docs/deployment/DOCKER_AZURE_SUPPORT_REVIEW.md` — apart from the four drifts
  in §2.9/§3, it is the most faithful doc reviewed: it marks all four web
  surfaces NOT DEPLOYED, zeroes every change counter, and explicitly says "Not
  claimed: no SBOM was generated and no vulnerability scanner was run."
* `docs/public/PCA_Public_Programme_Documentation_Package_v0.1` and `v0.2` — both
  verify clean against their `SHA256SUMS.txt` (13/13 each). v0.1 is an
  **intentional archive**, explicitly labelled superseded elsewhere. Only gap: it
  carries no `SUPERSEDED` marker of its own (P3).
* `docs/database/*` — the healthiest set in the repository. Every count I
  re-derived independently matched, at both artifact and database level.

---

## 6. THE TWO ROOT CAUSES WORTH FIXING FIRST

Fixing these two invalidates or restores roughly a dozen claims above at once:

1. **`test-results/` is gitignored in both web apps** — so every "real E2E PASS
   with committed artifact" claim from PPR-1R onward is unbacked, and no gate
   script can ever read one. Fix the reporter output path (or the ignore rule)
   and the claims become checkable.
2. **`tooling/mutation/run-mutation.mjs` executes zero tests** — so every
   `VALID_MUTATION_SURVIVORS = 0` that traces to it is unbacked. Either delete
   the harness or rewrite it to actually run the suite; leaving it in place
   institutionalises a vacuous verdict that six documents already cite.

A third, cheaper than both: **`30_IMPLEMENTATION_PROGRAMME.md:38,44` and
Addendum 002 Section 21** should be corrected first, because they are what a
new supervisor reads before anything else — and they currently describe a
programme that does not match the codebase.
