# PCA External Readiness & Release Evidence Report

Date: 2026-09-07. Phase: external readiness, production evidence and
release-gate execution against the accepted W3 implementation baseline.

This is **not** a new implementation wave and does not reopen, rewrite or
supersede any W1/W2/W3 closure report. It re-establishes repository truth,
executes the release-control system, and reports what actually prevents each
release target from becoming READY.

Every number below was produced by running the thing, in this session, on this
tip. Where something was only read and not executed, it says so.

---

## 1. Repository truth

```
BRANCH                 = pca-dev
HEAD                   = 3b1e39fa4932585cd1c6c5e7df98fde0ef731dfe
HEAD_AT_SESSION_START  = d59445095ea7498d5125ddfb9bf35eb954d5ec31  (as expected)
ORIGIN_PCA_DEV         = 3b1e39fa4932585cd1c6c5e7df98fde0ef731dfe  (verified after push)
ORIGIN_MAIN            = f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd  (UNTOUCHED)
WORKTREE_AT_START      = clean
STASH                  = 1 entry, pre-existing, NOT dropped, NOT applied
```

`origin/main` was never modified, never rebased, never force-pushed. No
`.agent-runtime/` worktree was cleaned; the 30+ agent-lane branches are
untouched.

**CI baseline for the session-start tip `d594450`** (GitHub Actions REST API,
run `34056556721`): **21/22 SUCCESS**. The single failure is
`iOS build and unit tests`. This independently confirms the W3 closure claim on
the actual tip, not merely on the SHA W3 cited.

**CI for this session's own final tip `3b1e39f`** (run 34097745170):
**21/22 SUCCESS**, `iOS build and unit tests` the only failure — back to the
known-good baseline. Three commits were made this session (§14); the Android job
went green→red→green across them, and §14 D-4 explains exactly why, with the
failing test named.

---

## 2. W3 baseline verification

Verified independently, not accepted on the report's word:

| W3 claim | How verified here | Result |
|---|---|---|
| 21/22 CI green, iOS the only red | GitHub Actions REST API, run `34056556721` | CONFIRMED |
| iOS root cause is a deterministic `TEST_HOST`/scheme error | Fetched the job's own annotations | CONFIRMED, byte-identical text |
| Crypto is fail-closed with no bypass | `grep` for every `*SignatureVerifier` implementation | CONFIRMED — only `Rejecting*` exists |
| `EmailService` is the sole production sending boundary | Import graph of `EmailProviderAdapter` | CONFIRMED |
| No fake/sandbox email provider exists | Repo-wide search for fake/mock/sandbox provider classes | CONFIRMED — zero hits |
| Privacy invariants at zero | Ran `backend/test/schema-privacy.test.mjs` | CONFIRMED — 30/30 pass |
| Release-gate conformance intact | Ran `Test-ReleaseGateScoping.mjs` | CONFIRMED — ALL PASS (0 failures) |
| `ChildRequestService` residual P2 oracle | Read `cancel()`/`acknowledgeApplied()` + HTTP mapping | CONFIRMED as described (see §13) |
| Billing names no provider | Repo-wide search for payment SDKs | CONFIRMED — zero SDK imports |

`WAVE_1 = ACCEPTED`, `WAVE_2 = ACCEPTED`, `WAVE_3 = ACCEPTED/CLOSED`,
`P0_OPEN = 0`, `P1_OPEN = 0` — **no divergence from the stated baseline was
found.** Two defects were found in areas W3 did not cover; see §14.

---

## 3. Release-target readiness matrix

All six verdicts below are the release gate's own output, executed this session
(`Invoke-ReleaseGateCheck.ps1 -ReleaseTarget <T>`, exit 1 on every target).

| TARGET | CODE | EXTERNAL | REAL UAT | SECURITY | PRODUCTION | RELEASE GATE | BLOCKER | REQUIRED EVIDENCE | OWNER / INPUT |
|---|---|---|---|---|---|---|---|---|---|
| **PUBLIC_A** | READY | 3 gates open | 0 of 0 cases (plan has none) | n/a (no auth surface) | NOT DEPLOYED | **NOT READY** | Owner visual UAT; public reply identity; TLS termination; legal identity | Owner sign-off; Send-As working; host serving the 8 required headers; OD-13 legal facts | Product/design owner; Platform ops; Legal |
| **AUTH_B** | READY | 2 gates open | 0 of 4 cases | n/a for base | NOT CONFIGURED | **NOT READY** | `PRODUCTION_EMAIL_DELIVERY`; TLS termination | Real provider + credentials; delivered verification & reset mail; SPF/DKIM/DMARC | Email provider owner; Platform ops |
| **PARENT_C** | READY | 7 gates open | 0 of 22 cases | crypto review absent | NOT DEPLOYED | **NOT READY** | Production crypto suite (×4 gates); email delivery; producer-catalogue sign-off; TLS | Human security review; provider proof; compliance sign-off | Security reviewer; Email owner; Compliance |
| **ANDROID_D** | READY | 16 gates open | 0 of 43 cases | crypto review absent | **no release build config** | **NOT READY** | Real-device UAT (×6 device gates); crypto; provisioning decision; app-link hosting | Physical-device execution; signing/keystore; assetlinks hosting | Android device owner/QA; Security; Product |
| **IOS_FUTURE** | **NOT BUILDING** | 9 gates open | 0 of 0 cases (no functionality to UAT) | crypto review absent | n/a | **NOT READY** | Xcode project/scheme `TEST_HOST` failure; Family Controls entitlement; device | Real Xcode; entitlement grant; physical device | iOS build owner; Apple account holder |
| **BILLING_FUTURE** | SOURCE READY | 7 gates open | 0 of 0 cases (no flow to UAT) | n/a | no provider | **NOT READY** | Provider selection, merchant account, settlement, certification | Provider decision; sandbox proof; go-live certification | Commercial/finance owner |

**Classifications:**

```
PUBLIC_A        = LEGAL_NOT_AUTHORIZED           (also owner-UAT and reply-identity blocked)
AUTH_B          = CODE_READY_EXTERNAL_BLOCKED
PARENT_C        = SECURITY_REVIEW_BLOCKED        (also CODE_READY_EXTERNAL_BLOCKED on email)
ANDROID_D       = CODE_READY_UAT_BLOCKED         (also SECURITY_REVIEW_BLOCKED)
IOS_FUTURE      = REAL_XCODE_BLOCKED
BILLING_FUTURE  = PROVIDER_BLOCKED
LIVE_DATABASE   = LIVE_DB_NOT_AUTHORIZED
```

### A structural finding the owner must decide

`PUBLIC_A`, `IOS_FUTURE` and `BILLING_FUTURE` each have **zero** UAT cases
mapped, so the gate returns `UAT_PLAN_INCOMPLETE_FOR_TARGET` and hard-blocks
them. This is deliberate and documented — `ValidateFableScopeParity.mjs`
acknowledges it in prose, reasoning that a static site, an unbuilt iOS app and
an unselected payment provider have nothing a device-UAT plan could genuinely
exercise, and that Release A's human sign-off correctly lives in
`OWNER_VISUAL_UAT` instead.

The consequence is nonetheless real and should be an explicit decision:
**`PUBLIC_A` can never reach `READY` through the current script**, even after
`OWNER_VISUAL_UAT`, `PUBLIC_REPLY_IDENTITY` and TLS all close, because its
`REAL_UAT` term is structurally unsatisfiable. The owner must choose one:

1. author real `UAT-PUB-*` cases for the public site and map them; or
2. change the gate so `PUBLIC_A`'s `REAL_UAT` is satisfied by `OWNER_VISUAL_UAT`.

**This was deliberately not changed here.** Either option edits release-control
semantics, and this phase's mandate is explicitly not to weaken a gate to obtain
`READY`.

---

## 4. AUTH_B detailed readiness

**Architecture (inspected, not exercised against a provider):**

- `EmailService` is the **sole** production sending boundary. Provider adapters
  are imported only by `emailProviderConfig.ts`, `EmailOutboxProcessor.ts`,
  `emailHealth.ts`, `EmailService.ts`, `main.ts` and `buildServer.ts`; no route,
  service or job reaches a provider directly. Confirmed: zero `nodemailer` or
  Graph `sendMail` usage anywhere outside `email/providers/`.
- **Durable outbox**: `EmailOutboxRepository` with `PENDING | SENT | DEAD_LETTER`,
  a MySQL-backed implementation, AES-256-GCM encryption at rest via
  HKDF-derived keys, bounded retry with backoff, and dead-lettering that
  **purges the ciphertext** so no exhausted row keeps recoverable content.
- **Fail-closed**: with `PCA_EMAIL_PROVIDER` unset, `resolveEmailProviderAdapter()`
  returns `RejectingEmailProviderAdapter`, which refuses rather than fabricating
  success. In a production-sensitive runtime it **throws at boot** instead of
  quietly rejecting — the stronger and correct behaviour.
- **No fake provider exists.** Repository-wide search for fake/stub/mock/sandbox
  email provider classes and for Ethereal/Mailtrap/MailDev: **zero hits**. Only
  SMTP, Microsoft Graph and Rejecting adapters exist.
- **No fabricated credentials.** No provider credentials are present in the
  repository.
- **Rate limiting** is wired on `register`, `verify-email` and
  `request-password-reset`, dual-keyed per source IP and per *hashed* email.

```
AUTH_B_CODE_PATH_READY        = YES
AUTH_B_EMAIL_ARCHITECTURE     = READY (fail-closed, no provider configured)
PRODUCTION_EMAIL_CONFIGURED   = NO
PRODUCTION_EMAIL_DELIVERY_PROVEN = NO
AUTH_B_REAL_UAT_READY         = NO   (0 of 4 planned cases executed)
AUTH_B_RELEASE_READY          = NO
```

**No real-provider validation was executed**, because no provider credentials or
environment exist in this session. Nothing was configured, no account created,
no provider contacted. Classification: **`CODE_READY_EXTERNAL_BLOCKED`**.

### Exact evidence required to close AUTH_B

| # | Evidence | Acceptance |
|---|---|---|
| 1 | Approved provider named and `PCA_EMAIL_PROVIDER` set to `SMTP` or `MICROSOFT_GRAPH` | Boot succeeds without the config error; `emailHealth` reports the real adapter, never `Rejecting` |
| 2 | Verification email delivered | Message received in a **real** inbox from the production sender; account reaches `VERIFIED` via the received code/link |
| 3 | Password-reset email delivered | Real inbox receipt; redemption sets a new password; **old** password then fails |
| 4 | Session/cookie behaviour | Login issues a working session; logout invalidates it such that the prior cookie authenticates nothing; fresh login works |
| 5 | Rate limiting | Register/verify/reset each rejected past budget, per IP **and** per email, on the deployed instance |
| 6 | Sender identity | SPF, DKIM and DMARC all pass at a third-party receiver, from the production sender domain |
| 7 | No sandbox in production | Deployed config proven to name no test/sandbox adapter |
| 8 | Production-sensitive runtime | Boot with the production flag and no provider **fails closed** — verify this in the deployed environment, not only in a test |

These map exactly onto the four planned cases `UAT-AUTH-01…04`, which are
already correctly scoped to `AUTH_B` in the gate's case map. Items 5–8 are
production-runtime evidence the four cases do not cover on their own.

**Production-configuration caveat (disclosed, not a defect):** the auth rate
limiter is **in-process**. Its own header comment documents the multi-instance
caveat. If the App Service scales past one instance the effective limit
multiplies by instance count. Either pin the instance count or move to a shared
store before relying on these limits in production.

### AUTH_B real UAT

The four planned cases are correct and specific (they already require a *real*
inbox and explicitly forbid a sandbox sender). **None has been executed**;
`uat_execution_log.json` is `NOT_EXECUTED` with `cases: []`. No automated test
was counted as UAT, and no case was logged. Execution requires item 1 above
first — a real provider must exist before a real delivery can be observed.

---

## 5. Public Release A readiness

Verified by **real browser execution** this session (Playwright probes against a
locally served production build of `public-web`), not by reading source.

**Requested invariants — all verified:**

```
PUBLIC_LOGIN_VISIBLE          = NO      (probe: no login/sign-in/sign-up/create-account control anywhere)
PUBLIC_SIGNUP_VISIBLE         = NO      (same probe)
DOWNLOAD_ACTION_VISIBLE       = YES     (52 download actions, all targeting /download/)
DOWNLOAD_AVAILABILITY_HONEST  = PASS
FAKE_STORE_BADGES             = 0
FAKE_DOWNLOAD_LINKS           = 0       (no store badge, no store URL, no .apk/.ipa/.aab)
```

`RELEASE_A_REPO_CRITICAL_FINDINGS = 0`, `RELEASE_A_REPO_HIGH_FINDINGS = 0`.

**Also verified by execution:**

| Item | Result |
|---|---|
| EN/AR parity | 193 keys each; drift probes balanced (6/6, 6/6, 20/20) |
| Video placeholders honest | Both are placeholders — no player, no media file, no invitation to watch |
| No false child-app availability | iOS, AI and YouTube each stated as later; no app download invited |
| Accessibility | axe WCAG 2.1 A+AA: **0 violations** across 16 page runs; 0 controls without visible focus; 320px reflow clean |
| Layout | 16 routes × 8 widths = 128 checks, **0 problems** (the 4 step-card height problems in the stale committed report no longer reproduce) |
| Legal drafts | `/privacy-policy/` and `/terms/` `noindex, nofollow` in both locales and absent from the sitemap |
| Contact page | No email address and no `mailto:` anywhere in the artifact |
| External requests | Zero off-origin references, zero runtime network calls |
| Reproducibility | Two consecutive builds byte-identical, `sha256 9258f809…89ad69` |
| Security headers | All 8 required headers served (the dev server proves the policy; the **host** must serve them) |

**Blocked, and correctly so:**

```
LEGAL_PUBLICATION   = NOT_AUTHORIZED   (OD-13 unresolved: no legal entity, jurisdiction,
                                        controller or effective date exists to publish)
CONTACT_CHANNEL     = PARTIAL          (all 4 aliases inbound-verified PASS;
                                        PUBLIC_REPLY_IDENTITY = NOT_READY — owner configuring Send As)
OWNER_VISUAL_UAT    = BLOCKED          (human owner has not signed off on the published site)
```

No legal fact was invented. No contact identity was assumed.

**Native Arabic review — this is where the two defects were found.**
`OD_12 = AWAITING_OWNER_SIGNOFF`, 193 keys pending, and the sheet the owner
signs against **could not be produced at all** until this session. See §14.

---

## 6. Android readiness

**CI (real, final tip `3b1e39f`):** `Android build, lint, and unit tests` =
**SUCCESS**.

Getting there produced a genuine finding. The job failed on two consecutive
commits of mine that touch **zero** Android files. W3 had attributed an earlier
Android failure to transient runner contention; that reading turns out to have
been too generous. The real cause was a **racy unit test**, invisible because the
diagnostic wrapper could not name it (§14 D-3), and now fixed and confirmed
green (§14 D-4). Had the wrapper been able to name it in W3, it would have been
caught a wave earlier.

**Runtime privacy architecture:** `VpnEnforcementPolicy.kt` exists and is wired
into `VpnEnforcementController`/`PcaAppGraph`, so VPN/DNS dormancy is an explicit
gate rather than "no caller yet". `THIRD_PARTY_DNS_DEFAULT = NONE` and
`VPN_RUNTIME_DEFAULT = DORMANT` hold.

**Release configuration — a concrete gap, evidence-backed:**

```
android/app/build.gradle.kts buildTypes = { debug { … } }   -- there is NO release block
signingConfig / storeFile / keyAlias        = ABSENT repository-wide (zero hits)
CI build command                            = ./gradlew lint test assembleDebug
ANDROID_RELEASE_BUILD_EVER_PRODUCED         = NO (not locally, not in CI, anywhere)
```

No release build variant is configured, no signing config exists, and CI has
never built one. `proguard-rules.pro` exists but is not wired to any build type.
**This was reported, not fixed** — creating a signing config requires a keystore
that does not exist and must not be fabricated, and ANDROID_D is already blocked
by 16 owner gates, so inventing one would not advance the target.

**Register observation:** the external gate matrix has no token covering release
signing/build configuration. `ANDROID_PHYSICAL_INSTALL_CONTINUATION` mentions a
"production distribution path", which arguably covers it. Whether to split out an
explicit `ANDROID_RELEASE_SIGNING_CONFIG` gate is an owner decision — it is
recommended, because W1 treated exactly this class (a real dependency no tooling
could surface) as a defect worth fixing.

### Exact physical-device UAT cases

**43 planned cases** are already mapped to `ANDROID_D` and are correctly scoped:
enrollment (`UAT-ENR-01…04`), lifecycle (`UAT-LIFE-01…05`), screen time
(`UAT-ST-01…05`), break shield (`UAT-BRK-01…03`), schedule (`UAT-SCH-01…03`),
app control (`UAT-APP-01…03`), location (`UAT-LOC-01…03`), web
(`UAT-WEB-01…04`), eye protection, prayer, wellbeing, network (`UAT-NET-01…04`),
recovery, tamper and i18n. The catalogue does not need authoring — it needs
running.

**None executed.** `deviceMatrixPopulated: false`, `casesLogged: 0`.
No emulator or CI result was counted as physical-device evidence.

```
ANDROID_REAL_UAT = NOT_EXECUTED
```

Classification: **`CODE_READY_UAT_BLOCKED`** (compounded by
`SECURITY_REVIEW_BLOCKED` on the crypto gates).

---

## 7. iOS readiness

**Current source state verified.** The failure re-confirmed on this tip from the
job's own annotations, byte-identical to W3's record:

```
xcodebuild: error: Failed to build project PCA with scheme PCA.:
Could not find test host for PCATests: TEST_HOST evaluates to
".../Build/Products/Debug-iphonesimulator/PCA.app/PCA"
```

Deterministic and reproducible across three pushes. Not flaky.

**Refinement from source inspection this session** (inspection only — no Xcode
was available, nothing was built):

- `TEST_HOST = $(BUILT_PRODUCTS_DIR)/PCA.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/PCA`.
  On iOS `BUNDLE_EXECUTABLE_FOLDER_PATH` is legitimately empty, so
  `PCA.app/PCA` is the **correct** iOS path. The evaluated string in the error is
  not itself wrong.
- The `PCATests → PCA` target dependency **does** exist
  (`A10000000000000000000801`), and the scheme's `BuildActionEntries` has
  `PCA.app` with `buildForTesting="YES"`.

So the fault is more likely that `PCA.app` is not present when the test host is
resolved — plausibly the app target's own build or its three app-extension
embeddings — rather than the missing test-host dependency previously suspected.
**This is a hypothesis from reading the project file, not a diagnosis**, and it
narrows where to look; it does not identify the bug.

**No source-only fix is justified.** Editing `.pbxproj`/scheme internals without
Xcode to open, validate and re-save the result is exactly the blind change this
phase forbids. No Swift file, project file or scheme was touched.

Classification: **`REAL_XCODE_BLOCKED`**.

---

## 8. Billing readiness

- Zero payment-provider SDKs anywhere: repository-wide search for Stripe,
  PayPal, Adyen, Checkout.com, Braintree, Square, Tap, HyperPay and PayFort
  returns **only comments** in `providerContract.ts` stating that no SDK is
  imported and naming where an adapter *would* go.
- **No provider is represented as configured.** Nothing was activated or
  fabricated.
- Seven gates open, covering the full commercial chain: provider selection,
  merchant account, settlement bank, charge currencies, settlement currencies,
  production certification, plus TLS.

**Exact decision required:** name the production payment provider. Everything
else is downstream of it.

**Sandbox/UAT evidence required afterwards:** a sandbox transaction proving
authorize→capture; a refund; a webhook signature verified against the real
provider's key; settlement currency and charge currency confirmed by finance;
then live (non-sandbox) certification as its own separate step —
`PAYMENT_PROVIDER_SELECTION` and `PAYMENT_PRODUCTION_CERTIFICATION` are correctly
distinct gates and must not be collapsed.

```
BILLING_SOURCE_READY = YES    BILLING_PRODUCTION_READY = NO
```

Classification: **`PROVIDER_BLOCKED`**.

---

## 9. Crypto readiness

**Gate verified live.** `Invoke-ReleaseGateCheck.ps1` derives
`PRODUCTION_CRYPTO_SUITE` from `backend/src/main.ts` itself, so no flag can
override it:

```
PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW
```

**No bypass exists — structurally.** A repository-wide search for classes
implementing `DeviceSignatureVerifier` or `EnvelopeSignatureVerifier` returns
exactly one file: `RejectingCryptoVerifiers.ts`. There is no production verifier
to activate, so there is nothing a misconfiguration could switch on. `main.ts`
wires `Rejecting*` at every composition point.

**Review package prepared** (`docs/security/production-crypto-review/`): threat
model, source map, reviewer checklist, test evidence and a findings template.

**Remaining evidence required:** an assigned external reviewer; a completed
findings document; and a recorded `PCA-DEC-020` approval with an evidence
reference in `external_gate_matrix.json`, entered by the accountable human owner
— the register's own schema note forbids an agent or script closing it.

**Production crypto was not activated. No security approval is claimed.**

Classification: **`SECURITY_REVIEW_BLOCKED`**.

---

## 10. Live database readiness

**No live or production database was accessed, modified, migrated, seeded or
validated against.** No authorization was given in this session and none was
assumed.

Repository-side readiness (read, plus one gate executed):

- 40 migrations; canonical schema of 78 tables / 646 columns / 83 foreign keys.
- `PCA_LIVE_DATABASE_SETTINGS.md` pins MySQL 8.4, `utf8mb4`/`utf8mb4_bin`,
  `--default-time-zone=+00:00`, `DATETIME` throughout, and application-side
  `timezone: 'Z'`, and is explicit that MySQL 8.0.x is **unverified**.
- The privacy schema gate was **executed** here: 30/30 pass.

**Evidence required to close it**, none of which exists yet: a provisioned
instance on 8.4 with those settings; `MIGRATION_FROM_ZERO` run against it;
schema fingerprint matching the canonical value; a restore-from-backup drill; and
the rollback checklist executed once for real.

Classification: **`LIVE_DB_NOT_AUTHORIZED`**.

---

## 11. Azure / domain readiness

**Nothing was changed.** No Azure configuration, DNS record, certificate,
managed identity, deployment or routing was touched, inspected via credentials,
or contacted.

Repository-recorded topology (readiness only):

| Surface | Dockerfile | Runtime | Port | Health | Domain | Status |
|---|---|---|---|---|---|---|
| Public Web | `public-web/deploy/Dockerfile` | nginx 1.27-alpine | 80 | `/healthz` | `www.pcasafe.com` | NOT DEPLOYED |
| Backend API | `backend/Dockerfile` | Node 22 / Fastify | 4001 | `/health` | `api.pcasafe.com` | NOT DEPLOYED |
| Platform Admin | `platform-admin-web/Dockerfile` | nginx-unprivileged | 8080 | `/healthz` | `platform.pcasafe.com` | NOT DEPLOYED |
| Parent Web | `parent-web/Dockerfile` | nginx-unprivileged 1.27-alpine | 8080 | `/healthz` | `app`/`parent.pcasafe.com` | NOT DEPLOYED |

The apex → `https://www.pcasafe.com/*` permanent redirect is the recorded
desired architecture and **is not implemented** — it is a DNS/host action, not a
repository one, and was not performed.

`DEPLOYED_TLS_TERMINATION_CONFIG` is open for **every** target including
`PUBLIC_A` — correctly, since any HTTPS publication needs it and no TLS
termination exists in-repo.

---

## 12. Privacy / information-flow verification

Re-confirmed by **executing** `backend/test/schema-privacy.test.mjs` (30/30
pass) on this tip:

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

No invariant was weakened. Nothing in this session's changes touches the data
model: the two fixes are an evidence-generator and documentation.

The public site independently reinforces this: the adversarial probe confirms
zero off-origin references and zero runtime network calls, so the public surface
collects nothing.

W3's deferred `WebRuleRepository` durability item remains correctly open as
`EXTERNAL_DECISION_REQUIRED` — persisting parent-authored domain rules centrally
is a privacy-architecture question, and it was not worked around here either.

---

## 13. Family-isolation verification

W3's fix holds: `ChildRequestService.decide()` scopes on the **caller's** own
authoritative `familyId` and returns an indistinguishable `NOT_FOUND` for a
foreign-family request.

**The disclosed residual P2 was re-verified and assessed rather than reopened.**
`cancel()` and `acknowledgeApplied()` both call `repository.get(requestId)`
unscoped, then throw `NOT_FOUND` (HTTP 404) when absent and `NOT_THE_REQUESTER`
(HTTP **403**) when present but owned by another device. The oracle is therefore
genuinely observable over HTTP — W3's description is accurate.

**Assessment: it does not block any release target.** `requestId` is
`randomUUID()` — 122 bits of entropy — so distinguishing 403 from 404 requires
already possessing a valid request ID. It is a device-level, not family-level,
oracle, and it reveals only existence, never content. Confirmed **P2**, unchanged
from W3's classification, and correctly out of scope for this phase.

---

## 14. Open defects found and fixed this session

Four real defects, all outside W3's scope, none in product code — all in
**evidence machinery**: the things that let a release be proved rather than the
release itself. Committed as `b0af12c`, `4f631f1` and `3b1e39f` on `pca-dev`.

### D-1 — The OD-12 owner Arabic sign-off sheet was unproducible and could have lied (P1)

`scripts/arabic-owner-signoff.mjs` read `CONTENT.ar[key]` blindly. Six
reviewer-selected keys had been deleted from **both** locales by the four-page IA
rebalance `e7f1206`, which landed **after** the review package was recorded
(`87f1f83`) — verified with `git merge-base --is-ancestor`. That third state —
neither remediated nor retained, but *gone* — was misread in two opposite ways at
once:

- **Loud half:** `UNCHANGED`/`REJECTED` rows were accused of having "changed
  anyway". Any problem aborts the run, so **the sheet the owner signs OD-12
  against could not be generated at all.**
- **Silent half (the more serious one):** `APPLIED` rows passed the cross-check
  *vacuously* — the check only fires when `before === after` — and would have
  written the literal string `"undefined"` into `FINAL_PROPOSED_ARABIC`,
  presenting it to the owner as the remediated Arabic they were approving.

Additionally, the **committed** sheet predated the rebalance, so it presented six
rows of copy that no longer exists anywhere on the site.

**Fixed** by resolving absence *before* the drift check: removed keys are
reported as `REMOVED_FROM_CORPUS` with `CHANGED = REMOVED`, an empty final
Arabic, and a `WHY_IN_SIGNOFF` line telling the owner the row ships nowhere and
needs only confirmation that the removal was intended. Rows that still ship are
drift-checked exactly as before. The sheet was regenerated: 120 rows, 39 applied,
18 legal-deferred, 1 rejected, 56 unchanged, 6 removed, **all 120 `PENDING`** —
nothing arrives pre-signed.

### D-2 — The OD-12 audit trail was gitignored (P1)

`public-web/.gitignore` ignored all of `reports/`, sweeping up the two Arabic
**decision records** — 42 applied corrections, 2 rejections with their written
reasons, 18 legal deferrals and the reviewer's 189-row tally — alongside
regenerable build output. The generator hard-depends on the ledger.

**Proven, not asserted:** the generator was run against `git archive HEAD` in a
clean directory and died `ENOENT` — a fresh clone could not regenerate or even
verify the sheet the owner signs. An audit trail was one `git clean -x` from
being unrecoverable.

**Fixed** by narrowing the rule to `reports/*` and un-ignoring only those two
files; build output stays ignored. Re-verified: the OD-12 chain now reproduces
from a clean checkout of the committed tree, generator and tests both passing.

### Why D-1 and D-2 were invisible

The `public-web` CI job ran `npm run build` only, which never touches
`scripts/`. Added: `npm test` plus a CI step, and a second CI step that fails if
the committed sheet ever stops matching what the current corpus and ledger
generate.

**The tests are load-bearing, verified by reverting the fix:** 6/6 pass with it,
**5/6 fail without it**. The one that passes either way is the negative control
proving genuine drift still aborts the run — i.e. the integrity check was
strengthened, not weakened.

### D-3 — Android CI could not name a failing test (P2)

The Android job failed on `b0af12c`, a commit touching **zero** Android files,
while the immediately preceding tip had passed it. W3 had read an earlier
instance of this as transient runner contention. That reading was too generous —
but there was no way to tell, because the diagnostic wrapper W3 added
specifically to make failures readable **could not surface a failing unit test**.

Its grep was written for compile and lint errors, and Gradle announces a test
failure as `org.pca.app.SomeTest > someMethod FAILED` — no colon — so it matched
`FAILURE:` no better than `error:`. The public annotations therefore showed only
a generic "There were failing tests" plus a `file://` URL nobody outside the
runner can open, and a bare "Process completed with exit code 1". The job logs
endpoint returns **403** unauthenticated, so annotations are the only public
window — which is the entire reason the wrapper exists.

**Fixed** (`4f631f1`): the JUnit XML under `app/build/test-results` is read first
and each failing testcase emitted by name and class, and the console grep gains
the `> … FAILED` and `N tests completed, M failed` shapes. Verified against a
synthetic Gradle failure (two failures across `<failure>` and `<error>`, one
passing test): both paths name exactly the two failing tests and stay silent on
the passing one. No Android source, test or build file was touched — this changes
what a failure *reports*, never whether it fails.

It worked on the very next run, naming the test in D-4.

### D-4 — A racy Android persistence test (P2)

With D-3 in place, the failure named itself immediately:

```
org.pca.app.enrollment.PersistentEnrollmentLifecycleAuditSinkTest >
appending a transition durably persists every field, honoring null familyId
and fromState FAILED
(1347 tests completed, 1 failed, 1 skipped — testReleaseUnitTest)
```

A race in the **test**, not a product defect. The test assumed
`UnconfinedTestDispatcher` would make the sink's fire-and-forget `launch{}`
complete before the following read. It does not: Unconfined runs eagerly only up
to the first real suspension, and the Room suspend DAO underneath suspends and
resumes on Room's own query executor. `PersistenceTestSupport.inMemoryDb()` sets
no custom query executor, so Room uses its default multi-threaded IO pool —
`allowMainThreadQueries()` permits blocking calls but does not make suspend DAO
calls run inline. The read therefore raced the write on a different pool thread,
passing when the write happened to land first and failing under CI load.

**Fixed** (`3b1e39f`) by joining the scope's children before reading, so the test
waits for the real write instead of assuming it already happened. Nothing it
asserts changes — the production sink is unmodified and still writes exactly as
it does in production. The stale comment asserting the opposite was corrected
rather than left to mislead the next reader. This file was the only user of
`UnconfinedTestDispatcher` in the Android test tree, so no sibling shares the
pattern.

**Verified in real CI, not locally** — there is no Kotlin/Gradle toolchain here,
as every prior wave recorded. Run 34097745170: `Android build, lint, and unit
tests` **SUCCESS**, 21/22 overall.

### D-5 — Stale deployment records (P3, documentation)

`docs/deployment/DOCKER_AZURE_SUPPORT_REVIEW.md` and `docker-compose.yml` both
still recorded that `parent-web` has no Dockerfile. W3 (`4615cc7`) added
`parent-web/Dockerfile` and `nginx.conf`. Corrected, with the deployment position
explicitly unchanged: **a Dockerfile existing is not authority to deploy it.**

### Open, not fixed

| ID | Item | Why not fixed |
|---|---|---|
| O-1 | Android has no release build type or signing config | Requires a keystore that must not be fabricated; ANDROID_D blocked by 16 gates regardless |
| O-2 | `PUBLIC_A` `REAL_UAT` is structurally unsatisfiable | Fixing it means editing release-control semantics — an owner decision, and this phase must not weaken a gate to obtain READY |
| O-3 | iOS `TEST_HOST` failure | `REAL_XCODE_BLOCKED`; a blind `.pbxproj` edit is forbidden |
| O-4 | `ChildRequestService.cancel()`/`acknowledgeApplied()` device-level oracle | Assessed P2, UUID-gated, blocks no target (§13) |
| O-5 | Auth rate limiter is in-process | Documented caveat; a deployment-topology decision |
| O-6 | Security scanner misses identifier aliasing | W3-disclosed; whole-program analysis, out of a line-based scanner's design |

---

## 15. Required external inputs

Nothing below can be produced inside this repository. Ordered by what unblocks
the most.

| # | Input | Unblocks | Owner |
|---|---|---|---|
| 1 | **Legal identity, jurisdiction, controller, effective date (OD-13)** | `PUBLIC_A` | Legal / owner |
| 2 | **Owner visual UAT sign-off on the published public site** | `PUBLIC_A` | Product/design owner |
| 3 | **Public reply identity (Send As) working** | `PUBLIC_A`; conditional for `AUTH_B` | Platform ops |
| 4 | **Native Arabic sign-off (OD-12)** — the sheet is now producible and awaits signature | `PUBLIC_A` | Owner + native reviewer |
| 5 | **TLS termination configured at the host** | **every** target | Platform ops |
| 6 | **Email provider selected + credentials + delivery proven** | `AUTH_B`, `PARENT_C` | Email provider owner |
| 7 | **Human production-crypto security review (PCA-DEC-020)** | `PARENT_C`, `ANDROID_D`, `IOS_FUTURE` | External security reviewer |
| 8 | **Physical Android device + QA execution of the 43 mapped cases** | `ANDROID_D` | Android device owner / QA |
| 9 | **Android signing keystore / Play signing decision** | `ANDROID_D` | Android/release owner |
| 10 | **Real macOS + Xcode** | `IOS_FUTURE` | iOS build owner |
| 11 | **Apple Family Controls entitlement + physical iOS device** | `IOS_FUTURE` | Apple account holder |
| 12 | **Payment provider selection**, then merchant/settlement/certification | `BILLING_FUTURE` | Commercial/finance |
| 13 | **Producer catalogue audit sign-off** | `PARENT_C` | Compliance/privacy |
| 14 | **Android provisioning-path decision (PCA-DEC-002/014/015)** and **PCA-DEC-009 disclosure text** | `ANDROID_D` | Product owner |
| 15 | **Explicit authorization** before any live-database or Azure/DNS action | live DB, deployment | Owner |

---

## 16. Exact next actions

**Owner decisions needed before any further engineering is worth doing:**

1. Resolve **O-2**: decide how `PUBLIC_A` satisfies `REAL_UAT` — author public
   UAT cases, or let `OWNER_VISUAL_UAT` satisfy it. Until then `PUBLIC_A` cannot
   reach `READY` no matter what else closes.
2. Sign or reject the **OD-12** sheet at
   `docs/public/reports/RELEASE_A_ARABIC_OWNER_SIGNOFF.csv` (120 rows, all
   `PENDING`; six now correctly marked `REMOVED_FROM_CORPUS` and needing only
   confirmation that their removal was intended).
3. Supply the **OD-13** legal facts, or confirm Release A stays unpublished.
4. Decide whether to register an explicit `ANDROID_RELEASE_SIGNING_CONFIG` gate
   (**O-1**), so the missing release build configuration is visible to tooling.

**Engineering, once the corresponding input above exists — not before:**

5. Configure the email provider, then execute `UAT-AUTH-01…04` plus the eight
   evidence items in §4 and log them in `uat_execution_log.json`.
6. Run the 43 mapped Android cases on real hardware and populate the device
   matrix.
7. Open the iOS project in real Xcode; check whether `PCA.app` actually builds
   before the test host resolves (§7), then re-save the project from Xcode.

**Do not** start: speculative iOS work, payment-provider work, crypto
activation, live-DB work, or another hardening wave. Nothing in this assessment
justifies any of them.

---

## 17. Final release decision

```
PUBLIC_A        = LEGAL_NOT_AUTHORIZED
AUTH_B          = CODE_READY_EXTERNAL_BLOCKED
PARENT_C        = SECURITY_REVIEW_BLOCKED
ANDROID_D       = CODE_READY_UAT_BLOCKED
IOS_FUTURE      = REAL_XCODE_BLOCKED
BILLING_FUTURE  = PROVIDER_BLOCKED
LIVE_DATABASE   = LIVE_DB_NOT_AUTHORIZED

RELEASE_AUTHORIZED = NO for every target.
```

**No target is READY, and none was made to look ready.** Every blocker above is
external — an owner decision, a credential, a human review, a real device, or a
provider — except the four evidence-machinery defects found and fixed here. None
of them gated a release; they gated the *ability to prove* one, which is why they
survived three accepted waves. Two hid a Release A owner artifact that could not
be produced and would have misreported itself; two hid a real failing Android
test behind an unreadable CI signal.

The implementation baseline itself remains sound: 21/22 CI green on the final
tip, privacy invariants at zero, crypto fail-closed with no bypass to
misconfigure, family isolation intact, and no fabricated provider, credential,
device result or approval anywhere in the tree.

A separate Azure disposable-database validation phase ran in the same session and
halted at preflight: the authorized server is **MySQL 8.0.45**, not the required
8.4.x, so no migration was run against it. It also surfaced a security-relevant
finding — the database connection has no TLS enforcement and fails open to
plaintext. See `docs/database/PCA_AZURE_DISPOSABLE_DATABASE_VALIDATION_REPORT.md`.

```
LIVE_DATABASE_CREATED            = NO      LIVE_DATABASE_MODIFIED    = NO
PRODUCTION_EMAIL_CONFIGURED      = NO      EMAIL_DELIVERY_PROVEN     = NO
PRODUCTION_CRYPTO_ACTIVATED      = NO      SECURITY_APPROVAL         = NONE
PAYMENT_PROVIDER_CONFIGURED      = NO      PAYMENT_CERTIFICATION     = NO
ANDROID_REAL_UAT                 = NOT_EXECUTED
IOS_REAL_UAT                     = NOT_EXECUTED
AZURE_OR_DNS_CHANGED             = NO      PUBLIC_DEPLOYMENT         = NO
MERGED_TO_MAIN                   = NO      ORIGIN_MAIN_MODIFIED      = NO
```
