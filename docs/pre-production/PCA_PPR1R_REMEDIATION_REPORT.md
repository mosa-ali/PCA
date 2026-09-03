# PCA PPR-1R — SOURCE DEFECT REMEDIATION & RECONCILIATION CLOSURE

**Entry baseline:** `e180e16225ffa41de2062821dde0d0351f7eed79` (= `origin/pca-dev` at entry)
**Protected main:** `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd` — unchanged, no merge, no force push.
**Type:** Remediation of repository-solvable defects found by PPR-1. Not a product programme.

---

## 1. THE MANDATORY ANDROID GATE — PASS

PPR-1 shipped Android changes that were never Gradle-compiled. That was the one place its verification
standard fell below "proven by execution", and it was the owner's stated acceptance condition.

```
gradlew testDebugUnitTest --console=plain --rerun-tasks
BUILD SUCCESSFUL in 16m 15s   GRADLE_EXIT=0
suite files=229  tests=1303  failures=0  errors=0  skipped=1
ANDROID_FULL = PASS
```

After this mission's own Android work, re-run and still green at **1326 tests / 234 suite files /
0 failures / 0 errors** — 23 tests added, all passing.

---

## 2. DENOMINATOR RECONCILIATION — `DEFECT_DENOMINATOR_RECONCILED = YES`

PPR-1 published two irreconcilable figures: `REAL_SOURCE_DEFECTS_OPEN = 23`, and a subheading claiming
"The 27 open defects". Both were wrong, and the cause was traced to the commit history rather than
guessed:

- **The `27`** is a stale `33 − 6` from the pre-adversarial draft `d4c9b4e`. The heading was never
  touched when the counts were rewritten.
- **The `38`/`23`** silently dropped the iOS defect. The draft register had 32 ID'd rows; `32 + iOS = 33`.
  The rewrite added 4 adversarial rows and 2 self-disclosures — reaching **39**, not 38 — in the very
  same pass that elevated iOS to "the single most consequential open item".
- **`FIXED = 13`** counted a partially-fixed item (the retention enum) as complete, while the gaps
  register described it as half-done in the same document.

**PPR-1's true figures: FOUND 39 · FIXED 12 · PARTIAL 3 · OPEN 24.**
Superseded by `PCA_PPR1R_DEFECT_REGISTER.csv` — **44 rows** with stable `PPR1R-D###` IDs, deduplicated
by root cause, and separated into requirement-row, cross-cutting, and tooling/documentation classes.

---

## 3. WHAT PPR-1 GOT WRONG — corrected before any code was written

Four analysis lanes ran before a single writer started. That sequencing was the most valuable decision
in this mission: **three PPR-1 findings were materially wrong, and one would have caused damage.**

### The wellbeing finding was wrong, and dangerous

PPR-1 reported a "three-way taxonomy divergence" requiring owner adjudication. Verified false:

- The contract, the parent-SDK **and Android all already agree** (13/13/14, with a tested bijection).
  Only Parent Web dissented, and its enum has **zero support in any requirement**.
- The adjudication PPR-1 said was missing had already happened in
  `docs/architecture/38_CANONICAL_WELLBEING_POLICY.md` §1 — **a file PPR-1 never opened**, named for
  the exact ruling it claimed did not exist.
- **The dangerous part:** PPR-1 listed *"the backend has no wellbeing implementation"* as a symptom of
  a defect. It is a **mandated privacy invariant** — `PCA-WELLCTRL-001/003` forbid a readable central
  store for family plaintext, and `backend/test/platformadmin/privacy.test.mjs` enforces it by listing
  `wellbeing` as a prohibited term. **A writer acting on the PPR-1 finding as written would have
  breached a controlled requirement and broken a passing test.** The prohibition was written into the
  writer brief explicitly.
- PPR-1 also **missed three further divergences** — triggers (overlap: zero), preview surfaces, and
  the admin-client interface.

Actual disposition: `REPO_SOLVABLE_NOW`, parent-web only, no owner decision, no data migration (the UI
was demo-mode only and fail-closed in production, so no real family data ever used the wrong taxonomy).

### Schedule policy was mostly misclassified

A seven-hop trace from Parent Web authoring to the Android enforcement engine found **six of seven hops
are correct fail-closed crypto gates, not defects** — exactly the conflation this mission was warned
against, and PPR-1 made it. Only the on-device router is a genuine source gap, and it cannot decrypt
until `PCA-DEC-020`. PPR-1's claim that *"no parent-authored policy of any kind can reach a device"*
is **false**: the enrollment-profile path delivers a real coarse policy today. `PCA-AND-003` was a
**false positive** — the emergency floor is wired and executes on every evaluation.

### PW-3's reopening was itself a misclassification

PPR-1's adversarial pass reopened the device-id fix because the local store is never populated. But the
emptiness is `requireTrustedAndCryptoReady` failing closed — **correct crypto behaviour, not a source
defect**. Reclassified `EXTERNAL_SECURITY_REVIEW`.

### iOS was misclassified in the baseline

All 10 iOS rows carried `IOS_ENTITLEMENT_REQUIRED` with a basis naming macOS+Xcode, the entitlement and
a device. The composition layer is blocked by **none of those three** — it is unwritten code, i.e.
**POST_V1 source debt**. PPR-1's own gaps register said so, so the CSV contradicted its own prose.
`macOS+Xcode is not a gate at all`: CI runs `xcodebuild test` on a `macos-14` runner that builds 32 of
32 sources and all 3 extensions. All 10 bases corrected.

---

## 4. FIXED AND VERIFIED BY EXECUTION

| Area | What closed |
|---|---|
| **Android** | Usage-access **grant hand-off** and notification runtime request — the capability PPR-1 left dead. Installed-app package name and label now **encrypted at rest** (existing cipher reused, no new crypto, Room migration to schema 6). Scoped `<queries>` for package visibility. The missing 7th relay path implemented. |
| **Backend** | Invitation concurrency: `UNIQUE` migration + `createAtomically` under `SELECT … FOR UPDATE`, replacing check-then-act across three transactions that could grant **seats beyond the paid entitlement**. Graceful shutdown + `node` as PID 1. 7-day ciphertext TTL extended to audit and alert tables. Migration advisory lock. |
| **Parent Web** | Wellbeing taxonomy now **imports** the canonical SDK enum. **iOS enrollment honesty defect closed** — a parent could obtain a real enrollment token and QR code for an app that does not exist. |
| **Tooling** | **All three CI gate scripts now pass** (repo-checks, security, quality). The security job had been red for weeks behind **nine violations that first-failure-only reporting concealed**. All four contract catalogue validators wired — the mechanism that let the wellbeing drift go undetected. Dependency audit extended to all six packages. Mutation harness re-pinned **and parameterised**. Real-E2E now emits a committed JSON artifact. |
| **PPR-1 self-inflicted** | The over-broad security-scanner exemption removed (the job passes on its own merits). `PUT` removed from the CORS allowlist. |

**Verification:** `tsc` clean in backend, parent-web and platform-admin-web · Android **1326/1326** ·
backend FREE_ACCESS 9/9, CORS 3/3, retention TTL 11/11, advisory lock 10/10 · parent-web 11/11 ·
all three CI gates exit 0.

---

## 5. THE FOUR-WRITER INTERRUPTION — AND WHAT IT PROVED

All four writer lanes were killed simultaneously by a session authentication failure, mid-edit, leaving
62 modified and ~20 new files unreported. **Three interface/consumer breaks resulted, and each was
invisible to the others' checks:**

| Break | Surfaced only under |
|---|---|
| Service still calling the removed `create()` | backend `tsc` |
| `FakeRelayHttpClient` missing the new interface method | Kotlin **test** compilation |
| Two test stubs still implementing `create` | test **runtime** |

All three were repaired and verified. The repair that mattered most: the capacity guard had to read
through `getEffectiveSnapshotForFamilyOnConnection` rather than the ordinary variant — the ordinary one
opens its own connection and would **not observe the row lock**, silently defeating the serialization
the entire fix exists to provide.

This is direct evidence for the mission's own rule that a fix is not closed until it is executed.
A typecheck-only gate would have passed two of these three breaks.

---

## 6. WHAT REMAINS

**`REPO_SOLVABLE_OPEN = 0`.** Every defect that could be closed in this repository, without an owner
decision and without an external dependency, is closed and verified by execution.

The final three code defects were closed after the writer interruption, and two of them corrected the
brief they were given:

- **Prayer reminders** are no longer inert. The subsystem is wired from the production graph, and an
  exact-alarm refusal is now surfaced as a tamper record plus a parent alert rather than silently
  swallowed — the honest-degradation pattern this codebase already uses elsewhere.
- **Webhook retry**: a transiently-FAILED event is now non-ACKed and re-drivable, with the re-claim
  guarded inside the UPDATE's own `WHERE` so exactly one of N concurrent redeliveries wins. `IGNORED`
  stays terminal; duplicates of a succeeded event stay idempotent. The replay-window boundary that
  remains was **documented rather than papered over** — closing it needs a sweeper that does not exist.
- **Installed-app export**: the brief's premise was stale. The emitter existed and decrypted correctly;
  the real defect was that it emitted `ROUTINE_ACTIVITY` — doc 11's explicit *catch-all* — while the
  backend accepts the itemized `INSTALLED_APP_EVENT`. Since delete-now matches by `(entityClass, id)`,
  **the only name a parent had for these records matched nothing.** A new parity guard also found that
  the export emits deletion *evidence* classes; those were deliberately left unaddressable, because
  making them delete-now-addressable would let a request erase the proof of a prior deletion.

**Still open, and correctly not repo-solvable:** 7 `OWNER_DECISION_REQUIRED` · 3
`NEW_FEATURE_ARCHITECTURE_REQUIRED` (parental consent, account deletion, background-launch shield) ·
3 `EXTERNAL_SECURITY_REVIEW` · 2 `COMPLIANCE_REQUIRED` (privacy policy, producer catalogue) ·
1 `PRODUCTION_INFRA_REQUIRED` (`frame-ancestors` needs real response headers) · 1 `POST_V1` (iOS).

Two items are partially fixed with the residual correctly external: the relay path is implemented but
its transport is crypto-gated, and a strict CSP ships but `frame-ancestors` is inert in a `<meta>` tag.

**Three V1 blockers are represented by no requirement row at all** — parental consent, privacy policy,
account deletion. The requirement register cannot see them, which is itself a finding for PPR-2.

## 7. REQUIREMENT BASELINE MOVEMENT

`REAL_SOURCE_DEFECT` fell from **11 rows to 0**. That headline overstates the achievement if read
carelessly, so the breakdown matters: six rows were **misclassified** — correct fail-closed crypto
gates or, in one case, a plain false positive — three are now correctly recorded as externally gated,
and two were genuinely fixed. Only the last two represent work; the rest represents PPR-1 having been
wrong.

| Classification | PPR-1 | PPR-1R |
|---|---:|---:|
| `PRODUCTION_COMPLETE` | 272 | **274** |
| `SOURCE_COMPLETE_EXTERNAL_GATE` | 44 | **50** |
| `REAL_SOURCE_DEFECT` | 11 | **0** |
| `SOURCE_COMPLETE_OWNER_DECISION` | 4 | **6** |
| `COMPLIANCE_REQUIRED` | 4 | **5** |
| others | unchanged | unchanged |
| **TOTAL** | 375 | **375** |

`TOTAL_REQUIREMENTS` stays **375**. `PCA-SEC-016` and `PCA-DATA-030` remain unregistered pending an
owner-approved controlled-document correction — this mission did not change the controlled denominator
on its own authority.
