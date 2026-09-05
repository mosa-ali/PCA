# PCA FABLE — RELEASE ROADMAP

Audit SHA `5dc1fc0`. Read with `PCA_FABLE_EVIDENCE_LOG.md` (coordinator-executed
evidence) and `PCA_FABLE_FINAL_REASSESSMENT_2026-09-05.md`.

**Nothing in this roadmap has been implemented.** It is a sequence proposal for
the owner and primary ChatGPT to approve.

---

## 0. THE SHAPE OF THE PROGRAMME, IN ONE PARAGRAPH

PCA is **not** one product that is 90% done. It is **five products at four very
different maturities**, currently welded together by a release-gate tool that
treats them as one. Release A (the public site) is a self-contained static
artifact that builds green today and is held up by three owner inputs, none of
them engineering. Releases B and C (parent accounts, parent web) are
**architecturally blocked on two external gates that no amount of coding will
close** — a production crypto security review and a payment/email provider
selection — and behind those gates a large amount of genuinely finished code is
sitting inert. Release D (Android) is source-rich and blocked on physical
hardware. iOS is the least mature by a wide margin and has a repo-solvable
compile defect hiding behind four "external" gate rows. The correct next move is
therefore **not** to write more feature code. It is to **decouple the releases**,
**close two owner decisions**, and **repair four dead tests**.

---

## 1. THE CRITICAL PATH, IN ORDER

### Step 1 — Decouple the release gates (repo-solvable, ~1 day, unblocks everything)

Today `tooling/release/Invoke-ReleaseGateCheck.ps1:115` fails on **any** gate not
`CLOSED`, with **no release-scope filter**, over a matrix of **33 gates of which
0 are CLOSED**. The consequence is that Public Release A — a static
informational website with no login, no database and no payment — is formally
blocked by iOS Family Controls entitlements, payment provider selection and
Android hardware UAT.

**Action:** add a `releaseScope` field to each gate in
`docs/release_readiness/external_gate_matrix.json` and make the checker filter on
it. Until that exists, no release can ever pass its own gate, and the gate
therefore gets ignored — which is worse than not having one.

Two defects to fix in the same pass:

* `PAYMENT_PRODUCTION_CERTIFICATION` is specified in six documents but is
  **absent from the JSON**, so the gate governing real-money go-live can never
  block a release. Add it.
* In `docs/implementation/PCA_COMPLETION_V2_MATRIX.json`, **291 of 375 rows have
  `externalGate: []`, and 284 of those read `SOURCE_COMPLETE`** — an empty array
  is indistinguishable from "all gates cleared" to any consumer. Decide whether
  empty means *unguarded* or *cleared*, and make the tool say so.

### Step 2 — Repair the four dead DB tests (repo-solvable, hours, P0 for confidence)

All four failures in the executed DB suite are one drift:
`backend/test/db/parentAccount.mysql.test.mjs` calls `repository.create(...)`,
which no longer exists — production moved to `createAtomically()`. The in-memory
double still has both methods, which is why 2,214 non-DB tests stay green while
these four die.

**Why this is P0 despite being "only a test":** one of the four is
`MySQL SECURITY: a family-member invitation can only be accepted by the account
whose OWN registered email it was addressed to — a stranger with a valid session
gets NOT_FOUND`. That is a cross-account IDOR defence, and it is currently
**asserted by no executing test**. Repair the call sites, then add the guard that
prevents recurrence: a conformance test asserting every double in
`backend/test/support/` implements its production interface (or type-check the
test tree). The same latent drift already exists in
`inMemoryEntitlementRepository.mjs` (8 of 10 methods).

### Step 3 — Close the collation invariant (repo-solvable, hours, P1)

The migration path and the bootstrap package produce **structurally different
databases**: 147 of 626 columns, including 7 × `family_id`, get
`utf8mb4_0900_ai_ci` (case- and accent-**insensitive**) from migrations versus
`utf8mb4_bin` from the bootstrap. Demonstrated: a row stored as `'FamilyAlpha'`
is returned by a query for `'familyalpha'` and for `'FàmilyAlpha'`.

Production starts correct (the bootstrap pins collation explicitly), but a
**future migration that creates a new table with a bare `VARCHAR family_id`
inherits the database default** — and bare `VARCHAR` is the house style in 24 of
35 existing migrations. Since family isolation has **zero foreign keys to
`families`** and rests entirely on `WHERE family_id = ?`, this invariant should
be enforced, not assumed.

**Action:** assert `schemata.default_collation_name = 'utf8mb4_bin'` in
`00_preflight.sql`, and re-assert per-table collation in the migration gate
(`verify-mysql.mjs`), which today checks neither collation nor timezone.

### Step 4 — Release A owner inputs (owner action, not engineering)

Public Release A's **source** is ready: it builds green at HEAD with no
dependencies, 193/193 EN/AR parity, a genuine contrast gate, 0 unregistered
claims, all 48 gate scripts parsing. Three things block publication, and all
three are owner inputs:

1. **OD-12 (Arabic) — regenerate the review pack first.** The pack the reviewer
   and owner sign against is keyed to the older 189-key corpus; **≥19 live keys
   have never been reviewed, including every string on the `/download/` page**.
   OD-12 must not be signed against the current pack, and may not be
   self-approved — it needs the independent native reviewer.
2. **OD-13 (legal).** Operator entity, country, jurisdiction, controller wording,
   public address, effective date. No engineering can invent these.
3. **The two videos do not exist.** Zero `.mp4`/`.webm`/`.mov` files are in the
   repository; both are placeholders with scripts only. Either produce them or
   ship without the video blocks — an owner content decision.

Then, and only then, the infrastructure items: apex `pcasafe.com` has no
A/AAAA/CNAME record and needs its own certificate; ACR pull uses admin
credentials with no managed identity; Always On, HTTP/2 and a health-check path
are all unset. None of that is repo-fixable.

### Step 5 — The two owner decisions that gate everything else

These are the real bottleneck for Releases B, C and D, and they are decisions,
not tasks:

* **`PRODUCTION_CRYPTO_SUITE` / crypto security review.** Today production wires
  `RejectingDeviceSignatureVerifier` and `RejectingEnvelopeSignatureVerifier`,
  which return `false` unconditionally. The consequence chain is total: device
  sessions cannot issue, E2EE envelopes cannot be accepted, family genesis fails,
  so **a newly registered parent gets `familyId = null`**, and
  `UnavailableTrustSetRoleResolver` then denies every parent action. The security
  review package exists (`docs/security/production-crypto-review/`) but contains
  an **empty findings template** — the review has not been performed, and its
  source map's line references have rotted (15 of 31 cited files changed since).
* **`PAYMENT_PROVIDER_SELECTION`** (and merchant approval, charge/settlement
  currencies, bank configuration). The production payment registry is
  intentionally **empty and triple-gated**, which is correct engineering — but no
  provider means no commerce.

**Do not let these be presented as one "crypto activation" milestone.** Seven of
the release-blocking stubs collapse when crypto activates. The rest do not — see
Step 6.

**And do not sequence them in the wrong order.** For Release B the chain is
strictly serial and email comes *first*:

```
email provider (NOT_STARTED)  →  a parent can reach VERIFIED and log in
        ↓
device-signature verifier (crypto review)  →  familyId is no longer null
        ↓
CRYPTO_SUITE_APPROVED_FOR_PRODUCTION = true  →  parent-web's ~16 gated operations wake up
        ↓
parent-web/Dockerfile (does not exist)  →  Release C has somewhere to run
```

None of the four has started. Closing the crypto review first delivers **nothing
observable**, because there is no session with which to reach the gate.

### Step 6 — Durability work that crypto activation does NOT fix (repo-solvable)

Six components are wired in-memory in the production composition root with **no
MySQL sibling anywhere in the repo**. These are independent build work, not
one-line wirings, and they will still be broken the day the crypto review closes:

| Component | `main.ts` | Consequence on restart |
|---|---|---|
| `InMemoryFamilyAuditRepository` | `:278` | The shared audit store for invitation/enrollment/pairing/device/recovery/authz/retention **evaporates** |
| `InMemoryDeleteNowLedger` | `:279` | **The record of a deletion the parent was told had happened is lost** — a privacy-commitment risk |
| `InMemoryWebRuleRepository` | `:579` | Parent-authored web filtering rules are silently lost |
| `InMemoryChildRequestRepository` | `:554` | All bonus-time requests lost |
| `BonusGrantLedger` | `:556` | All granted bonus time lost |
| `resolveEnvelopeContext` placeholder | `:793-799` | Returns empty sender key and zero epochs — **becomes a live anti-downgrade hole the moment crypto activates** |

The last row deserves emphasis: it is currently *masked* by the rejecting
verifier. Activating crypto without fixing it converts a dormant placeholder into
a security defect.

### Step 6b — Keep the retention promise (repo-solvable, P0)

Separate from durability, and more urgent than it looks. A parent who selects a
retention window is returned `accepted: true` by `retentionRoutes.ts:203` — which
validates, audits, and **makes no repository call**. The device separately
hardcodes `FOURTEEN_DAYS` (`RetentionMaintenanceCycle.kt:64-65`). Nothing stores
the choice, nothing delivers it, nothing enforces it.

Until the policy is persisted and delivered, **the product is telling parents
their data-retention decision was accepted when it was not**. Two requirements
assert the opposite and should be challenged in the same pass: `PCA-FR-101` ("the
real 1_MONTH default route and parent retention presentation are real") and
`PCA-SEC-014` ("reclassified once RetentionEngine.kt was confirmed a real,
scheduled…" — it is scheduled, and returns early on every run).

### Step 7 — Release D (Android): finish two repo-solvable items, then the hardware campaign

Android is the most complete client and it **builds and tests clean** — 1,345
unit tests with one skip, `assembleDebug` produces a 14.4 MB APK, lint has 0
errors. But two things must be fixed in-repo before any device campaign is worth
booking:

1. **The enrollment kill switch is two bugs, not one.** `EnrollmentCoordinator.kt:150`
   terminates enrollment on the crypto gate — expected. But `:387` then persists
   **`familyId = ""`**, because the bootstrap DTO never returns one. So even after
   the crypto review clears, retention still returns early at
   `RetentionMaintenanceCycle.kt:67`, and Delete-Now and audit export still throw
   `require(familyId.isNotBlank())`. **Any plan that treats the crypto review as
   Android's last blocker is wrong by one full step.**
2. **A placeholder domain is wired into the production graph.**
   `PcaAppGraph.kt:352` points the real bootstrap client at `https://api.pca.app`,
   a domain the project does not own (the product domain is `pcasafe.com`). It is
   unreachable today only because key generation fails first — so fixing the key
   generator *without* fixing this would send invitation tokens and device public
   keys to an unowned host. `enroll.pca.app` has the same problem in the App Link
   config and the iOS `applinks:` entitlement, which iOS fetches at install time.

Also repo-solvable and cheap: a launcher icon and a release signing config (there
is no `release {}` block at all), and gating retention on the existing
`WallClockRollbackMonitor` so a clock rollback cannot silently stop deletion.

Only then the **physical-device campaign** — real-device UAT, Device Owner
authorization, telephony/SMS, camera, offline interruption recovery, OEM
diversity — plus `assetlinks.json` hosting, which depends on Step 4's Public
deploy. Confirm Play's current `targetSdk` floor against the project's `35`
before committing to a submission date.

### Step 8 — iOS (do not schedule against the other releases)

iOS should be planned as a separate future release. Its four gates
(`IOS_MAC_XCODE`, `IOS_FAMILY_CONTROLS_ENTITLEMENT`, `IOS_PHYSICAL_DEVICE`,
`REQUIRES_ENTITLEMENT`) make it *look* purely externally blocked. It is not:
there is a **repo-solvable compile defect** — the `PCADeviceActivityMonitor`
extension target contains one source file but references ten host-app-only types,
so it cannot compile on any real SDK — plus no `DEVELOPMENT_TEAM`, no app icon,
no launch screen, and no `DeviceActivityCenter` call site anywhere in the tree.
Twelve iOS capability types have zero references outside their own declarations.
Fix those before spending a macOS session.

---

## 2. WHAT CAN SHIP, AND WHEN

| Release | Ships when | Engineering remaining |
|---|---|---|
| **A — Public site** | OD-12 (regenerated pack + native review), OD-13 legal facts, video decision, apex DNS + cert | **Effectively none.** Source builds green today |
| **B — Parent accounts** | An email provider is **built from zero** *and* the crypto review closes | Email is the OUTER blocker: `markVerified` has exactly one caller (inside `verifyEmail`), so **no account can ever reach VERIFIED and no parent can ever log in**. Email provider integration is NOT_STARTED. Plus Step 6 durability |
| **C — Parent Web** | After B, plus a deployment path | **`parent-web/Dockerfile` does not exist** — no container at all — *and* ~16 core operations are hard-gated behind `CRYPTO_SUITE_APPROVED_FOR_PRODUCTION = false`, which is a source constant, not a config flag |
| **D — Android** | After crypto, plus the hardware campaign and `assetlinks.json` hosting (needs A deployed) | Modest; mostly validation |
| **iOS** | Separate future release | Substantial — see Step 8 |
| **Billing** | Provider selection + merchant approval + certification | Domain logic is source-complete; **no provider means no commerce** |

---

## 3. THE SEQUENCING MISTAKE TO AVOID

The tempting plan is "finish the features, then release." That is wrong here, for
a reason the evidence makes plain: **the features are largely finished and
switched off.** The backend has 2,214 passing non-DB tests, a canonical 75-table
schema that provably bootstraps from zero, a fail-closed payment registry, and a
cross-realm auth boundary with real enforcement and a real proving test. What it
does not have is a crypto review, an email provider, a payment provider, a
parent-web container, and legal facts.

So the sequence is: **decouple the gates (Step 1), repair the dead tests and the
collation invariant (Steps 2–3), ship Release A on owner inputs alone (Step 4),
and put the two owner decisions (Step 5) in front of the owner immediately** —
because everything downstream of them is idle until they are made, and Step 6's
durability work can proceed in parallel with them.

---

## 4. HONEST UNCERTAINTY

Items this audit could not verify and which must not be assumed either way:

* The **platform-admin privilege gate** (`npm run test:db:platform-admin-privileges`)
  was NOT_RUN — it needs `PCA_MIGRATION_DATABASE_URL` with elevated grants. Four
  privilege-boundary tests are consequently skipped in every run above.
* **No real-device, macOS/Xcode, provider, store, TLS, email or Azure evidence**
  was produced. Every such gate remains `BLOCKED_EXTERNAL` on evidence this audit
  is not permitted to create.
* Live Azure state was **not** re-probed in this session; the two-App-Service
  topology and "nothing is deployed" are carried from a prior verified session
  and are marked UNVERIFIED_BY_ME here.
* The reverse direction of the OD-12 key diff (pack keys no longer live) needs a
  proper CSV reader; only the "≥19 never reviewed" figure is solid.
