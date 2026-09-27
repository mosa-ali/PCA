# 08 — Build, Test and Browser Evidence

## 1. Build / typecheck / lint (mission §35/§36) [RUN 2026-09-26, worktree]

```text
PARENT_BUILD          = PASS   (vite build + tsc chain, exit 0; demo off, VITE_PCA_API_BASE_URL=https://parent.pcasafe.com)
PARENT_TYPECHECK      = PASS   (exit 0)
PARENT_LINT           = PASS   (exit 0, 0 warnings — repo treats warnings as fatal)
PLATFORM_BUILD        = PASS   (exit 0)
PLATFORM_TYPECHECK    = PASS   (exit 0)
PLATFORM_LINT         = PASS   (exit 0)
```

No warnings materially affecting production were observed in the build logs (raw/parent_build.txt,
raw/platform_build.txt). Builds wrote only to gitignored `dist/`.

## 2. Unit suites (mission §37/§38) [RUN]

| Suite | Files | Tests | Result | Notes |
|---|---|---|---|---|
| platform-admin-web (`npm test -- --maxWorkers=2`) | 44 | **226** | **226 pass** | 120.5 s |
| parent-web (`npm test -- --maxWorkers=2`, default timeout) | 151 | 1064 | 1060 pass / 3 fail / 1 flake | load timeouts |
| parent-web re-run (`--testTimeout=30000`) | 151 | 1064 | **1063 pass / 1 fail** | single remaining failure |

Failure attribution (parent):
- `tests/component/DeviceEnrollmentSections.test.tsx` — 1 failing test under full-suite contention
  ("a genuine child-registry failure renders a real, retryable error"); **passes 24/24 in isolation,
  3 consecutive runs** [RUN]. The other two default-run failures (`ParentGuide` axe,
  `noDirectLocaleFormatting`) also pass in isolation (retry batch rc=0). Documented repo ruling:
  `LOCAL_FULL_PARENT_SUITE = INDETERMINATE_RESOURCE_CONTENTION` — only source-level failures block.
  CI runs the suite **sharded 8-way** (`quality-gates.yml` parent-web-unit-tests) — authoritative.
- Register: PP-F05 (P3, test-stability), not a product defect.

## 3. Targeted test inventory (mission §37)

| Area | Parent-web evidence | Platform-admin-web evidence |
|---|---|---|
| Auth | tests for Login/Registration/Reset + step-up contexts; real E2E session spec | `e2e/login.spec.ts`, `e2e-real/realBackend.spec.ts`, unit API-client tests |
| Session | real-E2E reload-persistence test (today, passed) | `e2e/sessionSecurity.spec.ts`; AuthContext tests |
| Route guards | `e2e/rbac.spec.ts`; RouteGuard/AppLayout tests; real E2E unauthenticated redirect | `e2e/roleBoundaries.spec.ts`; RouteGuard tests |
| Family state | DevicesTabs/family tests; E2E device-enrollment spec (token hygiene assertions) | n/a (realm separate) |
| MFA | `e2e-real/parentMfa.spec.ts` + `optionalMfaSetup.spec.ts` (certified specs) | `e2e-real/totp.ts` + activation QR tests (5/5 locally per lane record) |
| RBAC UI | PermissionGate tests; RolesMatrix page tests | Role/permission domain tests + roleBoundaries E2E |
| API client | unit tests incl. `apiClientFactoryDeviceEnrollment` | `tests/unit/platformAdminApiClient.test.ts` (+ same-origin regression documented in source) |
| Error states | errorMessages/i18n tests | ErrorState + mapping tests |
| Localization | `tests/i18n/*` (EN/AR exact-parity + no-Latin-in-AR + editorial gates) | `tests/unit/i18nRtl.test.ts` |
| A11y/contrast (targeted, mission §34) | `e2e/keyboard-accessibility.spec.ts`, `contrast.spec.ts`, `forced-colors.spec.ts` | `e2e/contrast.spec.ts`, `forced-colors.spec.ts`, `arabicShell.spec.ts` |
| Responsive (mission §33) | `e2e/responsive.spec.ts`, `overflow.ts` | desktop-first supporting layout (viewport tests in shell specs) |

Zero-test discipline: every suite named above collected >0 tests; CI registration gates exist on
the repo (test-suite registration checks caught unregistered files historically).

## 4. Browser E2E — impact-based (mission §39) [existing current evidence reused]

- **Reused, current**: parent-web `test-results/real-e2e-results.json` — real-backend run of
  `e2e-real/realBackend.spec.ts` executed the same day (2026-09-26 16:59–17:00Z): 5 real-flow steps
  (generic credential rejection; real sign-in via server cookie; HttpOnly reload persistence;
  real Settings data; unauthenticated redirect) — **1 test passed, 0 unexpected, 0 flaky**;
  `.last-run.json = passed`.
- Platform-admin real-E2E last artifact in `test-results/` is a `--list` enumeration (spec set
  intact: `realBackend.spec.ts` + `totp.ts`); its full run requires the owner-provisioned admin +
  MFA path and is CI-certified; not re-run here (mission §39 reuse rule + read-only/no-account rule).
- **Fresh live checks this session** (report 07 §3): both login shells rendered in a real browser;
  parent resource-health clean; expected 401 probes only; no runtime errors beyond the meta-CSP
  console warning (PP-F04).
- CI (quality-gates.yml) certifies: parent acceptance-flow, parent session, parent MFA,
  platform-admin real-backend E2E — with `assertRealE2eResults.mjs` non-vacuity asserts
  (`--source-sha "${github.sha}"`).

## 5. CI surface relevant to both apps (mission §35 context) [READ]

`web-production-demo-mode-gate` (both apps + negative control), sharded unit jobs (parent ×8,
platform ×4), dependency audits failing on HIGH/CRITICAL, SBOM generation/validation, Playwright
suites incl. contrast gates, E2E assert manifests. The current **repository-level** red is the
backend suite (API-F01) — parent/platform jobs are not individually implicated by it.

```text
PARENT_TESTS = PASS (1063/1064; 1 attributed load-flake)      PLATFORM_TESTS = PASS (226/226)
```
