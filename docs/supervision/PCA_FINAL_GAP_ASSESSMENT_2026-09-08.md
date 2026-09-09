# PCA — Final Independent Gap Assessment and Closure Pass

**Date:** 2026-09-08 · **Branch:** `pca-dev` · **Assessed HEAD:** `5dacd8468216fb40a1e3ca819013cc7106d316b3` (clean worktree, `stash@{0}` preserved untouched) · **Result HEAD:** the commit that carries this file.
**Method:** every number below was produced by running the thing on this machine on 2026-09-08 unless marked *read-only Azure*, *inspected* or *not tested*. Eight read-only assessment agents were launched and all eight died on an account session limit before producing anything; the assessment was therefore completed directly, sequentially, and nothing in this document comes from an agent.
**Companion artifacts:** `PCA_FINAL_GAP_MATRIX_2026-09-08.csv` (38-row gap matrix, Phase 1), `PCA_FABLE_ACTION_CLOSURE_2026-09-08.csv` (all 64 FABLE actions with status at this HEAD), `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md` (rewritten from executed evidence).

---

## A. Executive summary

**No release target is production-ready. Nothing PCA has ever been deployed.** The release gate reports NOT READY for all six targets and that verdict is correct. This is not a code shortfall: the engineering is substantially source-complete and, where automation can reach it, validated. It is blocked by things only a human can produce: a reviewed production crypto suite, a rotated email credential and proven delivery, real-device and real-browser acceptance by testers, legal facts, TLS at the host, and a set of owner decisions that have been open for weeks.

What this pass found and changed, in order of consequence:

1. **A false assurance to parents was live.** The retention-policy route answered `200 { accepted: true }` while storing, delivering and enforcing nothing. It now answers `202 { validated: true, persisted: false, deliveryStatus: RETENTION_POLICY_VALIDATED_NOT_PERSISTED_PENDING_CRYPTO_REVIEW }`, the parent console says so in both languages, and a regression test forbids `accepted: true` returning. Real delivery remains crypto-gated by design; the lie is gone.
2. **A dormant anti-downgrade hole in E2EE acceptance is now structurally closed.** The inline envelope-context placeholder (empty sender key, epoch floors of 0) was replaced by a resolver whose epoch floors are unattainable; a test proves that even an accepting verifier cannot get an envelope through it. Activating a reviewed verifier now *requires* a real trust-set resolver instead of silently accepting epoch-0 envelopes.
3. **A device-level existence oracle was closed** (child-request cancel/acknowledge answered 403 for a foreign device and 404 for an unknown id; both are now an identical 404).
4. **Two false-green gate mechanisms were repaired.** Four contract-catalogue validators were export-only modules that CI ran and that exited 0 without checking anything; they now execute, and the runtime-sync one reconciles routes and error codes against source (immediately catching one unlisted route and two phantom error codes). The derived external-gate register had been hand-edited with four rows the rebuild script could not reproduce; regenerating it dropped them and broke the release gate's parity check. The register is now derived, `--check`ed in CI, and the human-readable gate table is generated.
5. **Real-browser evidence now exists for accessibility and behaviour.** Playwright had never run in CI; three parent-web specs had silently gone stale. A `web-e2e` job now runs both consoles' suites, including a new WCAG AA contrast gate that computes Arabic-text contrast itself because axe-core 4.10 skips Arabic-only text.
6. **Two release dependencies no tooling could surface are registered:** `ANDROID_RELEASE_SIGNING_CONFIG` (no release build type or keystore exists) and `PRODUCTION_EMAIL_CREDENTIAL_ROTATION` (the owner reports the configured SMTP relay credential is compromised). **Deployment stays blocked until the owner records rotation. Nothing was deployed and nothing on Azure was changed.**
7. **The controlled status documents were wrong in the direction of understating the build**: doc 30 and Addendum 002 asserted no Platform Administration or Billing source existed. Corrected from the completion matrix and executed suites.
8. **(Post-push verification) The parent console's service worker answered every reload and deep link with the offline page once it had taken control of the browser — online or not.** A Workbox app-shell option had been pointed at `offline.html`; the QA stacks never ran a production build so no worker ever existed under test. Fixed in the PWA configuration and covered by three real-browser specs that fail on the old configuration (section R, finding 3).
9. **(Post-push verification) The Devices overview told parents "we can't verify this right now" while its family read was merely still loading, and the genuine can't-verify state — the designed real-mode state until crypto activation — overflowed a 320 px viewport.** Both fixed, with a component test and real-browser layout tests that fail against the previous code (section R, finding 4).

Azure was inspected **read-only**: a MySQL 8.4.9 server with an empty `pca_pro` database, private endpoint and TLS enforcement exists, and the backend App Service is correctly configured with Key Vault references — but it still runs a placeholder container, the public site's App Service carries a plaintext client secret and a backend-image reference it should not hold, and the compromised SMTP credential is the one the configuration points at.

---

## B. Current HEAD

| | |
|---|---|
| Assessed | `5dacd8468216fb40a1e3ca819013cc7106d316b3` — `fix(db): disposable bootstrap was schema-equivalent but not data-equivalent` |
| Worktree at start | clean; `stash@{0}` (48 files, DO NOT DROP) present and untouched |
| Result | one commit on `pca-dev` carrying every change in section F (70 modified files, 16 new, 1 deleted) |
| `origin/main` | `f8d5a6fa` — untouched |

---

## C. SOURCE_COMPLETE by phase

Re-derived in `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md`; summary:

| Phase | SOURCE | Note |
|---|---|---|
| PCA-0, 1, 3, 6 (Mode A), 7, 8, 9, 10, 11, 16 | **YES** | |
| PCA-2 | YES (Standard); Protected Mode unprovisioned by owner decision | |
| PCA-4, 5, 12, 13, 17, 19 | **PARTIAL** | usage module unrouted; VPN dormant + web rules in-memory; retention not persisted/delivered; backend tamper unrouted; no store scaffolding; no deployment pipeline |
| PCA-15 (iOS) | PARTIAL (early) | never built; extension target source set defect |
| PCA-14 (AI), PCA-18 (UAT) | **NO** | POST_V1 / never executed |
| Addendum 001 | 24/25 rows source-complete | |
| Addendum 002 (PA + BILL) | 98/98 rows source-complete | workstreams PA-4/PA-5/PA-6 PARTIAL; PA-UAT/BILL-UAT not started |
| Addendum 003 | 24/24 | |
| Addendum 004 | 25/25 | |
| Base A-100 (203 rows) | 169 source-complete, 27 PARTIAL, 1 NOT_STARTED, 6 N/A | from `PCA_COMPLETION_V2_MATRIX.json` |

---

## D. VALIDATED_COMPLETE by phase

**No phase is `VALIDATED_COMPLETE = YES`.** Every acceptance layer that needs a device, a provider, a human tester or a reviewer is unexecuted (`uat_execution_log.json` 0/54). Every phase with source is `PARTIAL`: its automated evidence exists and was executed on 2026-09-08 (section P). The honest per-phase table is in doc 30.

---

## E. PRODUCTION_READY by target

None. See Q.

---

## F. Implemented fixes (all executed and re-tested)

Backend:
- `retentionRoutes.ts`: honest 202 contract + `RETENTION_POLICY_DISCLOSED_STATE`; tests updated + regression test (FABLE-A049).
- `ChildRequestService.cancel/acknowledgeApplied`: foreign device → `NOT_FOUND`; `NOT_THE_REQUESTER` retired from the error vocabulary and both locales; service + HTTP identity tests (A032/O-4).
- `RejectingCryptoVerifiers.ts` + `main.ts`: `rejectingResolveEnvelopeContext`; new `test/runtime-sync/RejectingEnvelopeContextResolver.test.mjs` (5 tests incl. negative control and a main.ts wiring assertion) registered in `run-tests.mjs` (A007).
- `PlatformAdminAuthService`: lockout alert now carries the locked account's `adminId` (account resolved before the lockout branch); regression + unknown-email negative control (A037).
- `recovery/types.ts`: decision citation corrected to doc 09 §5 / legacy `PCA-DEC-R06`.
- `db/schema.ts`, `scripts/generate-bootstrap-sql.mjs`: stale range/count comments.

Contracts / tooling / CI:
- All four `validate-catalogue.cjs` gain a main guard; runtime-sync gains `validateHttpSurfaceAgainstSource` (routes, device-session codes, outbound outcomes, parent-sdk parity) + 5 tests; catalogue corrected (protection-status route added; phantom `INVALID_INPUT`/`BATCH_TOO_LARGE` removed) (A017).
- `RebuildR3DerivedLedgers.mjs`: registry-derived register rows, `--check` mode; `ValidateR3EvidenceDiscipline.mjs`: undeclared gate labels fail; `PCA_COMPLETION_V2_MATRIX.json`: 39 gates declared, three anchored registry-only gates, three pipe-joined labels split, email/certification gates attached to `PCA-ADD-IDENT-005`/`PCA-ADD-BILL-041` (A059, ledger reproducibility).
- `external_gate_matrix.json` + FABLE scope CSV: `ANDROID_RELEASE_SIGNING_CONFIG`, `PRODUCTION_EMAIL_CREDENTIAL_ROTATION`; `GenerateExternalGateMatrixMd.mjs` (+ `--check`) generates `EXTERNAL_GATE_MATRIX.md`.
- `quality-gates.yml`: release-control gains the two `--check` steps; new `web-e2e` job (Playwright, Chromium, both consoles) (A018).
- `tooling/mutation`: honest header, README, `executesTests:false` in the report (A040).

Web:
- `src/security/diagnosticConsole.ts` in both apps; `useAsync`, `Settings`, both `AppErrorBoundary`s routed through it; `no-console: error` in both ESLint configs (QA/e2e/script dirs excepted); sentinel tests proving a URL, child name and domain never reach the console in production (A057).
- Retention contract/copy/types/tests aligned with the backend (EN + AR).
- `e2e/contrast.spec.ts` + `e2e/lib/contrastAudit.ts` in both apps (A035); three stale parent-web specs repaired.
- *(post-push verification)* `parent-web/vite.config.ts` PWA: the `/offline.html` NavigationRoute that answered every worker-controlled reload/deep link with the offline page while online is replaced by a `NetworkOnly` navigation route with a precache fallback; `e2e/pwa-service-worker.spec.ts` (3 specs) added (G-39 / A065; section R finding 3).
- *(post-push verification)* Devices overview: `DevicesTabs` now tells a pending family read from a declined one (`familyPending`); `OverviewSection` renders "Loading..." while pending and "we can't verify this right now" only when declined; the declined-state pill wraps inside a summary cell (`global.css`); the 320 px overflow spec waits for data to settle and gains a declined-state layout test at 375/320 px; component test for the pending state (G-40 / A066; section R finding 4).
- Runtime `nginx-unprivileged` stages pinned by digest in both Dockerfiles; platform-admin image rebuilt with `--no-cache` to prove the pin resolves (A025, partial).

Android:
- Bootstrap client host `https://api.pca.app` → `https://api.pcasafe.com`; App Link host left as a documented placeholder pending the assetlinks decision (A051 partial).
- Child "what your parent can see" copy (EN/AR, regular + simple) conditioned on the device being connected (A052 partial).

Documentation:
- doc 30 rewritten; doc 31 legacy register series crosswalk (`PCA-DEC-R01..R08`) resolving the number collision; doc 32 inventory note (203 rows); Addenda 001–004 headers, Addendum 002 §1/§21/§22; root README; release-readiness README/RELEASE_GATE/RELEASE_EVIDENCE; status-document banner; privacy classification (2 rows); inventory CSV provenance (0037); superseded markers (legacy-postgresql, v0.1 package, R3 gap CSV); `CURRENT_DIRTY_PATHS.txt` removed; public-web page-count comments.

---

## G. Remaining engineering gaps (repo-solvable, deliberately deferred and recorded)

| Item | Why deferred |
|---|---|
| Durable `FamilyAuditRepository` (A011), durable web rules (A012) | in-memory by design/owner privacy decision; W3 assessment stands |
| Bare `catch` around Rejecting composers (A013) | composers reject by design until crypto; silent-by-construction, recorded |
| Container rollback runbook (A025 second half) | needs the deployment topology decision first |
| `billing_invoices` write path (A036) | BILLING_FUTURE; no provider |
| Retention route role check (A031) | server-side roles unavailable until crypto activation |
| Android `familyId=""` at enrollment (A050), retention vs clock rollback (A055), `BidiUtils` wiring (A056), launcher icon (A053) | design decisions / assets; not mechanical |
| iOS extension source set, icon, launch screen (A033/A034) | forbidden without Xcode to verify |
| `forced-colors`/`prefers-contrast` CSS, a real mutation harness, CI guard against importing the unreviewed Ed25519 signer | improvements, not defects; recorded |
| Traceability markdown distribution tables (R4 counts) vs JSON | JSON is machine-checked truth; markdown regeneration left to the next traceability pass |
| One unexplained billing e2e failure (1 in 2 full zero-retry runs; 0 in 30 isolated repeats) — G-41 | cause not proven; diagnostics added to the spec; CI run 2 is the next datapoint (section R, finding 5) |

---

## H. Remaining external gates (39, none closed)

Per target hard blockers: PUBLIC_A 3 (+ structural `REAL_UAT`), AUTH_B 3, PARENT_C 8, ANDROID_D 17, IOS_FUTURE 9, BILLING_FUTURE 7. Full generated table: `docs/release_readiness/EXTERNAL_GATE_MATRIX.md`. The owner decisions with the widest effect: crypto review (`PCA-DEC-020`), SMTP credential rotation + provider proof, how PUBLIC_A/IOS_FUTURE/BILLING_FUTURE satisfy `REAL_UAT`, Android provisioning path, OD-12/OD-13, merge strategy.

---

## I. Future-scope items (not defects)

On-device/cloud AI (POST_V1, `CLOUD_AI_OWNER_DECISION`); YouTube Mode B; iOS beyond scaffolding; payment provider chain; Protected Mode provisioning; public videos.

---

## J. Security findings

| # | Sev | Finding | Status |
|---|---|---|---|
| S-1 | P0 | Retention false assurance (`accepted: true`) | **Fixed** |
| S-2 | P0 | Envelope-context placeholder = latent anti-downgrade hole on crypto activation | **Fixed structurally** |
| S-3 | P2 | Device-level existence oracle in child-request cancel/acknowledge | **Fixed** |
| S-4 | P2 | Platform-admin lockout alert could never name the account (`adminId` null) | **Fixed** |
| S-5 | P1 (external) | Compromised SMTP relay credential configured for the backend App Service | **Gate registered; owner must rotate** |
| S-6 | P1 (external) | `pcaSafe` App Service holds a plaintext `MS_CLIENT_SECRET` and a `pca-backend:5dacd84` image reference; pulls with ACR admin credentials | Owner hygiene |
| S-7 | P2 (external) | `pca-mysql` public network access Enabled (one client-IP rule) alongside the private endpoint | Owner: disable once the private path is proven |
| S-8 | P2 | Bare `catch` sites swallow Rejecting composer failures (A013) | Recorded |
| S-9 | P3 | Working Ed25519 signer unimported in `parentaccount/genesisDeviceSigner.ts` with no CI guard | Recorded |
| Verified intact | — | crypto fail-closed (only `Rejecting*` verifiers exist), cross-realm separation, TOTP anti-replay, step-up CAS, CIDR trust proxy, HMAC-keyed codes, scrypt bounds, DB TLS fail-closed at boot, 15 cross-family MySQL isolation tests, rate limiting (in-process caveat) | executed suites |

---

## K. Privacy findings

- Nine central-schema absence invariants at zero (schema-privacy 30/30 + MySQL suite, re-executed).
- Browser console was a real sink for raw error objects in production builds — closed with a redacting helper, lint enforcement and sentinel tests (URL, child name, domain).
- Existing sentinel coverage confirmed by execution: email error redaction, no-payload HTTP logging, 11 synthetic privacy sentinels in the quality checks, Android camera privacy static scan (JVM).
- Two privacy-class misclassifications corrected. On-device sink injection remains a hardware gate.

---

## L. Accessibility / RTL findings

- Exact EN/AR parity holds in all four surfaces; RTL applied.
- Contrast was unenforced for both consoles (jsdom cannot compute it). Now enforced in a real browser on 7 parent-web routes and the platform-admin login + shell, in both languages; **axe-core 4.10 skips Arabic-only text**, so an independent Arabic-text audit is part of the gate.
- Open: Android `BidiUtils` unwired; no `forced-colors`/`prefers-contrast` blocks in either console; screen-reader/text-scaling evidence is device-only (UAT-I18N-01..03).

---

## M. Database / infrastructure findings

| Item | Result |
|---|---|
| Local MySQL 8.4.11 suite | 532 tests, 528 pass, 0 fail, 4 privilege-gated skips (need `PCA_MIGRATION_DATABASE_URL`) |
| Canonical fingerprint | `278c141e…329f` unchanged (schema untouched this pass; `generate-disposable-bootstrap --check` runs in `npm test`) |
| Azure `pca-mysql` (read-only) | 8.4.9, `require_secure_transport=ON`, TLS 1.2/1.3, `time_zone=+00:00`, `pca_pro` `utf8mb4_bin`, private endpoint 10.0.0.5 + private DNS, `sql_mode` strict, `audit_log` OFF |
| `pca_pro` grants / reference data / fingerprint | **NOT TESTED** — no network path from this host (single client-IP firewall rule for another address); adding a rule or reading the production connection secret was deliberately not done |
| `pca` App Service | VNet-integrated, `vnetRouteAllEnabled=true`, Key Vault refs for all four secrets, `PCA_DATABASE_TLS=REQUIRED`, `NODE_ENV=production`; **runs `mcr.microsoft.com/appsvc/staticsite:latest`** — no PCA backend deployed; alwaysOn/http2 off, no health check path |
| `pcaSafe` App Service | placeholder image; plaintext `MS_CLIENT_SECRET`; `DOCKER_CUSTOM_IMAGE_NAME=pca-backend:5dacd84` present |
| Apex DNS | `pcasafe.com` still has no A record |
| ACR | not listable without data-plane rights |

---

## N. Release-gate findings

- `-ReleaseTarget` required, no default, missing value fails closed; `-IgnoreExternalGates` never READY (exit 2) — re-executed.
- Crypto signal derived from `main.ts`; UAT read only from the human log; hard vs conditional scopes enforced; parity 234 cells PASS; scoping suite 0 failures.
- Fixed: irreproducible derived register (now `--check`ed in CI); generated gate table; two missing gates.
- Owner decision still needed: PUBLIC_A, IOS_FUTURE and BILLING_FUTURE have zero UAT cases and therefore can never reach READY (acknowledged contradiction O-2, not weakened here).

---

## O. Traceability / documentation findings

Corrected: doc 30 (false "no PA/Billing source"), Addenda 001–004 status headers, Addendum 002 §1/§21/§22, README, release docs (33/34/7 gate counts, missing-gate claim), doc 31 number collision (legacy series crosswalk), doc 32 (203 vs 199), status-document banner, inventory provenance, privacy classes, superseded markers, stale root file. Remaining: traceability markdown distribution tables are R4-era; historical PPR/public reports are left as history and must not be cited as current.

---

## P. Test results (executed 2026-09-08, this machine)

| Suite | Result |
|---|---|
| Backend non-DB (`npm test`, incl. double-conformance negative control) | **2337 / 2337 pass** (final run after all changes) |
| Backend MySQL 8.4 (`npm run test:db`, from a zero-state reset) | **532 tests, 528 pass, 0 fail, 4 skip** (privilege gate not runnable without `PCA_MIGRATION_DATABASE_URL`) |
| parent-web Vitest (8 shards, `--maxWorkers=2`) | **998 / 998 pass** |
| platform-admin-web Vitest (4 shards) | **155 / 155 pass** |
| parent-web Playwright (Chromium) | **87 / 87 at `--retries=0 --workers=2` (run 2 of a pair; run 1 was 86 / 87 with one billing-spec failure that 30 isolated repeats, idle and under CPU load, did not reproduce — recorded as finding 5, not dismissed)** (post-push verification, after the service-worker and overview fixes in section R findings 3–4: 68 pre-existing specs, of which 3 had failed deterministically on stale labels/page before repair, + 14 contrast runs + 3 PWA worker specs + 2 declined-state layout tests). The earlier figure of 82 / 82 was reached only with one retry and is superseded. |
| platform-admin-web Playwright | **17 / 17** (15 + 2 contrast) |
| Android JVM (`testDebugUnitTest`, Gradle 8.7, local SDK) | **1347 tests, 0 failures, 1 skipped** |
| Contracts (4 validators + tests) | all OK; runtime-sync 15/15 |
| Release tooling | scoping ALL PASS; FABLE parity PASS (234 cells); 6 target gate runs NOT READY (correct); ledger `--check` OK; gate-table `--check` OK |
| Repo checks / quality / security tooling | PASS (2466 files; 11 privacy sentinels; 8 rejection controls; scanner tests incl. optional-chaining bypasses) |
| public-web | `--check-only` build + 6 tests pass |
| Lint (both consoles, `no-console` enforced) | clean |
| CI | see section R (post-push verification): run 1 on `568a4c7` = 20 of 23 jobs green (iOS known red; two CI findings); run 2 on `5a2efde` = 21 of 23 green (see R); run 3 on `0f03c8b` = 22 of 23 green (iOS only red) |
| iOS | not built (no Xcode); CI job known red |

---

## Q. Final release decision per target

```
PUBLIC_A       : SOURCE=YES   VALIDATED=PARTIAL (real-browser build/a11y/content gates executed; owner visual UAT not) EXTERNAL=OPEN (TLS, OWNER_VISUAL_UAT, PUBLIC_REPLY_IDENTITY, OD-12, OD-13, apex DNS; REAL_UAT structurally unsatisfiable) PRODUCTION_READY=NO
AUTH_B         : SOURCE=YES   VALIDATED=PARTIAL (unit + MySQL; 0/4 UAT-AUTH)                  EXTERNAL=OPEN (PRODUCTION_EMAIL_DELIVERY, PRODUCTION_EMAIL_CREDENTIAL_ROTATION [compromised credential], TLS) PRODUCTION_READY=NO
PARENT_C       : SOURCE=YES   VALIDATED=PARTIAL (unit + MySQL + Playwright; 0/22 UAT)          EXTERNAL=OPEN (4 crypto gates, email x2, producer catalogue sign-off, TLS)   PRODUCTION_READY=NO
ANDROID_D      : SOURCE=YES   VALIDATED=PARTIAL (JVM 1347; 0/43 device UAT)                    EXTERNAL=OPEN (17 hard gates incl. new ANDROID_RELEASE_SIGNING_CONFIG)      PRODUCTION_READY=NO
IOS_FUTURE     : SOURCE=PARTIAL(early) VALIDATED=NO (never built)                             EXTERNAL=OPEN (Xcode, entitlement, device, crypto, TLS)                      PRODUCTION_READY=NO
BILLING_FUTURE : SOURCE=YES   VALIDATED=PARTIAL (unit + MySQL; no provider flow)              EXTERNAL=OPEN (7 commercial/TLS gates)                                       PRODUCTION_READY=NO
```

**Derived percentages (from `PCA_COMPLETION_V2_MATRIX.json` and the gate register, not estimates):**

```
TECHNICAL_COMPLETION_PERCENT          = 92.1   (340 of 369 applicable requirement rows carry a SOURCE_COMPLETE* status; 6 NOT_APPLICABLE excluded; 28 PARTIAL + 1 NOT_STARTED)
VALIDATION_COMPLETION_PERCENT         = 0.0    (strict doc 00 §8A: no requirement has recorded real-device/provider/UAT acceptance evidence; the automated layer is 351 of 369 applicable rows with non-empty testEvidence = 95.1 %, recomputed from the matrix on the post-push verification -- never conflate the two)
PROGRAMME_RELEASE_COMPLETION_PERCENT  = 0.0    (0 of 39 external gates closed; 0 of 6 targets READY)
```

```
IMPLEMENTABLE_NOW    = 0 blocking items left unimplemented; 10 non-blocking repo-solvable items deferred and listed in G
EXTERNAL_ONLY        = 39 gates (section H) + 4 Azure hygiene actions (M) + apex DNS
FUTURE_SCOPE         = AI, YouTube Mode B, iOS beyond scaffolding, payments, Protected Mode, videos (I)
NO_ACTION_REQUIRED   = crypto fail-closed posture, central-schema privacy invariants, cross-realm auth separation, canonical schema equivalence, gate-tooling integrity (all re-executed and intact)
```

**Do not deploy.** The configured SMTP credential is reported compromised; the register now blocks AUTH_B and PARENT_C on its rotation, and no target has cleared its other gates.

---

## R. Post-push CI verification (2026-09-08, added by the verification pass)

**Correction to the mission premise:** the closure commit had **not** been created when the verification mission started — the permission classifier had blocked `git commit`, so local and remote HEAD were still `5dacd84` with 88 files staged. The commit was created and pushed during the verification pass as `568a4c7fcc25e57496bc633cc16fdebd4adc6aab` (`origin/pca-dev`, fast-forward from `5dacd84`; `origin/main` untouched; history not rewritten).

**CI run 1 — `568a4c7`, workflow "Quality gates", run 34195289791, conclusion FAILURE (20 of 23 jobs green):**

| Job | Result | Duration | Note |
|---|---|---|---|
| Contracts validation | success | 8 s | all four validators now execute (see section F) |
| Backend build and unit tests | success | 54 s | 2337 tests incl. the five new regression files |
| Repository quality / Security controls / Dependency audit | success | 42 s / 17 s / 19 s | |
| Release control integrity | success | 59 s | includes the two new steps: derived-ledger `--check` and generated gate-table `--check` |
| parent-web unit tests (8 shards) / platform-admin-web (4 shards) | success | 26–39 s / 15–24 s | |
| public-web build and content gates | success | 7 s | |
| Android build, lint, and unit tests | success | 327 s | with the copy/host changes |
| Web production demo-mode gate | **failure** | 23 s | step "Lint parent-web": `parent-web/e2e/lib/contrastAudit.ts:51 Irregular whitespace not allowed` — a raw U+FEFF inside the Arabic-script regex range in the new audit helper (ESLint `no-irregular-whitespace`). **TEST_DEFECT** in the new harness file; invisible locally because lint had been run before the file was created. Fixed: `\u` escapes; lint re-run clean in both consoles; the gate itself was skipped after the lint step and passes locally (`gate:demo-mode:both`, both apps, incl. negative controls). |
| Web real-browser e2e (Playwright, Chromium) | **failure** | 1197 s | parent-web step failed after 1153 s; platform-admin step skipped. **CI_ENVIRONMENT_DEFECT** in the new job: every spec assumes demo mode (`VITE_PCA_DEMO_MODE=true`, the documented dev default and what `vitest.config.ts` forces), which a developer's gitignored `parent-web/.env` supplies locally and a clean checkout does not. Reproduced locally by removing `.env`: every spec fails on `page.goto` timeout. Fixed: the job now forces `VITE_PCA_DEMO_MODE=true` / `VITE_PCA_API_BASE_URL` exactly as the demo-mode gate job does, wraps each suite in a hard `timeout`, and re-emits the suite summary and last lines as annotations (the job log is not publicly readable). Proof: full parent-web suite run locally with `.env` removed and only those variables exported — see run 2 line below. |
| iOS build and unit tests | **failure** | 22 s | byte-identical to every prior run: `Could not find test host for PCATests: TEST_HOST evaluates to .../PCA.app/PCA`. **KNOWN_IOS_BLOCKER** (needs real Xcode). |

Neither CI finding is a product defect and no test or gate was weakened to obtain green: the lint rule stays, the demo-mode forcing mirrors the existing gate job, and the timeouts only bound a hang. Findings 3 and 4 below **are** product defects; both were fixed with real-browser regression coverage rather than by retries.

**Finding 3 — found while reproducing finding 2, not reported by CI: REAL_PRODUCT_DEFECT in the parent console's PWA service worker (fixed).** With `.env` removed, the full parent-web suite passed only after retries (8 billing specs), and a later zero-retry run failed `device-enrollment.spec.ts:93` with a 26 px overflow at 320 px. The page it measured was `public/offline.html` ("You're offline"). Root cause: `navigateFallback: '/offline.html'` in `parent-web/vite.config.ts` registers a Workbox `NavigationRoute` that answers **every worker-controlled navigation to a non-precached URL** — every reload and every deep link other than `/` — with the offline page, online or not. Deterministic reproduction: once the worker has taken control, `page.goto('/dashboard')` returns `<h1>You're offline</h1>` while the preview server is fully reachable. In production a parent who reloads any console route, or follows any deep link after the first visit, would see the offline page. `docs/public/reports/PUBLIC_0_DISCOVERY_REPORT.md` had called this "plausible — nothing tests it"; the existing offline spec dispatches a synthetic `offline` event on an already-loaded page and never navigates under the worker, so it could not catch it, and the QA stacks ran the Vite dev server, which registers no worker. Fix: navigations use a `NetworkOnly` runtime route with `precacheFallback` to `/offline.html` (served only when the network request fails); no `NavigationRoute`; the runtime cache stays empty, so the E2EE no-caching rule is unchanged. Regression: `parent-web/e2e/pwa-service-worker.spec.ts` — three specs (deep links and reloads render the real page under worker control; offline → offline page → reconnect → real page; worker-source guard: NetworkOnly present, fallback present, no NavigationRoute, no caching strategy). All three fail on the previous configuration and pass on the fix. The earlier "8 flaky" label was wrong and is withdrawn — those specs were measuring the offline page. A zero-retry suite run after this fix still failed the 320 px overflow spec once in two runs, on the real page this time, which led to finding 4. The defect was fixed in the product, not hidden by blocking service workers in the test runner.

**Finding 4 — found by the zero-retry re-run after finding 3: two REAL_PRODUCT_DEFECTs in the parent console's Devices overview and one TEST_DEFECT in its 320 px overflow spec (all fixed).** The failing measurement was taken on the real overview page, in the moment between the device list resolving and the family read resolving. (1) *Honesty defect:* in that moment the Offline tile rendered a dash and "We can't verify this right now" — the copy reserved for a *declined* family read — because `DevicesTabs` passed `null` for both "not resolved yet" and "declined"; the dashboard `KpiTile` distinguishes the two, the overview did not. It now renders a neutral dash and "Loading..." while pending (`familyPending`) and the declined copy only when the read actually declined. (2) *Layout defect:* the declined-state pill inherits the global `white-space: nowrap` of `.freshness-marker`, so inside a two-column summary cell at 320 px it made the section 42 px wider than its container and the document 26 px wider than the viewport — and the declined state is the *designed* real-mode state until crypto activation, so every real-mode parent on a narrow phone would have met it. It now wraps inside a summary cell. (3) *Spec defect:* the overflow spec measured whenever the tab strip appeared, so it sampled the transient state at random (3 of 20 probes), and its comment still described a 62 px shell-header overflow that no longer exists (the `/dashboard` baseline measured 0 in 34 of 34 probes). It now waits for every section's data to settle, the comment is corrected, and a dedicated test renders the declined-state markup (pinned by class in the component test) into the live page and measures it against the production stylesheet at 375 and 320 px, because demo mode cannot decline the family read. Proofs: the new component test fails against the previous components (it renders "can't verify" while pending); the new declined-state e2e test fails against the previous stylesheet with exactly the 26 px seen in the failing runs; after the fixes the four overflow/declined tests pass 32 of 32 across eight repeats at two workers, the component file passes 24 of 24, and the full parent-web suite passes 87 / 87 at `--retries=0 --workers=2` (run 2 of a pair; run 1 was 86 / 87 with one billing-spec failure that 30 isolated repeats, idle and under CPU load, did not reproduce — recorded as finding 5, not dismissed).

**Finding 5 — one unexplained failure, recorded rather than dismissed.** In the first of the two final zero-retry runs (86 / 87), `billing.spec.ts` "a completed device increase produces a paid invoice visible from the Subscription overview" failed at its last step: after the checkout-return page showed **Approved**, the invoices page did not show **Paid** within 5 s. It ran while the repository-quality and security scans were executing on the same machine. What was established: the demo webhook writes APPROVED, the CONFIRMED attempt and the PAID invoice in one synchronous step, so an observed **Approved** implies the invoice exists in memory; both links on that path are router `Link`s, and nothing on the path calls `location.assign`/`reload` (the only such call is the different-origin provider handoff, which the fixture never takes); the second full run passed 87 / 87, and 15 isolated repeats idle plus 15 under equivalent CPU load all passed (30 / 30). The failing run's trace and page snapshot were lost because Playwright clears its output directory at the start of the next run. **Cause not proven.** Action taken: the spec now asserts the invoices URL and the page heading *before* asserting the invoice row, so a recurrence distinguishes "navigation did not happen" from "invoice missing" (no assertion was weakened); the final runs in this pass keep per-run `--output` directories; the item is carried as gap **G-41 (UNRESOLVED, P3)** and CI run 2 is the next datapoint. This is exactly the class of result the mission forbids calling flaky: the label here is *unexplained*, with the evidence and the next step attached.

**CI run 2 — `5a2efde` (the follow-up commit), workflow "Quality gates", run 34218368386, conclusion FAILURE (iOS build and unit tests, Web real-browser e2e (Playwright, Chromium)) (21 of 23 jobs green):**

| Job | Result | Duration |
|---|---|---|
| Contracts validation | success | 7 s |
| Backend build and unit tests | success | 52 s |
| Repository quality / Security controls / Dependency audit | success / success / success | 45 s / 22 s / 30 s |
| Release control integrity | success | 71 s |
| parent-web unit tests (8 shards) / platform-admin-web (4 shards) | success | 30–38 s / success | 19–22 s |
| public-web build and content gates | success | 6 s |
| Android build, lint, and unit tests | success | 321 s |
| Web production demo-mode gate | success | 58 s |
| Web real-browser e2e (Playwright, Chromium) | failure (**parent-web Playwright suite (incl. real-browser contrast gate)**) | 96 s |
| iOS build and unit tests | failure (**Build and test the inert launch shell**) | 19 s |

Web-e2e annotations (emitted by the job itself because its log is not publicly readable): `parent-web Playwright: 1 failed; 86 passed (54.8s)`. Error annotations: `Process completed with exit code 1.`; `exit 1 -- last 30 lines: Retry #1 ───────────────────────────────────────────────────────────────────────────────────────

    Error: expect(received).toBeLessThanOrEqual(expected)

    Expected:`; `  1) [chromium] › e2e/responsive.spec.ts:56:1 › an offline device state is visible on the dashboard without horizontal overflow at 320px width `.

Run 2 confirms findings 1 and 2 closed by CI (the demo-mode gate ran to completion in both consoles; the parent-web Playwright suite executed to completion on the runner in 55 s, 86 passed) and surfaced one new, deterministic failure — finding 6. Finding 5 (billing) did not recur.

**Finding 6 — CI run 2 only: REAL_PRODUCT_DEFECT (responsive, platform-dependent) in the dashboard child card at 320 px (fixed).** `responsive.spec.ts` "an offline device state is visible on the dashboard without horizontal overflow at 320px width" failed on the Linux runner on both its attempt and its retry with 6 px of document overflow, while the same spec passes on Windows. Cause, reproduced locally by forcing wider font families: the child card's headline pill (`.child-headline-status`, `flex: none`, `white-space: nowrap`) no longer fits beside the avatar in a 254 px head row once the font is wide — `system-ui` resolves to a wider face on the runner; Verdana locally reproduces 5 px — and the row pushed the page sideways. The row was *already* overflowing its own box under every font (2 px under Segoe UI, 7 px under Arial, 18 px under Tahoma); the card and page padding merely hid it from the viewport on narrow fonts, which is why the failure was platform-specific. Fix: the head row wraps (`flex-wrap: wrap`) so the pill drops to its own end-aligned line when it cannot fit, and the pill is capped at the card width with wrapping text as a last resort. Regression: a new containment test asserts every `.child-card-head` contains its own content at 320 px — platform-independent, and it fails against the previous stylesheet on Windows with the culprit named (`scrollWidth=256 clientWidth=254`); the viewport assertion now reports its culprits in the message so a CI-only recurrence is diagnosable from the annotations. A first attempt at a "10 % wider letter-spacing" stress test passed against the old stylesheet and was discarded — a regression that does not fail on the defect is not a regression. Proofs: containment test fails on the old CSS; responsive spec 27 / 27 on the fix; wide-font probe after the fix: 0 px document overflow and 0 px head overflow under default, Verdana and Tahoma; full parent-web suite 88 / 88 at `--retries=0 --workers=2`.

**CI run 3 — `0f03c8b` (the finding-6 commit), workflow "Quality gates", run 34219540299, conclusion FAILURE (iOS build and unit tests) (22 of 23 jobs green):**

| Job | Result | Duration |
|---|---|---|
| Contracts validation | success | 6 s |
| Backend build and unit tests | success | 57 s |
| Repository quality / Security controls / Dependency audit | success / success / success | 43 s / 18 s / 16 s |
| Release control integrity | success | 67 s |
| parent-web unit tests (8 shards) / platform-admin-web (4 shards) | success | 25–40 s / success | 16–23 s |
| public-web build and content gates | success | 7 s |
| Android build, lint, and unit tests | success | 247 s |
| Web production demo-mode gate | success | 59 s |
| Web real-browser e2e (Playwright, Chromium) | success | 121 s |
| iOS build and unit tests | failure (**Build and test the inert launch shell**) | 24 s |

Web-e2e annotations: `platform-admin-web Playwright: 17 passed (14.1s)`; `parent-web Playwright: 88 passed (56.3s)`.

The only red job is the iOS one (KNOWN_IOS_BLOCKER, byte-identical to every prior run). Every other job is green on CI, including the real-browser e2e job with both consoles' suites executed to completion — findings 1, 2, 3, 4 and 6 are closed by CI evidence; finding 5 did not recur.

---

## S. One-session programme pass (2026-09-08, PCA-1 … PCA-17 + Addenda 001/002)

**Premise check.** All 375 controlled requirements were re-triaged against the JSON matrix (`docs/supervision/PCA_REQUIREMENT_MATRIX_2026-09-08.csv`, one row per id, no omissions). Every one of the 29 rows that is not source-complete carries an external gate: 20 crypto (`CRYPTO_ACTIVATION` / `PRODUCTION_CRYPTO_SECURITY_REVIEW`), 2 `PENDING_OWNER_DECISION`, 1 `YOUTUBE_MODE_B_POLICY_REVIEW`, 1 `CLOUD_AI_OWNER_DECISION`, 1 `ANDROID_APP_LINK_ASSETLINKS_HOSTING`, plus 2 validation-pending rows whose remaining evidence is real-device. So the repository-implementable work lived inside source-complete rows and the deferred action list, not in the status counts — and the status counts are unchanged by design (340 of 369 = 92.1 %).

**Implemented, tested, adversarially probed:**

1. **Invoice on confirmed payment (Addendum 002, BILL-004/005/006, FABLE-A036).** Nothing had ever written `billing_invoices` on the payment path; a family that paid saw an empty invoices page in real mode. `PaymentInvoiceIssuer` issues the PAID invoice with an id derived from the payment transaction id, so redelivery, out-of-order events and re-driven failures cannot double-issue; transaction and attempt rows are linked. Red team: eight concurrent, differently-identified confirmations for one payment yield exactly one transaction and one invoice.
2. **Android local retention on an unpaired device + trusted-time floor (PCA-12, PCA-DATA-024/025, FR-104; FABLE-A055).** The cycle required a family id the bootstrap never discloses, so every locally captured row lived forever before pairing. A local-device cycle keyed by the enrolled device id now runs with `LOCAL_DEVICE_UNPAIRED` receipts, never touching another device's rows, and expiry is judged against the tamper layer's wall-clock high-water mark so a rollback cannot postpone deletion.
3. **Mixed-direction isolation and high-contrast modes (PCA-16, NFR-041; FABLE-A056).** `BidiUtils` gained its first production call sites (Safe Browser block screen with control-character stripping; enrollment fingerprints). Both consoles gained forced-colours, `prefers-contrast: more` and reduced-motion rules, proven under emulated media in a real browser.
4. **Android release build type (PCA-17; repository side of `ANDROID_RELEASE_SIGNING_CONFIG`).** R8 minify + shrink with the Tink annotation rules R8 demanded, signing read from `PCA_RELEASE_*` environment values, unsigned when absent; CI builds it every run and asserts the artifact. The keystore and a signed artifact remain external.
5. **parent-web SBOM in CI (NFR-006)** from the installed tree, validated like the other workspaces.
6. **Genesis-signer import boundary (NFR-004).** The ephemeral Ed25519 signer is imported only by `ParentAccountService`, its verifier factory has no production call site, and `main.ts` keeps the Rejecting verifiers wired — now a suite-failing static test.
7. **Traceability markdown derived from the JSON (Phase 27).** `RegenerateTraceabilityTables.mjs` regenerates the status tables, distributions and completion counts (Correction R6) and `--check` runs in the release-control CI job; doc 30's stale statements (usage module, retention, BidiUtils, Playwright-in-CI, webhook test evidence, PA-4/PA-5 workstream view) were corrected; matrix notes for NFR-044 (residual gap already closed) and BILL-030/032/033/034 (direct MySQL tests exist) were reconciled.

**Not implemented, and why (explicit):** the 29 gated rows above; the design decisions A050 (blank familyId at bootstrap is deliberate; its retention consequence is closed independently), A011/A012 (in-memory family audit and web rules, owner privacy decision), A013 (silent Rejecting composers by design), A031 (server-side roles are crypto-gated), A053 (launcher icon asset), A033/A034 (iOS source set and icon, forbidden without Xcode), a real mutation harness, geofence zone authoring UI (design/UX decision), and the Play/App Store metadata (legal facts and owner decisions).

**Test matrix (executed on this machine, PASS/FAIL/SKIP exact):**

| Suite | Result |
|---|---|
| Backend unit (`npm test`, incl. double-conformance negative control) | PASS 2344 / 2344 |
| Backend MySQL 8.4 (`npm run test:db` on a freshly reset disposable database) | PASS 532, SKIP 4 (privilege gate, delegated), FAIL 0 of 536 |
| Contracts: 4 validators + tests | PASS 5 / 15 / 15 / 14 |
| parent-web: lint / Vitest / Playwright (`--retries=0 --workers=2`) / demo-mode gate + negative control | PASS / 999 of 999 / 92 of 92 / PASS |
| platform-admin-web: lint / Vitest / Playwright (`--retries=0`) / demo-mode gate + negative control | PASS / 155 of 155 / 20 of 20 / PASS |
| public-web build + content gates | PASS |
| Repository, quality and security checks + their self-tests | PASS (2485 tracked files; 11 privacy sentinels; 8 rejection controls) |
| Android: lint + JVM tests + assembleDebug + assembleRelease (`--offline`) | PASS 1356 tests, 0 failures, 1 skipped; release APK built unsigned (0 signature blocks) |
| Release tooling: derived ledgers, gate table, traceability, FABLE parity, external parity, evidence discipline, gate scoping | PASS (all `--check` modes OK) |
| Release gate, six targets | NOT_READY x 6, exit 1 each (unchanged; no gate weakened) |
| iOS | EXTERNAL: not built (no Xcode); CI job known red |
| Privacy / security / crypto / auth / authz / family RBAC / billing / platform-admin suites | included in the backend unit + MySQL runs above (all PASS) |
| Accessibility / RTL / responsive | included in the two Playwright runs above (contrast EN+AR, forced colours, keyboard, RTL, responsive) |

**CI run for this commit — `7f379cf`, workflow "Quality gates", run 34226716959, conclusion FAILURE (iOS build and unit tests) (22 of 23 jobs green):**

| Job | Result | Duration |
|---|---|---|
| Contracts validation | success | 9 s |
| Backend build and unit tests | success | 62 s |
| Repository quality / Security controls / Dependency audit | success / success / success | 44 s / 16 s / 17 s |
| Release control integrity (incl. the new traceability --check) | success | 67 s |
| parent-web unit tests (8 shards) / platform-admin-web (4 shards) | success | 27–41 s / success | 17–23 s |
| public-web build and content gates | success | 8 s |
| Android build, lint, unit tests + assembleRelease (unsigned artifact asserted) | success | 565 s |
| Web production demo-mode gate (incl. the new parent-web SBOM step) | success | 59 s |
| Web real-browser e2e (Playwright, Chromium) | success | 112 s |
| iOS build and unit tests | failure (**Build and test the inert launch shell**) | 24 s |

Web-e2e annotations: `platform-admin-web Playwright: 20 passed (14.6s)`; `parent-web Playwright: 92 passed (55.1s)`.

The only red job is the iOS one (KNOWN_IOS_BLOCKER, byte-identical to every prior run). Every other job is green on CI for this commit, including the release-control job with the new traceability check, the demo-mode gate job with the new parent-web SBOM step, the Android job building the unsigned release artifact, and the real-browser e2e job executing both consoles' suites to completion.

**Tiers after this pass:** SOURCE_COMPLETE 340 of 369 applicable = 92.1 % (unchanged: the residual gaps closed here lived inside source-complete rows); automated evidence 354 of 369 = 95.9 % (three rows — BILL-004/005/006 — gained their first automated evidence paths this pass); strict VALIDATED_COMPLETE 0 %; PRODUCTION_READY 0 of 6 targets; 0 of 39 external gates closed. Nothing was deployed; Azure and every credential are untouched.

---

## T. Engineering closure pass on the 11 deferred items + G-41 (2026-09-09)

Full detail, classification rationale, adversarial-verification evidence, and CI results: **`docs/supervision/PCA_FABLE_FINAL_REVIEW_REQUEST_2026-09-08.md`** (handoff to FABLE for independent review — this pass does not self-certify closure).

Summary: of the 11 items named in commit `7f379cf`, 5 classified IMPLEMENT_NOW (FABLE-A050 residual UI-honesty gap, FABLE-A013 bare-catch observability, Android+iOS application icons, FABLE-A033 iOS extension target membership, a real backend mutation-testing harness) were implemented, tested, and adversarially verified; 3 classified OWNER_DECISION (FABLE-A012, FABLE-A031, Play/App Store metadata) got no code change and a sharper decision memo; 2 (FABLE-A011, the geofence "design/UX decision" item) were corrected as stale/already-resolved, also with no code change. G-41 (the one unexplained billing e2e observation) is now classified **FLAKY_WITH_ROOT_CAUSE** with a code-level proof of no logical defect and a clean 140/140 reproduction attempt under deliberate concurrent CPU load — no longer UNRESOLVED. An unrelated HIGH-severity dependency CVE (js-yaml, both web consoles) was found and fixed during regression verification. Commit `5744838` (final HEAD `574483852fa9c10a1c59e81399df37970eef310e`); CI run `34295015290`: 22 of 23 jobs green, iOS the only red (KNOWN_IOS_BLOCKER, confirmed byte-identical to every prior run, unaffected by this pass's changes). Requirement-level SOURCE_COMPLETE/VALIDATED_COMPLETE tiers above are unchanged by this pass — every item closed was a FABLE-ledger engineering/tooling item, not a requirement-matrix status change.
