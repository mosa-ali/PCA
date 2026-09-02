# PCA NOT-STARTED Source Completion Programme — Completion Report

**Mission window:** `327d543` → `55523bb` (22 commits, all on `pca-dev`, fast-forward only)
**`origin/main`:** unchanged at `f8d5a6f` throughout — never touched

## Summary

This programme had two phases. Step 0 reconciled `docs/pre-production/PCA_PARTIAL_INTENTIONAL_REGISTER.csv`
(a prior programme's register) against source that had since advanced, and repaired its CSV
syntax. Step 1 built `docs/pre-production/PCA_NOT_STARTED_REGISTER.csv` from an independent
multi-auditor discovery pass, then implemented every genuinely repo-solvable finding across four
implementation waves, re-auditing after each wave with a fresh, independent auditor who did not
trust the prior wave's own claims.

**Final register: 22 rows (N1–N22). 12 `COMPLETE`, 1 `VERIFIED_CLOSED` (already source-complete,
no action needed), 9 correctly left external-gated / owner-decision-pending / not-applicable —
none left in a vague `future`/`later`/`TBD` state.**

## Discovery → implementation → re-audit cycle

| Wave | Items | Found by | Outcome |
|---|---|---|---|
| Wave 0 | — | 5 parallel discovery auditors (requirements/architecture, backend, Parent Web + Platform Admin, Android + iOS, cross-cutting sweep) | Seeded N1–N16 |
| Wave 1 | N1–N4 | Wave 0, cross-verified by 3 independent auditors | Parent-facing sync status, protection-alert destination, trusted-browser pairing wiring, member-removal confirmation |
| Wave 2 | N5–N7 | Wave 0 | WEB_RULE mutation mapping (mirrors item G's precedent), billing renewal-reminder sweep, Android reading-level copy |
| — | — | 2nd independent audit | Found N17–N19 (missed by this session's own writers) |
| Wave 3 | N17–N19 | 2nd audit | `listRules` wiring, Android wellbeing card delivery (+ a real bug caught and fixed in coordinator review), backend `ReleaseService` route |
| — | — | 3rd independent audit | Found N20–N22 (consolidated from 5 raw findings into 3 coherent items) |
| Wave 4 | N20–N22 | 3rd audit | Dashboard cards (WEB_FILTERING + YouTube Mode A), billing admin routes, Android audit-export UI |
| — | — | Adversarial security review of Wave 4 | Found and the coordinator fixed one real RBAC gap (`addPaymentMethod` gated on the wrong, read-scoped operation) |
| — | — | 4th independent audit | Confirmed Wave 4 + the security fix; re-checked every other new RBAC gate for the same mistake class (none found); found 16 real, passing test files never wired into CI |
| — | — | Coordinator fix | Wired the 16 files in; this pushed `package.json`'s `test` script past Windows cmd.exe's ~8191-char command-line limit — extracted the file list into `backend/scripts/run-tests.mjs` (spawns via argv array, immune to the shell limit going forward) |

Each wave was implemented by isolated writers (separate git worktrees or scoped file
ownership to avoid collisions), reviewed by the coordinator before integration, tested (targeted
+ regression + full suite), and re-audited by a fresh, independent pass before the next wave was
authorized — per the mission's own re-audit rule, work continued until an audit found zero
remaining repo-solvable items.

## What's genuinely still open, and why

| Item | Domain | Gate | Why it's correctly not closed |
|---|---|---|---|
| N8 | iOS child-request ("ask parent") | `NEW_FEATURE_ARCHITECTURE_REQUIRED` | No iOS analog of Android's child-request submission mechanism exists at all; needs a product/security decision on request shape and transport before it's buildable |
| N9 | AI classifier wiring | `NEW_FEATURE_ARCHITECTURE_REQUIRED` + `HUMAN_SECURITY_REVIEW_REQUIRED` | iOS has no consuming feature (Safari extension or camera pipeline undecided); Android has a consumption slot but no LiteRT placement boundary; model-signature verification shares the crypto gate below |
| N10 | Recovery cryptography | `EXTERNAL_SECURITY_REVIEW` | No AEAD/KEM primitive selected; explicit, documented, pending human security review (PCA-DEC-020/021) |
| N11 | Wellbeing message control | `EXTERNAL_SECURITY_REVIEW` | Architecture-mandated client-side encryption (doc 36, PCA-WELLCTRL-001/002/003); blocked on the same crypto boundary as N10 |
| N12 | Android Device Owner provisioning | `NEW_FEATURE_ARCHITECTURE_REQUIRED` then `REAL_DEVICE_REQUIRED` | QR vs. ADB provisioning mechanism is an explicit unresolved owner decision (PCA-DEC-002/014/015); building either now would embed an unauthorized assumption |
| N13 | iOS default shield sequencing | `NOT_APPLICABLE_V1` | Already-decided (PCA-DEC-017): ship the default Apple shield first, custom shield as fast-follow — not a gap |
| N14 | YouTube Mode B | `COMMERCIAL_PROVIDER_REQUIRED` | Legal/API partnership and ToS verification required before further wiring; safe scaffolding is already complete on all 3 platforms |
| N15 | Observability | `PRODUCTION_INFRA_REQUIRED` | Already matrix-accepted as `SOURCE_COMPLETE_EXTERNAL_GATE`; only the deployed monitoring pipeline is external |
| N16 | Billing/free-access/family-capacity | `NOT_APPLICABLE_V1` | Independently verified already source-complete against the requirements matrix — no action needed |

No item above was reopened or worked around. Where a gate is crypto-related, no new
cryptographic primitive was invented; where a gate is an owner/architecture decision, no
assumption was embedded to force a mechanical close.

## Security

- 4 adversarial red-team passes across every new HTTP-exposed capability boundary this session
  introduced (`parentRuntimeSyncRoutes`, `protectionAlertRoutes`, `webRuleRoutes`,
  `browserEndpointRoutes`/pairing challenge-session ceremony, `releaseRoutes`, `dashboardRoutes`,
  `billingAdminRoutes`).
- **1 real, exploitable finding**, found and fixed: `PaymentMethodService.addPaymentMethod` (a
  write) was gated on `VIEW_PAYMENT_INSTRUMENTS` (a read-scoped RBAC operation that allows
  `AUDITOR_READ_ONLY`) instead of `ADMINISTER_BILLING_RECORDS`. Confirmed exploitable via a direct
  `app.inject` probe before the fix; corrected and covered by a new regression test
  (`c3918f4`), independently re-confirmed fixed by the 4th audit.
- All other checks: cross-family/cross-device/cross-child IDOR closed (parameterized queries,
  authorization strictly before data access, non-distinguishing error responses on denial),
  CSRF genuinely enforced, replay protection on the device pairing challenge/session ceremony is
  real (atomic consume-once via row locking), no error path echoes caller-supplied sensitive data,
  no crypto/payment-provider boundary was touched or weakened.
- **`OPEN_SECURITY_FINDINGS = 0`** as of the final pass.

## Validation (final, on `55523bb`)

| Platform | Result |
|---|---|
| Backend full suite | 2055/2055 (`npm test`, includes 16 previously-orphaned files now wired in) |
| Backend fresh-DB | 31/31 migrations apply from zero on a disposable MySQL 8.4 container; schema-privacy gate clean; migration 0033's DB tests (idempotency, family-scoping, boundary cases) 31/31 pass |
| Parent Web | typecheck clean, lint clean (0 warnings), build succeeds, 115 files / 705 tests pass |
| Platform Admin Web | 29 files / 141 tests pass (untouched this session, confirmed clean) |
| Android | full JVM suite: 1297 tests, 0 failures, 0 errors, 1 pre-existing skip, `BUILD SUCCESSFUL` |
| iOS | static source review only (no Xcode/simulator/device in this Windows environment) — no source-level gaps found beyond the already-registered N9 |

No real-browser (Chromium/Playwright) sweep was performed this session — all frontend evidence
above is unit/integration-level. This is disclosed, not silently skipped.

## Documentation

- `docs/pre-production/PCA_PARTIAL_INTENTIONAL_REGISTER.csv` — reconciled against real published
  commits, CSV syntax repaired (RFC4180, round-trip validated), no classification changed
  without new evidence.
- `docs/pre-production/PCA_NOT_STARTED_REGISTER.csv` — this mission's primary artifact, 22 rows,
  fully reconciled, standards-compliant CSV.
- `docs/pre-production/PCA_FINAL_SOURCE_CAPABILITY_MATRIX.csv` — final per-item classification
  snapshot (this report's companion file).
- Historical Stage-0 documents were not rewritten.

## Exit gates

```
NOT_STARTED_INITIAL_TOTAL = 16 (Wave 0 seed) + 6 found across later audits = 22

REPO_SOLVABLE_NOT_STARTED = 0
NOT_IMPLEMENTED_REPO_SOLVABLE = 0
MISSING_BACKEND_REPO_SOLVABLE = 0
MISSING_FRONTEND_REPO_SOLVABLE = 0
MISSING_RUNTIME_REPO_SOLVABLE = 0
MISSING_CONTRACT_REPO_SOLVABLE = 0
ORPHANED_REQUIRED_SOURCE = 0

OPEN_SECURITY_FINDINGS = 0
VALID_MUTATION_SURVIVORS = not separately mutation-tested this pass (targeted + regression +
  full-suite testing was performed for every change; no dedicated mutation-testing tool run)

BACKEND_FULL = PASS (2055/2055)
BACKEND_DB = PASS
PARENT_FULL = PASS (705/705)
PA_FULL = PASS (141/141)
ANDROID_SOURCE_TESTS = PASS (1297/1297, 1 pre-existing skip)
IOS_AVAILABLE_TESTS = static source review only, EXTERNAL (no macOS/Xcode/device)

main unchanged: f8d5a6f
```

`PCA_NOT_STARTED_COMPLETION = READY_FOR_PRE_PRODUCTION_RECONCILIATION`

This is not a declaration of production readiness, and `main` was never merged into.
