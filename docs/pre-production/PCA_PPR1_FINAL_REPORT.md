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

`AGENTS_PLANNED` 20 · `AGENTS_LAUNCHED` 25 (20 auditors + 4 writers + 1 adversarial re-run) ·
`AGENTS_COMPLETED` 23 · `AGENTS_FAILED` 2 · `AGENTS_RETRIED` 1 · Concurrent source writers: never
more than 2.

**Agent 20, the independent adversarial reconciler, was lost to a session rate limit on its first
attempt and re-run successfully.** It earned its place: it overturned two coordinator adjudications,
reopened a fix that had been declared complete, corrected a false clickjacking claim, found four
defects that all 19 domain auditors missed — two of them in `contracts/` and `parent-sdk/`, packages
no lane owned — and forced 11 requirements out of `PRODUCTION_COMPLETE`. Its own summary of the
deliverables was that the arithmetic was sound but *the classifications feeding it were wrong*.

---

## 2. REQUIREMENT CLASSIFICATION — `PCA_PPR1_PRODUCTION_BASELINE.csv`

**Every one of 375 requirements carries exactly one value in `FINAL_CLASSIFICATION`.**
No `PARTIAL`, `FUTURE`, `LATER`, `TBD` or `UNKNOWN` appears in that column. (The CSV's
`MATRIX_STATUS_AT_fa6dee2` column deliberately preserves the *old* matrix status, `PARTIAL` included,
so the reclassification is auditable — an earlier draft of this sentence wrongly claimed `PARTIAL`
appeared nowhere in the file.)

| Classification | Count |
|---|---:|
| `PRODUCTION_COMPLETE` | **272** |
| `SOURCE_COMPLETE_EXTERNAL_GATE` | 44 |
| `REAL_DEVICE_REQUIRED` | 12 |
| **`REAL_SOURCE_DEFECT`** | **11** |
| `IOS_ENTITLEMENT_REQUIRED` | 10 |
| `COMMERCIAL_PROVIDER_REQUIRED` | 8 |
| `NOT_APPLICABLE_V1` | 5 |
| `COMPLIANCE_REQUIRED` | 4 |
| `PRODUCTION_INFRA_REQUIRED` | 4 |
| `SOURCE_COMPLETE_OWNER_DECISION` | 4 |
| `NEW_FEATURE_ARCHITECTURE_REQUIRED` | 1 |
| **TOTAL** | **375** |

**Corrected by the adversarial pass.** The first draft classified **zero** rows `REAL_SOURCE_DEFECT`,
routing every defect into a separate register. Agent 20 showed that 11 rows then sat in
`PRODUCTION_COMPLETE` while failing that label's own definition — *"source done, tested, nothing
external outstanding for V1"* — because the vocabulary offered no home for *source-complete but
broken*. Those 11 now carry `REAL_SOURCE_DEFECT`. `PCA-IOS-002` also moved to
`IOS_ENTITLEMENT_REQUIRED`/`POST_V1`: it was the only iOS-only row still marked `V1_REQUIRED`,
contradicting this report's own `IOS_V1 = DEFER_POST_V1`. A further 14 rows had their basis text
corrected — they claimed test coverage the matrix does not record.

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
| **Parent Web** | `V1_REQUIRED` | 43 routes; 2 of 3 transport defects fixed and verified, the third reopened by the adversarial pass |
| **Platform Admin** | `V1_REQUIRED` | 84 admin routes, all server-side authorized, zero client-only gates |
| **Backend** | `V1_REQUIRED` | 176 routes, no authn/authz bypass, MySQL 8.4, fresh-DB bootstrap exercised |
| **Android** | `V1_REQUIRED`, **Standard Mode only** | Protected Mode has no `DeviceAdminReceiver`; recommend deferring |
| **iOS** | **`POST_V1`** | Host-app composition layer never built — see §5 |
| **Billing** | `V1_OPTIONAL` — free tier only | Entitlement enforcement is real with no provider; 6 gates leave the critical path |
| **AI** | **`POST_V1`** | Zero of 9 controlled requirements make it mandatory; no trained model exists |
| **YouTube** | Mode A `V1_REQUIRED`, **Mode B `POST_V1`** | Mode A complete and honestly labelled |
| **Recovery** | **`V1_REQUIRED`** | Must ship in the same release as crypto activation — see §5 |
| **Wellbeing** | `V1_REQUIRED` — **but the claim is weaker than it looks** | Android card channels render. However the contract and SDK define 13 categories, the shipping Parent Web UI defines 6 **entirely different** ones, and the backend has no wellbeing implementation at all. An earlier draft of this row said "card channels complete"; the adversarial pass showed that is too generous. Treat as contract-and-SDK-only with a divergent half-built UI until the taxonomy is reconciled. |
| **Observability** | `PRODUCTION_INFRA_REQUIRED` | Source honest; pipeline, alert delivery and CD absent |
| **Commercial** | `V1_OPTIONAL` | Follows the billing decision |
| **Infrastructure** | `PRODUCTION_INFRA_REQUIRED` | No topology, no backup, no rollback path |

Requirement-level V1 scope: `V1_REQUIRED` 351 · `V1_OPTIONAL` 8 · `POST_V1` 11 · `NOT_APPLICABLE` 5.

**Answers to the five mandatory questions:**
`ANDROID_V1` = Standard Mode only (QR provisioning post-V1) ·
`IOS_V1` = **DEFER_POST_V1** ·
`AI_V1` = **DEFER_POST_V1** ·
`YOUTUBE_MODE_B_V1` = **POST_V1** (Mode A sufficient) ·
`RECOVERY_V1` = **V1_REQUIRED**

---

## 4. EXTERNAL GATES — `PCA_PPR1_EXTERNAL_GATE_MATRIX.csv`

`GATES_TOTAL_ALL_SOURCES` = **37** · `V1_EXTERNAL_GATES_TOTAL` = **35** ·
`V1_EXTERNAL_GATES_BLOCKING` = **20** · Gates `CLOSED` = **0** · Gates with evidence = **0**.

34 were pre-existing across four disagreeing registers; **3 are newly proposed by PPR-1** because they
are real dependencies referenced in source and tracked in no register at all (verified absent from
both 33-gate registers): `DOMAIN_DNS_HOSTING`, `DATABASE_BACKUP_RESTORE`, `EMAIL_PROVIDER_SELECTION`.
All three carry `PROPOSED_NOT_REGISTERED` and are **not yet enforced** by the release gate script,
which reads `external_gate_matrix.json` only.

The 20 blocking gates collapse into **five owner workstreams**: crypto review and activation (4), the
Android device lab (5), production domain/TLS/DNS (3), payment provider onboarding (6), and platform
operations — backup/restore and email delivery (2).

**The register disagreed four ways** before this mission: `external_gate_matrix.json` held 33, the
completion matrix 14, `RELEASE_GATE.md` said "seven", and the evidence pack captured 7. A fourth
register was found under `.agent-runtime/`. `PAYMENT_PRODUCTION_CERTIFICATION` exists only in the
completion matrix, so **the release gate script does not currently enforce it.**

---

## 5. REAL SOURCE DEFECTS

`REAL_SOURCE_DEFECTS_FOUND` = **38** (deduplicated) · `FIXED_AND_VERIFIED` = **13** ·
`PARTIALLY_FIXED` = **2** · `REAL_SOURCE_DEFECTS_OPEN` = **23**

### Fixed and independently verified by execution

Android: `INTERNET` declared (**the app could not make a single network call**); hardcoded English
label moved to resources with a real Arabic translation (key parity 312/312); relay transport given
the same HTTPS guard its sibling bootstrap client already had.
Backend: CORS `DELETE` unblocked (a shipped, tested safe-zone route was unreachable from its only
client); `Dockerfile` now sets `NODE_ENV=production`, so **session cookies no longer ship without
`Secure`**; raw mysql2 errors — which carry the fully interpolated SQL *with bound values* — routed
through the bounded logger; `/health/db` rate-limited; **all 40 unlimited authenticated routes**
closed via an instance-level hook, making the omission structurally unrepeatable.
Billing: complimentary capacity made visible (it was consumable but invisible); the FREE_ACCESS gate
bound to parent-member invitation, as its own frozen contract always required.
Privacy: the retention enum can now address installed-app events.
Parent Web: the retention and device-enrollment clients moved to the real cookie transport — the
adversarial pass attacked this hardest and **could not break it**.

Verification: `tsc` clean in backend, parent-web and platform-admin-web; backend 26/26 and 273 across
19 files; parent-web 41/41; platform-admin CSP 7/7; repository-quality CI `exit 1 → exit 0`.

### Partially fixed — counting these as closed would overstate

- **`PACKAGE_USAGE_STATS`**: declared, but **no flow anywhere sends the parent to
  `ACTION_USAGE_ACCESS_SETTINGS`**, so the permission still cannot be granted and screen time, Break
  Shield, wellbeing eligibility and YouTube duration still read empty data on a real device. The
  declaration is necessary, not sufficient.
- **Platform-admin CSP**: a strict policy now ships (`script-src 'self'`, no inline or eval,
  `object-src 'none'`) — but it is delivered via `<meta>`, and **`frame-ancestors` is ignored in
  `<meta>` per CSP3**. An earlier draft of this report claimed the clickjacking vector was closed.
  **It is not, on either console** — parent-web has the same limitation. Real protection requires
  `X-Frame-Options`/`frame-ancestors` as HTTP response headers from the host.

### Reopened by the adversarial pass

**The device-id resolver fix is directionally right but the capability is still dead.** It correctly
refuses to fabricate an id — genuinely better than the 43-character value that could never match a
`CHAR(36)` column — but nothing writes device statuses into the local store
(`localFamilyDataStore.ts` says so in its own header), so it can never return an id. Its 9 passing
tests all stub the client with a real record, proving nothing about production. **This is the exact
JVM-test-against-unreachable-code pattern §1 of the gaps report identifies**, reproduced inside this
mission's own fix. Returned to the open register.

### The open defects are catalogued in `PCA_PPR1_RELEASE_READINESS_GAPS.md` §2

> **PPR-1R correction.** This heading previously read "The 27 open defects". That 27 was a stale
> `33 − 6` carried over from the pre-adversarial draft and never updated when the counts were
> rewritten. PPR-1's true figures, re-derived from the actual rows, are
> **FOUND 39 · FIXED 12 · PARTIAL 3 · OPEN 24** — the published `38`/`23` had silently dropped the
> iOS defect from the arithmetic in the very pass that elevated it to the most consequential open
> item. Superseded by `PCA_PPR1R_DEFECT_REGISTER.csv`.

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
| `OWNER_DECISIONS_REQUIRED` | **20** documented and prioritised: 5 mandatory, the D6-D7-D8 commercial chain, **D16 split-origin domain topology** (elevated to a full section — a true `app.`/`api.` split breaks every Parent Web mutation), and the rest. |

**Entry-fact rulings — as ruled by the independent adversarial pass, which overturned two of the
coordinator's own adjudications.**

| Entry fact | Ruling | Decisive evidence |
|---|---|---|
| `PCA SOURCE IMPLEMENTATION = VERIFIED_ACCEPTED` | **REFUTED** | `SchedulePolicyStore.save()` has no production writer, so no parent-authored policy can ever reach a device — beneath six rows that were marked `PRODUCTION_COMPLETE`. |
| `REPO_SOLVABLE_NOT_STARTED = 0` | **REFUTED** | The coordinator ruled this survived because the defects sat "in the gaps between register rows". **That ruling was wrong.** Five instances sit *on top of* register rows — AND-5, AND-9, AND-6, the wellbeing taxonomy divergence and the runtime-sync contract drift — and none needs a device, a gate, or an owner decision. |
| `PARENT_REAL_E2E = PASS` | **UPHELD_WITH_QUALIFICATION** | The spec exists and its assertions are real, but the config uses a list reporter and **no result artifact is committed anywhere** — the same evidentiary class as the Android test count this mission deleted for being unsupported. |
| `PLATFORM_ADMIN_REAL_E2E = PASS` | **UPHELD_WITH_QUALIFICATION** | Same absent artifact; one test, APP_OWNER only, zero negative RBAC assertions against the real backend. |
| `OPEN_SECURITY_FINDINGS = 0` | **REFUTED at audit time; the decisive instance is now fixed** | The shipped image set session cookies without `Secure`. That is closed. Other findings remain open, including no effective clickjacking protection on either console. |
| `VALID_MUTATION_SURVIVORS = 0` | **REFUTED (unsupported)** | The harness hard-fails unless HEAD matches a SHA now ~140 commits behind. The coordinator called this "unverifiable" and then left the fact in the accepted list — the adversarial pass was right to press it. |

**On the coordinator's overturned adjudication.** Early in this mission I ruled that the entry facts
survived because the defects lived between register rows rather than contradicting any row. Agent 20
demonstrated that was a rationalisation: once the 11 broken requirements carry `REAL_SOURCE_DEFECT`
instead of `PRODUCTION_COMPLETE`, the defects are *on* the rows and the entry fact falls on its own.
The classification change in §2 and this ruling are the same correction.

## 8. VERDICT

Every reconciliation objective was met: 375 requirements classified, 37 gates mapped to V1 relevance,
20 owner decisions made explicit, V1 scope defined for the first time in the programme's history, and
the documentation's most serious unsupported claim removed. **13 real defects were fixed and verified
by execution** — including two one-line manifest omissions that between them prevented the Android app
from using the network or observing any usage at all, a shipped image that sent session cookies
without `Secure`, and 40 authenticated routes with no rate limiting.

**The independent adversarial pass changed this report materially, and that is the point of it.**
It overturned two of the coordinator's own adjudications, reopened a fix that had been declared
complete, corrected a false claim that clickjacking protection was in place, found four defects that
all 19 domain auditors missed — two in packages no lane owned — and forced 11 requirements out of
`PRODUCTION_COMPLETE`. A version of this report published before that pass would have been
meaningfully wrong in the owner's favour.

`REAL_SOURCE_DEFECTS_OPEN = 23`. Reaching zero is **not** achievable inside PPR-1, for two structural
reasons rather than effort:

1. **Some defects are downstream of the very decisions PPR-2 exists to make.** The iOS composition
   layer is only a V1 defect if iOS ships in V1 — and the recommendation is to defer it. The same
   applies to every Protected-Mode-dependent item.
2. **The remainder is a feature programme** — an Android onboarding permission flow, a
   parental-consent / privacy-policy / account-deletion surface, an iOS application layer — which
   this mission was explicitly scoped not to become.

What was achievable was driven to its floor: every defect fixable without an owner decision or new
architecture has been fixed and verified.

```
PCA_PPR1 =
NOT_COMPLETE
```

**Why not READY.** Declaring readiness with 23 open defects — several meaning the Android app cannot
function on a real device, one meaning the iOS app would shield nothing, and three entry facts
refuted — would be precisely the unsupported production claim this mission exists to eliminate.

**What closes it:** the owner decisions in `PCA_PPR1_OWNER_DECISIONS.md` (which determine how many of
the 23 are even in scope), then a scoped remediation mission for what survives, then a release-evidence
refresh against the final SHA. Three Tier-1 items should start now because they are external queues
the organisation does not control: **commission the crypto review** (covering `PCA-DEC-020` and `-021`
together), **file the Apple Family Controls entitlement application**, and **select a payment
provider**.

This mission did not declare production readiness, did not begin Azure or domain work, and did not
merge to `main`.
