# PCA PPR-1 — RELEASE READINESS GAPS

**Baseline:** `fa6dee2bbce1b86008aa7397133f8dc90395e6d6`
**Scope:** everything standing between this source baseline and a defensible production release.
Companion documents: `PCA_PPR1_PRODUCTION_BASELINE.csv`, `PCA_PPR1_EXTERNAL_GATE_MATRIX.csv`,
`PCA_PPR1_OWNER_DECISIONS.md`, `PCA_PPR1_FINAL_REPORT.md`.

---

## 1. THE CENTRAL FINDING

Every prior programme validated PCA with **JVM, Robolectric, vitest and node tests**. None of that
executes on a real device or a real iOS build. That is not a criticism of the tests — the suites are
large, genuine, and largely passing — it is a statement about what they *can* prove.

**A JVM test passes happily against Android code that can never obtain the permission it needs.**

This mission's most consequential findings are all of that shape: source that is correct, tested, and
documented, but which cannot function on the target platform. The `0 of 50` real-device UAT figure and
the Android defects below are the same fact viewed from two directions.

**Consequence for the entry baseline:** `PCA SOURCE IMPLEMENTATION = VERIFIED_ACCEPTED` was true in
the sense it was asserted — the source matches its documentation. It never meant *runtime-reachable on
a real device*, and it should not be read that way again.

---

## 2. REAL SOURCE DEFECT REGISTER

Deduplicated across all audit lanes. **Severity is about production impact, not code size.**
Several of the most severe are one-line omissions.

### 2.1 Android — the app cannot function on a real device

| ID | Defect | Evidence | Status |
|---|---|---|---|
| **AND-1** | **`android.permission.INTERNET` is declared nowhere.** Not in the source manifest, not in either merged manifest, not in any XML in `android/`. `AndroidConnectivityMonitor.kt:14-22` documents the requirement in its own doc comment and records that its lane could not add it — it never was. Two production `HttpURLConnection` clients exist and would throw on any real device. **The Android app cannot make a single network call.** | verified by coordinator | **FIXED in this mission** |
| **AND-2** | **`android.permission.PACKAGE_USAGE_STATS` is declared nowhere** (string appears only in a doc comment). Without it the app never appears in Settings → Usage access, `unsafeCheckOpNoThrow` can never return `MODE_ALLOWED`, and `queryEventsSince` returns `emptyList()` forever. **Screen time, Break Shield, wellbeing eligibility and YouTube Mode A duration all read permanently-empty data.** | verified by coordinator | **Manifest declaration fixed; grant flow still required** |
| **AND-3** | `POST_NOTIFICATIONS` and the three location permissions are declared but **never runtime-requested**. Only `CAMERA` and `READ_PHONE_STATE` are. On API 33+ every notification-delivered feature and all location features are inert. | verified by coordinator | **OPEN — needs onboarding UI (out of PPR-1 scope)** |
| **AND-4** | Shield and wellbeing-card Activities are started from the application context with no background-activity-launch exemption and no `SYSTEM_ALERT_WINDOW`. The shield will appear only while PCA is already foreground — never in the scenario it exists for. | `PcaAppGraph` launch helpers | OPEN — needs architecture decision |
| **AND-5** | No production writer for `SchedulePolicyStore`; the only `save` calls sit in a class with zero production call sites. Combined with the offline sync port default, **no parent-authored policy of any kind can reach a device in production.** | grep-verified | OPEN — gated behind D5 crypto |
| **AND-6** | Prayer reminder subsystem is completely inert — `scheduleReminder` is never invoked from any production file, so the manifest-registered receiver can never fire. `SCHEDULE_EXACT_ALARM` is a declared Play-restricted permission with no caller. | grep-verified | OPEN |
| **AND-7** | Four fully-built user-facing composables have zero references anywhere (dead UI code). | grep-verified | OPEN — owner scope call |
| **AND-8** | Hardcoded English string in a shipped screen, breaking the en/ar bilingual requirement every neighbouring label honours. | `AdminSecurityActivity.kt:198` | OPEN — trivial |
| **AND-9** | Device tamper state never reaches the backend. The route exists and is correct; the Android relay client implements six paths and **not this one**. Detection works, alerting is stranded — the child dismisses a local notification and the parent never learns. **Not crypto-gated** — the payload is a plain enum. | route vs client grep | OPEN — repo-solvable |
| **AND-10** | Relay transport accepts any URL scheme; its sibling bootstrap client explicitly refuses non-HTTPS. Currently unexploitable (no production construction site) but must be guarded before wiring. | transport classes | OPEN — latent |

### 2.2 Backend

| ID | Defect | Status |
|---|---|---|
| **BE-1** | **CORS `ALLOWED_METHODS` omits `DELETE` and `PUT`.** Live-reproduced: DELETE→403, PUT→403, POST→204, PATCH→204. A shipped, tested safe-zone deletion route is unreachable from its only client. Masked because tests use `app.inject` (no `Origin`) and the CORS test only ever preflighted POST. | **FIXED + regression test added** |
| **BE-2** | `family_member_invitations` has no `UNIQUE(family_id, invited_email_hash)`; the duplicate-pending and seat-capacity invariants are check-then-act across **three separate transactions** with no `FOR UPDATE`. Concurrent requests can produce duplicate PENDING invitations and **seats beyond the paid entitlement**. Latent behind the crypto gate today. | OPEN |
| **BE-3** | **No graceful shutdown.** `SIGTERM`/`SIGINT` handlers only `clearInterval`; `app.close()` is never called and `closePool()` has zero callers in `src/`. Installing the handler *removes* Node's default terminate behaviour, so **SIGTERM no longer stops the process** — the orchestrator waits out its grace period then `SIGKILL`s mid-transaction. **Strictly worse than having no handler.** Fires on every deploy. | OPEN |
| **BE-4** | 40 authenticated routes have no rate limiter — the entire `/api/parent/*` surface except the five auth endpoints. The registration comment claims a limiter on "every authenticated route"; that is untrue for the parent-cookie plane. | OPEN |
| **BE-5** | The 7-day server-ciphertext TTL is enforced for relay envelopes but **not** for `family_audit_events` or `protection_alerts` — no expiry column, no purge, and no `LIMIT` on the per-request `SELECT *`. | OPEN |
| **BE-6** | `Dockerfile` sets no `NODE_ENV=production` and uses `npm` as PID 1. **Session cookies ship without `Secure`.** Every other `NODE_ENV` gate fails safe when unset; this one fails open. | OPEN — one line |
| **BE-7** | `console.error` prints the raw mysql2 error, and mysql2 attaches `err.sql` containing the **fully interpolated statement with bound values**. Billing plane only, but it is the sole unbounded log site in the production entrypoint. | OPEN |
| **BE-8** | `/health/db` is unauthenticated and unrate-limited, issuing a pooled `SELECT 1` per request against a 10-connection pool. | OPEN — one line |

### 2.3 Billing

| ID | Defect | Status |
|---|---|---|
| **BI-1** | A transiently-**FAILED** webhook is ACKed 200 and never reprocessed; redelivery hits DUPLICATE and business logic never re-runs. The code distinguishes FAILED (retryable) from IGNORED (terminal) and then treats them identically. One provider blip permanently loses a payment confirmation. Latent until a provider exists. | OPEN |
| **BI-2** | Complimentary capacity is **consumable but invisible** — the composition root never passes the service into the server builder, so the route short-circuits. A family with a grant sees `availableDeviceSlots: 0` while enrollment genuinely succeeds. Note this is the *inverse* of the long-recorded claim. | OPEN — one line |
| **BI-3** | The FREE_ACCESS gate is not bound to parent-member invitation, though the frozen contract names it in the denied set and the covering test exercises only two of three call sites. After expiry a family is correctly blocked from enrolling a device but can still add a parent member. | OPEN — mechanical |

### 2.4 Parent Web

| ID | Defect | Status |
|---|---|---|
| **PW-1** | `RealRetentionClient` wired to hardcoded-null accessors, short-circuiting before `fetch` on a premise the backend contradicts — the auth plugin explicitly accepts the session cookie **and its own doc comment names `retentionRoutes` as a consumer**. Three V1 privacy controls dead. | **FIXED** |
| **PW-2** | `RealDeviceEnrollmentClient`, identical false premise; masks the honest server 403. | **FIXED** |
| **PW-3** | Synthetic `device-${childId}` recipient id — 43 characters into a `CHAR(36)` column, so it can never resolve. Latent today, would silently defeat all policy publication the moment the crypto gate clears. | **FIXED** |

### 2.5 iOS — one defect wearing five hats

The host-app composition layer was never built. `startMonitoring` is called nowhere; nothing writes
the App Group keys the extension reads; there is no networking of any kind; the app picker is never
presented; the cited `ManagedSettingsAdapter` is dead code. **All POST_V1** under the recommended iOS
deferral — but they must not be recorded as "source complete behind external gates," because they are
not.

### 2.6 Privacy / compliance

| ID | Defect | Status |
|---|---|---|
| **PR-1** | Installed-app inventory is collected, stored, and rendered to the parent, and is declared in **no** disclosure category — falsifying the stated basis of the `PRODUCER_CATALOGUE_AUDIT_SIGNOFF` gate. | OPEN — V1 blocker |
| **PR-2** | `InstalledAppEventEntity` stores package name and app label in **plaintext**, while the sibling usage entity encrypts an identical value class and its own comment explains why. | OPEN — V1 blocker |
| **PR-3** | No parental-consent artifact exists. Registration collects email + password only — no guardianship attestation, no policy acceptance, no consent record. | OPEN — V1 blocker |
| **PR-4** | **No privacy policy document, page, or URL exists anywhere.** Play Families requires one in the listing *and* in the app. | OPEN — V1 blocker |
| **PR-5** | **No account-deletion path exists.** Delete-now deletes activity, not the account. | OPEN — V1 blocker |
| **PR-6** | Retention class enum has no member for installed-app events, so a parent's delete-now request can never address them — while the device-side engine does purge them. | OPEN |
| **PR-7** | Disclosure over-claims: crash reporting, payment processing and push-notification third parties are named in the transparency copy; none is integrated. Push routing tokens are declared in architecture and no push integration exists. | OPEN |

### 2.7 Security

| ID | Defect | Status |
|---|---|---|
| **SEC-1** | `platform-admin-web` ships **no CSP, no referrer policy, no `frame-ancestors`** — the highest-privilege console in the system, authorising refunds, settlement and admin-role grants. Parent Web has all three. | OPEN — direct port |

**What the security sweep did *not* find, and this matters:** across 173 route registration sites,
**zero** unscoped parameterised lookups (no IDOR), **zero** string-concatenated SQL, **zero** committed
secrets, **zero** SSRF sinks, **zero** open redirects, **zero** XSS sinks in app code, and mandatory
admin MFA with replay-protected TOTP. The `c3918f4` defect class was swept exhaustively across all 12
`VIEW_*` gate call sites and 28 frontend gate sites with no further instance. The authorization
architecture is genuinely strong.

---

## 3. RELEASE EVIDENCE — `EVIDENCE_REFRESH_REQUIRED = YES`

The single committed evidence pack was generated on 2026-08-13 against ancestor `fcf80e6` with a
**dirty tree**, in a since-deleted worktree. It is **442 commits and 1,296 files behind** `fa6dee2`.

- **Zero coverage of `platform-admin-web`** — the package did not exist at that commit, and the
  collector still does not include it.
- **Android recorded as `skipped: true`** — yet `RELEASE_EVIDENCE.md` publishes an Android test count
  anyway. This is the **only place in the audited corpus where a document claims executed validation
  with no supporting artifact anywhere in the repository.**
- Every count superseded: backend 956→2055, DB 159→453, parent-web 35→115 test files.
- The pack's own start/end timestamps imply a **45-second** full run, which is not credible.
- The captured gate output predates the parity validator and shows 7 of today's 34 gates.

**Mutation evidence is separately stale:** the harness pins an entry SHA 136 commits behind HEAD and
**aborts unless HEAD matches**, so `VALID_MUTATION_SURVIVORS = 0` at `fa6dee2` rests solely on a
hand-written table with no tool artifact.

**Refresh specification:** patch the collector first (add `platform-admin-web` audit + tests, add
`parent-sdk` tests), then re-run in order: SDK builds → disposable MySQL → migrate/seed → backend unit
→ backend DB → parent-web (**on a host with >4 GB free RAM — low memory produces mass phantom
failures**) → platform-admin-web → Android JVM → both real-E2E suites **with a JSON reporter committed**
→ mutation (after re-pinning) → security/repo/quality/ledger validators → full collection on a clean
tree. **Not runnable on this machine at all:** iOS build/test, iOS Family Controls, Android
instrumented tests, real-device UAT, and every external sign-off.

---

## 4. TOOLING GAPS

- **Three CI jobs were red at HEAD** — repository-quality, security, and quality.
  - **repository-quality: FIXED and verified** (`exit 1` → `exit 0`, 2,122 tracked files checked).
    The allowlist omitted five genuinely-tracked top-level paths.
  - **security and quality: STILL RED, and the original diagnosis was incomplete.** Removing the
    `.agent-runtime` violation exposed **nine further pre-existing violations** that the scripts'
    first-failure-only reporting had hidden. Seven are pure scanner false positives on fixed strings
    — including, notably, the very test that asserts no telemetry SDKs are present being flagged for
    naming them. **Two are genuine:** `seed-local.mjs` and `bootstrap-e2e-parent-account.mjs` print
    `familyId`/`accountId`, though both are dev-only scripts with a localhost DB allowlist.
    These date from 2026-08-14 onward, so **these two CI jobs have been red for weeks for reasons
    that have nothing to do with `.agent-runtime`.** Closing them requires either edits in three
    packages or a broader scanner exemption — an **owner decision**, not a mechanical fix.
    The quality job passes its own logic and fails only on the delegated security call.
- **A mutual contradiction between two gates:** the release gate's parity validator *requires*
  `.agent-runtime/` to be tracked, while the repo check *failed because* it is. No repo state
  satisfied both. **Resolved in the only direction that keeps the release gate working.**
- **The scripts report only their first failure** (`Write-Error` under `$ErrorActionPreference='Stop'`),
  which is why a single visible error concealed nine more. Worth fixing on its own merits.
- **CI runs no JavaScript/TypeScript unit suite at all** — no backend tests, no vitest for either web
  app, no `parent-sdk`, and one of four contracts tests. **2,055 backend and ~150 web tests never gate
  a PR.** This is the largest remaining CI gap and is an owner cost/latency decision.
- **The dependency audit excludes `parent-web`** — the largest dependency tree in the repo and the
  only production dep on a floating version range.
- **No validator covers `EXTERNAL_GATE_MATRIX.md`**, which is why it sits 27 gates behind while
  claiming to be generated.
- **The sensitive-logging scanner does not match `console.*`** — the only logging mechanism actually
  used in the backend and both web apps.
- Four privacy static-scan tests use `assumeTrue` on directory resolution, so a wrong working
  directory **silently skips** the strongest no-URL/no-TLS-MITM guards rather than failing.
- 33 test assets are unreachable from any runner (qa-r2 specs, qaB configs, contracts sub-catalogues,
  `parent-sdk` tests).
- **`.agent-runtime/worktrees/` holds ~50 full second checkouts of the repo inside the repo tree.**
  Four independent audit lanes tripped over this: a repo-wide `find`/`grep` traverses them, times
  out, and returns duplicate hits **at wrong line numbers** (one copy has the Android architecture
  doc's decision rows at lines 123-124 rather than the canonical 125-126). An auditor who cites a
  worktree path produces unverifiable evidence. **Scope searches with `git ls-files`, not raw
  recursive traversal.** Note these paths are simultaneously *required* to be tracked by the release
  gate's parity validator — so the fix is curation, not deletion.

---

## 5. REAL-DEVICE UAT

`REAL_UAT = NOT_EXECUTED`. **50 cases defined, 0 logged, 0 passed, 0 failed.** The execution log is an
untouched scaffold. No document anywhere falsely claims otherwise — the honesty here is exemplary.

- **20 of 50** are pre-blocked by the crypto review before any device is touched.
- **6 of 50** are blocked *or redefined* by an unmade owner decision — under different provisioning
  answers they test different things.
- **30 of 50** are executable the day Android hardware arrives, independent of the crypto gate.
- **0 of 50 are iOS-scoped.** iOS validation lives in a separate 44-item checklist with 0 checked and
  **no machine-readable log**, so no gate script can ever see its state.
- **The 50-case plan has no cases at all for platform-admin, billing, settlement, or commercial** —
  all built after the plan was written. The `totalCasesInPlan: 50` figure therefore *understates* real
  V1 UAT scope.
- The plan carries no per-case priority column, so the gate is all-or-nothing across 50 cases.

**Device matrix required:** Android API 26 floor and API 35 target (from `build.gradle.kts`, not
prose), a mid-band API 33/34 device for the permission-prompt boundaries, an aggressive-battery OEM
device, a camera and a camera-less pair, an active SIM plus a second handset, and — only under a
managed-provisioning decision — a factory-reset device-owner-capable handset. iOS would need physical
iPhone **and** iPad on 17.0+.

---

## 6. PRODUCTION INFRASTRUCTURE

`PRODUCTION_INFRA_STATUS = PRODUCTION_INFRA_REQUIRED`.

**Genuinely strong in source:** DST and timezone handling (both runtimes delegate to the platform tz
database, throw on unknown zones, and share cross-runtime conformance vectors); privacy-by-absence
logging (proven by both a source-text regression assert and empirical stdout capture); and the single
background scheduler, which is **provably multi-instance-safe** via database unique constraints rather
than in-process locks.

**Required and absent:** deployment topology, log shipping, metrics pipeline, alert delivery, CD,
rollback (the drill record is entirely unfilled and migrations are forward-only with no advisory lock),
TLS termination, HSTS, security headers, and shared-store rate limiting.

**No external gate exists for database backup or restore.** All 34 gates were enumerated; none covers
it, and there is zero repo evidence of backup tooling, a restore runbook, or a restore test. *An
untested restore is not a backup — here there is neither.* This is the single largest untracked
production risk and is why `DATABASE_BACKUP_RESTORE` is proposed as a new gate.

---

## 7. `PCASAFE.COM` — RECORDED MODEL ONLY, NO INTEGRATION PERFORMED

No DNS, Azure, or hosting action was taken, and none is proposed before the owner decides.
`pcasafe.com` appears **nowhere in the repo** — this document is the first record of the model.

**The finding that matters, established before any DNS exists:** a true `app.pcasafe.com` ⇄
`api.pcasafe.com` split **would break every Parent Web mutation.** The session cookie survives (same
registrable domain, `SameSite=Strict`), but the CSRF cookie is **host-only** and is read via
`document.cookie` by 13 client modules. From `app.` they structurally cannot read a cookie scoped to
`api.`, so every mutation would return `403 csrf_mismatch`. **Login would succeed and every write would
fail — a failure that looks like a permissions bug, not a domain bug.**

**Single-origin behind a reverse proxy requires zero source change** and matches the posture Platform
Admin already assumes. A true split requires a `Domain=pcasafe.com` cookie change plus a security
review of widening cookie scope.

**This is an unconsidered design gap, not a violation of a stated requirement.** The governing
requirement `PCA-ADD-IDENT-012` specifies the session transport as *"HttpOnly, Secure-in-production,
SameSite=Strict cookie … double-submit CSRF"* — with **no cookie `Domain` and no cross-subdomain
consideration anywhere in its text**. The split-origin case was never in scope when the transport was
designed, which is why the source is not wrong today and why this is an owner decision rather than a
defect. It is also why it would surface only at DNS cutover, long after the design was settled.

**The domain/DNS step is untracked in *two* independent gate registries** — neither
`external_gate_matrix.json` (33 gates) nor the second tracked register under `.agent-runtime/`
(113 rows, the same 33 gate IDs) contains any DNS, domain, or hosting gate. That independent
corroboration is why `DOMAIN_DNS_HOSTING` is proposed as a new registration rather than assumed to
exist somewhere unexamined.

Also required before any cutover: five mobile hostname literals have **no configuration seam** at all
(they are hardcoded in Kotlin, the Android manifest, Swift, and an entitlements plist), and the
enrollment link host is a fifth hostname not in the four-name model.

---

## 8. DOCUMENTATION STALENESS

**33 edit-ready findings** across 16 current-state documents, with verbatim stale quotes and proposed
replacement text recorded in the audit lanes. The dominant pattern is **staleness, not fabrication** —
with one exception, noted in §3, where a document publishes a test result its own cited evidence pack
records as never run.

Highest-value corrections: the four-way external-gate count disagreement (7 vs 14 vs 33 vs 34); the
`371` vs `375` requirement count (**375 is correct**); the status distribution in the current-status
document (which predates ~150 status changes); 30 traceability rows that contradict the matrix; and
the decision-ID namespace collision described in the owner-decisions document.

**Historical documents were deliberately left alone.** A dated mission report is not stale merely
because the code moved on.
