# PCA FABLE — RELEASE ROADMAP

Audit SHA `5dc1fc0` · amended after Primary ChatGPT review of `b1918ae`.
Read with `PCA_FABLE_EVIDENCE_LOG.md` (coordinator-executed evidence) and
`PCA_FABLE_FINAL_REASSESSMENT_2026-09-05.md`.

**Nothing here has been implemented.** This is a sequence proposal.

---

## 0. THE RELEASE MODEL

Six release targets, used consistently across all seven FABLE artifacts:

| Target | Scope |
|---|---|
| **PUBLIC_A** | The informational public site. No login, no database, no payment |
| **AUTH_B** | Parent identity: registration, verification, login/logout, password reset, production service sessions |
| **PARENT_C** | Parent Web: the family surfaces (dashboard, policies, safe zones, requests, audit) |
| **ANDROID_D** | The Android child application |
| **IOS_FUTURE** | iOS, planned as a separate later release |
| **BILLING_FUTURE** | Commercial activation |

**The correction that most changes the plan: `AUTH_B` does not require production
crypto.** `ParentAccountService.verifyEmail` calls `attemptFamilyGenesis`, then
calls `markVerified` **unconditionally with whatever `familyId` came back** —
`null` when the crypto suite rejects. The account still becomes `VERIFIED`, still
receives free-access defaults, and a service session is still issued. Login
requires only `VERIFIED`. So identity and authentication work without the crypto
review.

Crypto still gates family genesis, family authority, E2EE, and device trust — so
it materially blocks `PARENT_C` family functionality and `ANDROID_D`, and it can
be commissioned **in parallel** with the email and live-database work rather than
after it.

---

## 1. THE SEQUENCE

### STEP 1 — Release-gate architecture and scoping repair *(repo-solvable)*

`Invoke-ReleaseGateCheck.ps1` evaluates **`PRODUCTION_CRYPTO_SUITE`** (derived
from `backend/src/main.ts`, `:48-59`) and **`REAL_UAT`** (from
`uat_execution_log.json`, `:69-77`) **before** it reads the external matrix at
`:108`. Adding a `releaseScope` field to `external_gate_matrix.json` alone would
therefore leave `PUBLIC_A` still blocked by a source-derived crypto gate and by
an unexecuted Android-inclusive UAT.

Scoping must cover **four layers**: source-derived crypto gates · `REAL_UAT` ·
external matrix gates · future provider/store/security gates. The checker must
evaluate only gates relevant to the selected release. Its own docstring at
`:20-22` already promises this; `:113-118` never implemented it.

Same pass: add the two missing gate rows (`PAYMENT_PRODUCTION_CERTIFICATION`,
`PRODUCTION_EMAIL_DELIVERY`), and resolve
`TELEMETRY_ACTIVATION_OWNER_SIGNOFF`, which gates *activating* telemetry and so
can never legitimately close.

### STEP 2 — Repair the four dead DB tests, and guard against recurrence *(repo-solvable)*

All four DB-suite failures are one drift: `parentAccount.mysql.test.mjs` calls
`repository.create(...)`, which production replaced with `createAtomically()`.
The in-memory double retains both methods, which is why 2,214 non-DB tests stay
green while the four using the real repository die.

**One of the four is a cross-account IDOR defence test**, so that security
property is asserted by no executing test. Add a conformance test asserting every
double in `backend/test/support/` implements its production interface —
`inMemoryEntitlementRepository.mjs` (8 of 10 methods) is the next one waiting.

### STEP 3 — Database environment, preflight and collation hardening *(repo-solvable)*

Three invariants are unenforced:

* **Version predicate defect.** `00_preflight.sql:69` asserts `major >= 8` while
  its own message says "MySQL major version must be 8.x" — so **MySQL 9 passes**,
  and `:80` emits only an informational note for non-8.4 rather than a `SIGNAL`.
* **Collation.** Nothing asserts the target database default is `utf8mb4_bin`.
  Only 11 of 35 migrations pin collation; the other 24 use bare `VARCHAR` that
  inherits the server default, while the bootstrap pins every column.
* **UTC.** `PCA_LIVE_DATABASE_SETTINGS` mandates `default-time-zone=+00:00`, but
  `verify-mysql.mjs` checks neither timezone nor collation.

Then extend `verify-mysql` and the equivalence check to compare **effective
collations**, and re-run migration-vs-bootstrap equivalence on **supported MySQL
8.4**.

**Scope note.** The coordinator observed the collation divergence on MySQL 9.7 —
which is *not* the supported target, and which the defective predicate admitted.
That demonstrates the environment invariant is unenforced; it does **not**
invalidate the accepted 8.4 / `utf8mb4_bin` equivalence result.

### STEP 4 — Close the cross-family read and assert the isolation invariants *(repo-solvable)*

`EyeProtectionSettingsService.get()` (`:48-50`) is an unauthorized pass-through
while `updateReminders()` (`:61-72`) correctly authorizes; the repository SQL
ignores `familyId`. A parent in family A supplying family B's `childProfileId`
receives B's row — and the not-found path returns the caller's own `familyId`,
making it an existence oracle too.

Then make the isolation counters real: five of the six are asserted by **no code
and no test anywhere**, and this defect proves an unasserted invariant can go
silently false.

### PARALLEL OWNER LANE — finish and publish PUBLIC_A

Public Release A's **source is ready**: it builds green at HEAD with no
dependencies, 193/193 EN/AR parity, a genuine tiered contrast gate, zero
unregistered claims. What remains is owner work, and it can run alongside
Steps 1–4:

1. **Owner visual UAT → PASS** (currently IN_PROGRESS).
2. **OD-12 Arabic** — regenerate the review pack from the live 193-key corpus
   first; ≥19 live keys, including every string on `/download/`, have never been
   reviewed. May not be self-approved.
3. **OD-13 legal facts** — operator entity, country, jurisdiction, controller
   wording, public address, effective date.
4. **Public reply identity / Send-As** — inbound to the four public addresses is
   verified; reply identity remains NOT_READY.
5. **Apex DNS record, certificate and apex→www redirect.**
6. **Production TLS termination and deployment verification.**
7. **Final owner publication authorization.**

**Videos are not blockers.** Unavailable videos render an honest "Coming later"
poster-and-transcript card, emit **no `<video>` element**, and the transcript
renders in both states; critical information is never video-only, and a build
gate prevents flipping `available: true` before the real asset and captions
exist. Producing them is post-publication content work (`FABLE-A021`, P3).

### STEP 5 — PCA-LIVE-DB-1: live database infrastructure and one-time bootstrap

`LIVE_DATABASE_CREATED = NO`; the bootstrap has never been executed against
production. Order: harden preflight (Step 3) → provision live **MySQL 8.4** →
run the one-time approved bootstrap → verify the canonical fingerprint and
runtime grants.

### STEP 6 — Production email provider, then real AUTH_B UAT

**This is the outer blocker for Release B.** No email provider integration exists
anywhere in `backend/src` — zero adapters, zero mail dependencies. `markVerified`
has exactly one caller (inside `verifyEmail`), so **no account can reach
`VERIFIED` and no parent can log in**. The send failure is deliberately swallowed
(`:173-177`), so the parent receives a `202` and waits forever.

This is an **email** gate, not a payment gate — do not file it under
`PAYMENT_PROVIDER_SELECTION`. Add the dedicated `PRODUCTION_EMAIL_DELIVERY` gate
(Step 1) requiring: an approved real provider · a production adapter configured ·
verification-email delivery proven externally · reset-email delivery proven
externally · sender identity and domain authentication (SPF/DKIM/DMARC) verified ·
no test-sandbox adapter active in production.

Then run real registration / verification / login / reset UAT and classify
`AUTH_B`.

### STEP 7 — Production crypto security review *(can start now, in parallel)*

Production wires verifiers that return `false` unconditionally. The review
package exists but its findings document is an **empty template** — the review
has not been performed, and its source map's line references have rotted.

**Commission it in parallel with Steps 5–6.** It does not gate `AUTH_B`, but it
gates `PARENT_C` family functionality and `ANDROID_D`, and its lead time is long.

### STEP 8 — Durability components and `resolveEnvelopeContext`, then PARENT_C

Six components are wired in-memory in the production composition root with **no
MySQL sibling anywhere** — independent build work that crypto activation does not
fix:

| Component | `main.ts` | Consequence on restart |
|---|---|---|
| `InMemoryFamilyAuditRepository` | `:278` | The shared audit store evaporates |
| `InMemoryDeleteNowLedger` | `:279` | **The record of a deletion the parent was told happened is lost** |
| `InMemoryWebRuleRepository` | `:579` | Parent-authored web filtering rules lost |
| `InMemoryChildRequestRepository` | `:554` | Bonus-time requests lost |
| `BonusGrantLedger` | `:556` | Granted bonus time lost |
| `resolveEnvelopeContext` placeholder | `:793-799` | Empty sender key, zero epochs |

**`resolveEnvelopeContext` must be fixed *before* crypto activates** — it is
masked by the rejecting verifier today and becomes a live anti-downgrade hole the
moment that mask is removed.

Also for `PARENT_C`: create `parent-web/Dockerfile` (**it does not exist**, so
Release C has no deployment path at all), and keep the retention promise —
`retentionRoutes.ts:203` returns `accepted: true` and **persists nothing**, while
the device hardcodes `FOURTEEN_DAYS`.

### STEP 9 — Android: repo-solvable cleanup, then the device campaign

Android builds and tests clean (1,345 tests, 1,344 pass; `assembleDebug` produces
a 14.4 MB APK; lint 0 errors). Fix in-repo first:

* **The enrollment kill switch is two bugs.** `EnrollmentCoordinator.kt:150`
  terminates on the crypto gate — expected. But `:387` then persists
  **`familyId = ""`**, so even after the crypto review clears, retention still
  returns early and Delete-Now and export still throw.
* **Placeholder domains in production wiring** — `PcaAppGraph.kt:352` points the
  real bootstrap client at `https://api.pca.app`, a domain the project does not
  own; `enroll.pca.app` likewise in the App Link config and the iOS `applinks:`
  entitlement.
* Launcher icon, release signing config, and gating retention on the existing
  `WallClockRollbackMonitor`.

Then the physical-device campaign and `assetlinks.json` hosting (which depends on
`PUBLIC_A` being deployed). Confirm Play's current `targetSdk` floor against `35`.

### STEP 10 — Billing / commercial activation *(separate track)*

Provider selection, merchant approval, currencies, bank configuration, and
`PAYMENT_PRODUCTION_CERTIFICATION`. Domain logic is source-complete and the empty
production registry is correct engineering. **This track must not gate `AUTH_B`
or `PARENT_C`.**

### STEP 11 — iOS *(separate future release)*

Fix the repo-solvable defects before booking a macOS session: the
`PCADeviceActivityMonitor` target compiles one file referencing ten host-app-only
types; there is no `DEVELOPMENT_TEAM`, no app icon, no launch screen, and no
`DeviceActivityCenter` call site anywhere.

---

## 2. WHAT BLOCKS EACH RELEASE

| Release | Blocking |
|---|---|
| **PUBLIC_A** | Gate scoping · Owner visual UAT · OD-12 (refreshed corpus) · OD-13 legal · public reply identity / Send-As · apex DNS + certificate · TLS/deployment verification · final owner authorization. **Not videos.** Engineering is essentially done |
| **AUTH_B** | Live database (never created) · production email provider (never started). **Not crypto. Not payment provider** |
| **PARENT_C** | AUTH_B, plus the crypto review, plus `parent-web/Dockerfile` (does not exist), plus the durability components and the retention promise |
| **ANDROID_D** | Crypto review · the blank-`familyId` and placeholder-domain fixes · hardware campaign (9 gates) · `assetlinks.json` hosting · icon and signing config |
| **IOS_FUTURE** | Four external gates plus a repo-solvable compile defect |
| **BILLING_FUTURE** | Provider selection, merchant approval, certification |

---

## 3. THE SEQUENCING MISTAKES TO AVOID

1. **"Finish the features, then release."** The features are largely finished and
   switched off. What is missing is two owner decisions, one provider integration
   that was never started, a live database, and gates that cannot tell one
   release from another.
2. **Treating crypto as a Release B blocker.** It is not — identity and login
   work without it. Chaining `AUTH_B` behind the security review delays the one
   release that could follow `PUBLIC_A` soonest.
3. **Treating the crypto review as Android's last blocker.** It is wrong by one
   full step: `familyId = ""` still breaks retention, Delete-Now and export
   afterwards.
4. **Filing email under payment-provider selection.** They are unrelated gates
   with different owners and different lead times.
5. **Scoping only `external_gate_matrix.json`.** Two gates are evaluated before
   that file is ever read.
