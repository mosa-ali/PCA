# PCA PPR-1 — FINAL REPORT

**Mission:** Final production baseline reconciliation — source / requirements / gates / V1 scope.
**Type:** Reconciliation audit. Not an implementation programme.

---

## 1. GOVERNANCE

| | |
|---|---|
| `PPR1_ENTRY_SHA` | `fa6dee2bbce1b86008aa7397133f8dc90395e6d6` (= `origin/pca-dev`, working tree clean at entry) |
| `PPR1_FINAL_SHA` | this commit on `pca-dev` |
| `REMOTE_PCA_DEV` | `fa6dee2…` — **unchanged; nothing pushed.** Publication is the owner's call. |
| `REMOTE_MAIN` | `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` — **unchanged and untouched.** |
| Merges to `main` | none · Force pushes | none · Stashes | none · Destructive resets | none |

`AGENTS_PLANNED` 20 · `AGENTS_LAUNCHED` 22 (20 auditors + 2 writers) · `AGENTS_COMPLETED` 21 ·
`AGENTS_FAILED` 1 · `AGENTS_RETRIED` 0 · Concurrent source writers: never more than 2.

**⚠ Agent 20, the independent adversarial reconciler, did not complete** — it was terminated by a
session rate limit shortly after starting. Its role was to distrust and attack the other 19 agents'
conclusions. **That adversarial pass is a genuine gap in this mission's own assurance.** It is
partially compensated: the coordinator personally re-verified the highest-consequence claims with
direct commands rather than accepting agent reports (the missing `INTERNET` and `PACKAGE_USAGE_STATS`
declarations against both source and merged manifests; the iOS `startMonitoring` absence; the auth
plugin's cookie acceptance; the `CHAR(36)` device-id arithmetic; the red CI job), and every applied
fix was verified by executed tests rather than writer self-report. It is **not** fully compensated,
and a re-run of Agent 20 is recommended before the owner acts on the classification tables.

---

## 2. REQUIREMENT CLASSIFICATION — `PCA_PPR1_PRODUCTION_BASELINE.csv`

**Every one of 375 requirements now carries exactly one final production classification.**
No `PARTIAL`, `FUTURE`, `LATER`, `TBD` or `UNKNOWN` remains anywhere in the baseline.

| Classification | Count |
|---|---:|
| `PRODUCTION_COMPLETE` | **284** |
| `SOURCE_COMPLETE_EXTERNAL_GATE` | 44 |
| `REAL_DEVICE_REQUIRED` | 12 |
| `IOS_ENTITLEMENT_REQUIRED` | 9 |
| `COMMERCIAL_PROVIDER_REQUIRED` | 8 |
| `NOT_APPLICABLE_V1` | 5 |
| `COMPLIANCE_REQUIRED` | 4 |
| `PRODUCTION_INFRA_REQUIRED` | 4 |
| `SOURCE_COMPLETE_OWNER_DECISION` | 4 |
| `NEW_FEATURE_ARCHITECTURE_REQUIRED` | 1 |
| `DEFERRED_POST_V1` | 0 at requirement level (applies at capability level — see V1 scope) |
| **TOTAL** | **375** |

**`TOTAL_REQUIREMENTS = 375`, not 371.** The 371 figure predates the four owner-approved
`PCA-NIGHT-COMMUNICATION-SAFETY-1` requirements. Both numbers appear in current-state documents;
375 is correct and the composition is arithmetically exact (199 Base A-100 + 25 + 98 + 24 + 25 + 4).

**Two normatively-cited requirement IDs exist in no ledger at all** — `PCA-SEC-016` (prohibition on
home-grown crypto primitives) and `PCA-DATA-030` (authoritative clock rule). Both are substantively
satisfied in source; both are inventory-registration holes. Registering them makes the true
controlled inventory 377 — an owner-approved controlled-document correction, not an engineering task.

---

## 3. V1 PRODUCTION SCOPE — `PCA_V1_PRODUCTION_SCOPE`

**No V1 scope register existed anywhere in the repository before this mission** — a search for the
V1 vocabulary across `docs/` returned zero files. Every prior V1 judgement was an implicit assumption.

| Domain | V1 | Basis |
|---|---|---|
| **Parent Web** | `V1_REQUIRED` | 43 routes; 3 transport defects found and fixed this mission |
| **Platform Admin** | `V1_REQUIRED` | 84 admin routes, all server-side authorized, zero client-only gates |
| **Backend** | `V1_REQUIRED` | 176 routes, no authn/authz bypass, MySQL 8.4, fresh-DB bootstrap exercised |
| **Android** | `V1_REQUIRED`, **Standard Mode only** | Protected Mode has no `DeviceAdminReceiver`; recommend deferring |
| **iOS** | **`POST_V1`** | Host-app composition layer never built — see §5 |
| **Billing** | `V1_OPTIONAL` — free tier only | Entitlement enforcement is real with no provider; 6 gates leave the critical path |
| **AI** | **`POST_V1`** | Zero of 9 controlled requirements make it mandatory; no trained model exists |
| **YouTube** | Mode A `V1_REQUIRED`, **Mode B `POST_V1`** | Mode A complete and honestly labelled |
| **Recovery** | **`V1_REQUIRED`** | Must ship in the same release as crypto activation — see §5 |
| **Wellbeing** | `V1_REQUIRED` | Card channels complete; app-eligibility triggers `POST_V1` |
| **Observability** | `PRODUCTION_INFRA_REQUIRED` | Source honest; pipeline, alert delivery and CD absent |
| **Commercial** | `V1_OPTIONAL` | Follows the billing decision |
| **Infrastructure** | `PRODUCTION_INFRA_REQUIRED` | No topology, no backup, no rollback path |

Requirement-level V1 scope: `V1_REQUIRED` 352 · `V1_OPTIONAL` 8 · `POST_V1` 10 · `NOT_APPLICABLE` 5.

**Answers to the five mandatory questions:**
`ANDROID_V1` = Standard Mode only (QR provisioning post-V1) ·
`IOS_V1` = **DEFER_POST_V1** ·
`AI_V1` = **DEFER_POST_V1** ·
`YOUTUBE_MODE_B_V1` = **POST_V1** (Mode A sufficient) ·
`RECOVERY_V1` = **V1_REQUIRED**

---

## 4. EXTERNAL GATES — `PCA_PPR1_EXTERNAL_GATE_MATRIX.csv`

`V1_EXTERNAL_GATES_TOTAL` = **32** of 34 · `V1_EXTERNAL_GATES_BLOCKING` = **17** ·
Gates `CLOSED` = **0** · Gates with evidence populated = **0**.

The 17 blocking gates collapse into just **four owner workstreams**: crypto review and activation (4),
the Android device lab (5), production domain and TLS (2), payment provider onboarding (6).

**The register disagreed four ways** before this mission: `external_gate_matrix.json` held 33, the
completion matrix 14, `RELEASE_GATE.md` said "seven", and the evidence pack captured 7. A fourth
register was found under `.agent-runtime/`. `PAYMENT_PRODUCTION_CERTIFICATION` exists only in the
completion matrix, so **the release gate script does not currently enforce it.**

Three gates are proposed as new registrations because the dependencies are real, referenced in source,
and tracked nowhere: **`DATABASE_BACKUP_RESTORE`**, `DOMAIN_DNS_HOSTING`, `EMAIL_PROVIDER_SELECTION`.

---

## 5. REAL SOURCE DEFECTS

`REAL_SOURCE_DEFECTS_FOUND` = **33** (deduplicated) ·
`REAL_SOURCE_DEFECTS_FIXED` = **6** · `REAL_SOURCE_DEFECTS_OPEN` = **27**

### Fixed and independently verified this mission

| Defect | Verification |
|---|---|
| `android.permission.INTERNET` declared nowhere — **the Android app could not make a single network call** | Manifest diff reviewed; XML well-formedness confirmed |
| `PACKAGE_USAGE_STATS` declared nowhere — screen time, Break Shield, wellbeing and YouTube duration all read permanently-empty data on a real device | Declared with `tools:ignore`; comment records that the grant flow is still required and was deliberately not built |
| CORS blocked `DELETE` and `PUT` — a shipped, tested safe-zone deletion route was unreachable from its only client | `tsc` exit 0; **CORS tests 3/3 pass**, including a new test covering every method the browser clients send |
| `RealRetentionClient` short-circuited on a false premise — 3 privacy controls dead | `tsc` exit 0; **32/32 tests pass** |
| `RealDeviceEnrollmentClient`, same false premise | included above |
| Fabricated `device-${childId}` recipient id — 43 chars into a `CHAR(36)` column, could never resolve | **9/9 tests pass**; now resolves the real device id and refuses to fabricate |

Also fixed: the **repository-quality CI job**, verified `exit 1 → exit 0` (2,122 files checked), and
with it a mutual contradiction where the release gate *required* `.agent-runtime/` to be tracked while
the repo check *failed because* it was — no repo state satisfied both.

### The 27 open defects are catalogued in `PCA_PPR1_RELEASE_READINESS_GAPS.md` §2.

They were deliberately not fixed here. Closing them means building an Android onboarding-permission
flow, an iOS application layer, and a parental-consent/privacy-policy/account-deletion surface — a
feature programme, which this mission was explicitly instructed not to become.

**The single most consequential open item:** iOS is **not** "source-complete behind external gates,"
as it has been recorded for months. `DeviceActivityCenter.startMonitoring` is called **nowhere**;
nothing writes the App Group keys the extension reads; there is **no networking of any kind**; the app
picker is never presented. Buying the entitlement, a Mac and a device would yield a working build of
an app that **shields nothing**. This is one defect wearing five hats: the host-app composition layer
was never built.

---

## 6. DOCUMENTATION AND TOOLING

`DOCUMENTATION_STALE_FOUND` = **33** (edit-ready, with verbatim quotes and replacement text) ·
`DOCUMENTATION_STALE_FIXED` = **6** (all P0).

Applied: the Android test count that its own cited evidence pack records as **never run** — the only
place in the entire audited corpus where a document claims executed validation with no supporting
artifact; the "seven external gates" claim in three documents; the evidence table's stale-run banner;
and `EXTERNAL_GATE_MATRIX.md`'s false claim to be generated. Historical documents were left untouched.

`TOOLING_STALE_FOUND` = **13** · `TOOLING_STALE_FIXED` = **1** (the repo-check allowlist).

Notable open tooling gaps: **CI runs no JavaScript/TypeScript unit suite at all** — 2,055 backend and
~150 web tests never gate a PR; the dependency audit excludes `parent-web`; the mutation harness
**aborts unless HEAD matches a SHA 136 commits old**, so `VALID_MUTATION_SURVIVORS = 0` at this
baseline has no tool artifact behind it; and the security/quality CI jobs remain red for **nine
pre-existing violations** that first-failure-only reporting had concealed.

---

## 7. STATUS OF EACH MANDATED AREA

| Field | Value |
|---|---|
| `REAL_UAT_STATUS` | `NOT_EXECUTED` — unchanged, and honestly documented everywhere |
| `REAL_UAT_CASES_LOGGED` | **0** |
| `REAL_UAT_CASES_REQUIRED_FOR_V1` | **50 defined, but the plan is incomplete** — it has zero cases for platform-admin, billing, settlement or commercial, and **zero iOS-scoped cases**. 20 of 50 are pre-blocked by the crypto review; 6 are redefined by an unmade owner decision; 30 are executable the day Android hardware arrives. |
| `CRYPTO_REVIEW_STATUS` | **NOT STARTED.** The findings template is blank and unsigned; no reviewer is assigned. 36 explicit reviewer assertions were produced as the engagement's scope. Zero fail-open verifiers, zero committed keys, zero non-CSPRNG in any security path. |
| `PAYMENT_PROVIDER_STATUS` | **No provider, no merchant account, no live execution.** The only adapter is triple-gated out of production. Billing source is complete: exact integer minor units, idempotency on every mutating path, verified webhook signatures. |
| `PRODUCTION_INFRA_STATUS` | `PRODUCTION_INFRA_REQUIRED`. **No database backup and no tested restore exist, and no gate tracks them** — the largest untracked production risk. |
| `PCASAFE_DOMAIN_STATUS` | Model recorded only. **No DNS, Azure or hosting action taken.** A true `app.`/`api.` split would break every Parent Web mutation (host-only CSRF cookie); single-origin behind a proxy needs zero source change. |
| `RELEASE_EVIDENCE_FRESHNESS` | **STALE.** `EVIDENCE_REFRESH_REQUIRED = YES` — 442 commits behind, zero `platform-admin-web` coverage, Android skipped. |
| `OWNER_DECISIONS_REQUIRED` | **20** documented and prioritised (5 mandatory + commercial chain + 12 others). |

**Entry-fact rulings.** `REPO_SOLVABLE_NOT_STARTED = 0` — **upheld**, strictly, within the register's
scope. `PARENT_REAL_E2E` / `PLATFORM_ADMIN_REAL_E2E = PASS` — **upheld but far narrower than the names
suggest**: the platform-admin spec is one test, APP_OWNER only, with zero negative RBAC assertions
against the real backend; the parent spec exercises no mutation, no child-scoped page and no
Arabic/RTL. `OPEN_SECURITY_FINDINGS = 0` — **upheld for authN/authZ/IDOR/injection/secrets/SSRF/
redirect/XSS** (173 route sites swept, zero unscoped lookups), **qualified** by defects outside those
categories. `VALID_MUTATION_SURVIVORS = 0` — **unverifiable at this baseline**; the harness cannot run.
`PCA SOURCE IMPLEMENTATION = VERIFIED_ACCEPTED` — **materially weakened**: it meant the source matches
its documentation, never that it is runtime-reachable on a real device.

---

## 8. VERDICT

Every reconciliation objective was met: 375 requirements classified, 34 gates mapped to V1 relevance,
20 owner decisions made explicit, V1 scope defined for the first time, and the documentation's most
serious unsupported claim removed. Six real defects were fixed and verified, including two one-line
manifest omissions that between them prevented the Android app from using the network or observing
any usage at all.

But the mission's success condition requires that every genuine defect found be fixed and
independently verified, and **27 remain open** — correctly so, since closing them is feature work this
mission was told not to undertake. The independent adversarial pass also did not run.

Declaring readiness with 27 verified defects open — several meaning the Android app cannot function on
a real device, and one meaning the iOS app would shield nothing — would be precisely the kind of
unsupported production claim this mission exists to eliminate.

```
PCA_PPR1 =
NOT_COMPLETE
```

**What would close it:** re-run the adversarial reconciler; remediate the 27 open defects in a
scoped follow-on mission (the Android permission-request flow, the parental-consent/privacy-policy/
account-deletion surface, and the platform-admin CSP are the V1 blockers); refresh release evidence
against the final SHA; and return the owner's answers to the 20 decisions — of which three are
Tier 1 and should be started this week: **commission the crypto review, file the Apple Family
Controls entitlement application, and select a payment provider.**

This mission did not declare production readiness, did not begin Azure or domain work, and did not
merge to `main`.
