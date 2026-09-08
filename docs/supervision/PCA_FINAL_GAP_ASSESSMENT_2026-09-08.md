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
| parent-web Playwright (Chromium) | **82 / 82** in one full run after the repairs (68 pre-existing specs, of which 3 had failed deterministically on stale labels/page before repair, + 14 new contrast runs) |
| platform-admin-web Playwright | **17 / 17** (15 + 2 contrast) |
| Android JVM (`testDebugUnitTest`, Gradle 8.7, local SDK) | **1347 tests, 0 failures, 1 skipped** |
| Contracts (4 validators + tests) | all OK; runtime-sync 15/15 |
| Release tooling | scoping ALL PASS; FABLE parity PASS (234 cells); 6 target gate runs NOT READY (correct); ledger `--check` OK; gate-table `--check` OK |
| Repo checks / quality / security tooling | PASS (2466 files; 11 privacy sentinels; 8 rejection controls; scanner tests incl. optional-chaining bypasses) |
| public-web | `--check-only` build + 6 tests pass |
| Lint (both consoles, `no-console` enforced) | clean |
| CI | not yet observed for the result commit at the time of writing — the push and its run id are recorded in the final response |
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
VALIDATION_COMPLETION_PERCENT         = 0.0    (strict doc 00 §8A: no requirement has recorded real-device/provider/UAT acceptance evidence; automated evidence executed for 355 of 369 rows with non-empty testEvidence = 96.2 % on the automated layer only -- never conflate the two)
PROGRAMME_RELEASE_COMPLETION_PERCENT  = 0.0    (0 of 39 external gates closed; 0 of 6 targets READY)
```

```
IMPLEMENTABLE_NOW    = 0 blocking items left unimplemented; 10 non-blocking repo-solvable items deferred and listed in G
EXTERNAL_ONLY        = 39 gates (section H) + 4 Azure hygiene actions (M) + apex DNS
FUTURE_SCOPE         = AI, YouTube Mode B, iOS beyond scaffolding, payments, Protected Mode, videos (I)
NO_ACTION_REQUIRED   = crypto fail-closed posture, central-schema privacy invariants, cross-realm auth separation, canonical schema equivalence, gate-tooling integrity (all re-executed and intact)
```

**Do not deploy.** The configured SMTP credential is reported compromised; the register now blocks AUTH_B and PARENT_C on its rotation, and no target has cleared its other gates.
