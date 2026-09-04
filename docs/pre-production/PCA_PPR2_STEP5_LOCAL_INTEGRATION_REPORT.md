# PCA PPR-2 — Step 5: Full Local Integration Validation

Runs entirely against `localhost` (Parent Web, Backend), a disposable local MySQL
instance (fallback `mysqld` binary, Docker unavailable this session), and Android's
local Gradle toolchain. No Azure, no DNS, no `pcasafe.com`, no production database —
all explicitly out of scope per the owner's directive and untouched.

## A. Chrome extension classification

`CHROME_PARENT_UAT = BLOCKED_EXTERNAL_TOOL`. Reproduced on the app's own routes AND on
`https://example.com` (a trivial static page, zero app code) — script injection never
recovered ("page never reaches document_idle") across a closed-and-reopened tab. No PCA
source was touched chasing this. Per the owner's rule, Playwright/real Chromium became
the primary automated browser evidence instead.

`PLAYWRIGHT_REAL_BROWSER = PASS` (see Section C).

## B. Privacy invariant — re-verified, not merely asserted

```
READABLE_CHILD_PERSONAL_DATA_CENTRAL = 0
READABLE_FAMILY_ACTIVITY_CENTRAL     = 0
PHOTOS_CENTRAL / VIDEOS_CENTRAL / FILES_CENTRAL / MESSAGES_CENTRAL = 0
BROWSING_HISTORY_CENTRAL / APP_USAGE_HISTORY_CENTRAL = 0
PRECISE_LOCATION_HISTORY_CENTRAL = 0
```

- `family_child_memberships` (the only new central table this wave): exactly
  `child_profile_id, family_id, creation_request_key, created_at` — re-confirmed against
  a live row this Step (`SELECT * FROM family_child_memberships` after a real Playwright
  child-creation), and via `noReadableChildFieldsRegression.test.mjs`'s DDL/source-token
  scan (Step 4, re-passing this Step).
- Camera/eye-distance feature (`android/app/src/main/java/org/pca/app/platform/proximity/`):
  `FaceProximityEstimator`'s own interface contract — "return within this single
  synchronous call and retain nothing afterward -- no frame, no landmark set, no face
  embedding/template may survive... never upload a frame, embedding, or landmark set to
  a network destination... report only a coarse ProximityReading (NEAR/FAR/UNKNOWN) --
  never a numeric distance." `CameraProximitySource` additionally enforces the
  foreground/permission lifecycle in code, not just docs (`currentObservation` never
  invokes the estimator unless both are true at that exact call). No network/upload/
  frame-persistence code exists anywhere in the proximity or eyedistance package trees
  (grepped for OkHttp/Retrofit/HttpURLConnection/file-write patterns — zero hits besides
  two comments stating the negative constraint explicitly).
- No photo/video/file/message collection path, no hidden browser/screen capture, no
  camera upload path exists anywhere touched by this wave (re-confirmed via the same
  grep sweep, and via Section D's real-browser network capture below).

## C. Step 5 acceptance flow — Playwright, real backend, all 15 items

Fresh MySQL 9.7 (`mysqld --initialize-insecure`, disposable datadir), migrated from
zero (`node scripts/migrate.mjs`, 34/34 applied including `0036_family_child_memberships.sql`),
seeded (`scripts/seed-local.mjs`), backend (`node dist/main.js`, `NODE_ENV=development`,
`localhost:4011`), Parent Web served via `playwright.real.config.ts`'s own documented
`webServer` (vite dev, `VITE_PCA_DEMO_MODE=false`, `VITE_E2E_REAL_PROXY_TARGET` +
`VITE_PCA_API_BASE_URL=""` — same-origin proxy, no CORS needed, matching that config's
own already-documented, already-tested pattern). New spec:
`parent-web/e2e-real/acceptance-flow.spec.ts`. Machine-readable evidence:
`parent-web/test-results/real-e2e-results.json` (`expected: 2, unexpected: 0, flaky: 0`).

Consolidated into 3 real logins total across 2 `describe` blocks (not 15 -- this
backend's `LOGIN_EMAIL_RATE_LIMIT`/`LOGIN_IP_RATE_LIMIT`, real anti-abuse controls, are
not a test-only inconvenience to route around; a fresh backend process was restarted
once mid-session specifically to reset the in-memory limiter after repeated dev-iteration
runs tripped it -- not a product issue).

| # | Requirement | Result |
|---|---|---|
| 1 | login | PASS -- real `/api/parent/login`, real cookie session |
| 2 | new family / zero children | PASS -- "Add your first child", never the old dead-end text |
| 3 | Add first child | PASS |
| 4 | create opaque child profile | PASS -- real `POST /v1/families/:id/children` → 201, body is exactly `{childProfileId, createdAt}`; verified against the live DB row directly |
| 5 | readable child label shown locally | PASS |
| 6 | Add Device | PASS -- through platform/protection/review |
| 7 | child selectable | PASS -- real, checked radio option after navigating back |
| 8 | Download App action visible | PASS |
| 9 | create invitation if resolved | **Real 403, not resolved** -- see Section E. Never mocked, never faked 201. |
| 10 | Arabic switch | PASS |
| 11 | RTL | PASS -- `dir="rtl"`, translated heading, label still resolved same-session |
| 12 | responsive/mobile widths | PASS -- 375px, no horizontal scroll |
| 13 | unauthorized role negative checks | PASS -- real cross-family: a second real account gets 403 on both LIST and CREATE against the first account's `familyId` |
| 14 | reload → setup-required expected | PASS -- `TRUSTED_BROWSER_RELOAD = SETUP_REQUIRED_EXPECTED`, re-confirmed after a real `page.reload()` |
| 15 | no raw UUID as primary UI | PASS -- asserted the opaque id is never page text; only the typed label renders |

**A genuine methodological trap found and fixed while writing this, not shipped broken:**
the session-local label store (H2) is, by design, invisible to a browser context that
didn't set it -- a `page.goto()` mid-flow (a hard navigation) or a fresh `test()` (a
fresh, isolated Playwright browser context) both correctly show the child as
"Child profile -- finish browser setup to view details," never the typed name, exactly
as the architecture requires. Two draft versions of this spec assumed the label would
persist across exactly those boundaries and failed -- correctly, since the app was
behaving as designed. Fixed by keeping the whole flow in one continuous session/page and
navigating via the wizard's own Back button rather than `page.goto`, matching how a real
parent would actually move through it and exactly matching Section 14's own, separate
hard-reload check.

## D. Real-browser security/privacy re-verification

- Network capture during the whole flow: the `POST /children` request body is `{}` (no
  idempotency key needed this run); the response is exactly `{childProfileId, createdAt}`.
  No `displayName` in either direction, confirmed on the wire, not just in source.
- `localStorage`/`sessionStorage`: unchanged from Step 4's finding (`childLabels.ts` never
  calls either API) -- not re-derived from scratch this Step given zero lines of that
  file changed since Step 4's dedicated audit.
- No central activity/history table exists (`family_child_memberships` remains the only
  new table; `SHOW TABLES` against the fresh migrated instance lists nothing else new).

## E. License / entitlement — re-derived a third time, same conclusion

`grep -rln "INSERT INTO licenses" backend/src` → zero results, re-confirmed on the exact
tree this Step ran. The real Playwright invitation-creation attempt (item 9 above)
against a real account with a real, freshly-created child returned **403**, verified
`{ error: 'forbidden' }` shown to the user as a real, visible alert -- never a hang,
never a fabricated success. Cross-checked against the DB: no `enrollment_invitations` row
exists with a `created_at` matching this test run's timestamp (the only 3 rows in the
fresh instance are seed-script fixtures from `seed-local.mjs`, already `EXPIRED`,
timestamped at seed time).

`LICENSE_ENTITLEMENT_STATUS = OWNER_DECISION_REQUIRED` (unchanged from Step 4's Part C).
Smallest concrete choice, unchanged: (A) `requiresLicense: false` for `CREATE_INVITATION`
(matches what `CREATE_CHILD_PROFILE`/`LIST_CHILD_PROFILES` already do), or (B) a real
bootstrap license writer (itself needing a decision on its trigger). Not decided here.

**`NEW_FAMILY_TO_DEVICE_ENROLLMENT` cannot be claimed `PASS`** -- invitation creation is
genuinely reachable end-to-end (routes, auth, oracle-safety, child binding, all real and
correct) but blocked by this one, already-classified, owner-decision-gated check. Every
other step of the flow, PASS.

## F. A real, previously-undiscovered gap found and fixed this Step

`parent-web/e2e/device-enrollment.spec.ts` (the EXISTING fixture/demo-mode Playwright
suite, `playwright.config.ts`, separate from Section C's real-backend spec) assumed a
pre-populated child registry -- a holdover from before Step 2's `getDashboard()` →
`listChildProfiles()` rewrite, never caught because it lives outside `vitest`'s
`tests/**` glob and this session had not run the fixture-mode Playwright suite until
Step 5. 4 of 6 tests in that file failed for exactly the same root cause already fixed
in `tests/**` back in Steps 2-3 (an empty-by-default dev registry).

**Fixed at the source, not the test:** `DevChildProfileClient`'s default (pre-reset)
state now seeds the same two children (`child-amir`/`child-lina`, `dev-family-1`) the
old `DEV_CHILDREN` fixture always provided, restoring parity for every demo-mode consumer
that assumes a populated registry on first load. `client.ts`'s `buildDevClients()` seeds
their session-local labels the same way a real create flow would. Every `vitest` test
that needs a genuinely empty registry already calls `__resetDevChildProfileState()` in
its own `beforeEach` (confirmed unaffected: `AddChildFlow.test.tsx` and
`ChildLabelsSessionStore.test.ts` re-run clean after the change). Re-ran
`device-enrollment.spec.ts`: 6/6 pass, serially and under the suite's normal
`fullyParallel` mode.

**Two further failures in that same full-suite run were investigated and classified as
pre-existing, unrelated to any PPR-2 Step:** `offline-sync.spec.ts` (dashboard
offline-device-status display) and `rbac.spec.ts` (export step-up re-authentication
dialog) both fail consistently, serially, both before and after the fix above. Neither
file, nor any file either exercises (`Dashboard.tsx`'s device-status path, the step-up
dialog, `/security/trusted-browser`), was touched anywhere in this session's `git status`
across Steps 1-5. `billing.spec.ts`'s 7 failures in the first full-suite run were
confirmed a `fullyParallel`/host-load concurrency flake specifically -- re-run serially
and in isolation, all 7 pass.

## G. Full suites — exact results

**Backend**
- Non-DB (`node scripts/run-tests.mjs`): **2183/2183 pass** (unchanged count from Step 1/4).
- DB integration (`npm run test:db`, fresh MySQL, migrated from zero via `verify-mysql.mjs`'s
  own from-zero schema gate): **473/483 pass, 6 fail, 4 skip** -- identical to Step 4's
  result; all 6 are the same, already-classified `PRE_EXISTING_TEST_INFRA_ARTIFACT_NOT_PPR2`
  findings (host-timezone-dependent expiry tests; a `repository.create`/`createAtomically`
  naming drift in unrelated family-*member* invitation tests). New this Step:
  `childProfileInvitationBindingHttp.mysql.test.mjs` (Step 4's new file) included and passing.
- `tsc --noEmit`: clean.

**Parent Web**
- `tsc --noEmit`: clean.
- `eslint . --max-warnings=0`: clean.
- `npm run build` (production): succeeds, PWA precache generated, no new warnings beyond
  the pre-existing chunk-size advisory.
- Full unit suite (137 files, vitest, `--maxWorkers=2`, sharded 10×): **996/996 pass**, 0 failures.
- Real Chromium E2E (Section C): 2/2 pass, JSON evidence file present.
- Fixture-mode E2E (`playwright.config.ts`, full suite incl. RTL/responsive specs):
  **57/68 pass** on first run (concurrency flakes); **all previously-failing tests
  re-run in isolation/serially resolve to 3 pre-existing-unrelated failures** (Section F) —
  every PPR-2-attributable failure (`device-enrollment.spec.ts`) fixed and verified 6/6.

**Platform Admin**
- Zero files touched anywhere in this wave (`git status` confirmed empty for the whole
  directory across Steps 1-5). `tsc --noEmit`: clean (confirms no shared-contract
  breakage from backend changes). Full suite not re-run given zero code change and a
  clean typecheck against this session's backend contract changes; `AFFECTED_SCOPE = NONE`.

**Android**
- Full JVM suite (`./gradlew clean testDebugUnitTest`): **1345/1345 pass, 0 failures, 0
  errors** (summed directly from the generated JUnit XML reports), including the
  breakshield/eyedistance camera-lifecycle tests.
- `assembleDebug`: BUILD SUCCESSFUL.
- `lintDebug`: BUILD SUCCESSFUL, 0 issues in the generated lint report.
- (An initial `testDebugUnitTest` attempt failed with a KSP `StreamCorruptedException` --
  a corrupted incremental-build cache from an earlier interrupted background invocation,
  not a code defect; resolved with `./gradlew --stop` + a clean rebuild, which then
  passed outright.)

**iOS**
- Zero files touched anywhere in this wave. `AVAILABLE_CHECKS_ONLY` -- no real-device
  claim made or implied; nothing to re-run given zero code change.

## H. Final localhost exit checklist

```
REPO_SOLVABLE_OPEN                  = 0
OPEN_SECURITY_FINDINGS              = 0
VALID_MUTATION_SURVIVORS            = 0
COPY_AUDIT_REMAINING_OPEN           = 0
CENTRAL_READABLE_CHILD_FIELDS       = 0
READABLE_CHILD_PERSONAL_DATA_CENTRAL = 0

OPAQUE_CHILD_CREATE                 = PASS
OPAQUE_CHILD_LIST                   = PASS
INVITATION_REQUIRES_EXISTING_CHILD  = PASS

NEW_FAMILY_SESSION_FLOW             = PASS   -- items 1-8, 10-15 of Section C
NEW_FAMILY_TO_DEVICE_ENROLLMENT     = NOT_YET -- blocked ONLY by the explicitly
                                                 classified LICENSE_ENTITLEMENT_STATUS
                                                 (item 9); every other step PASS

VIEW_DEVICE_ENROLLMENT_SCOPE        = PASS

PARENT_REAL_E2E                     = PASS   -- Section C, JSON evidence committed
PA_REAL_E2E                         = NOT_RUN -- AFFECTED_SCOPE = NONE (Section G)
ANDROID_FULL                        = PASS   -- Section G

CHROME_PARENT_UAT                   = BLOCKED_EXTERNAL_TOOL
PLAYWRIGHT_REAL_BROWSER             = PASS

TRUSTED_BROWSER_RELOAD              = SETUP_REQUIRED_EXPECTED

LICENSE_ENTITLEMENT_STATUS          = OWNER_DECISION_REQUIRED (unresolved, explicitly classified)
```

Every metric the owner required is either `PASS`/`0` or an explicitly named, non-hidden
exception (`LICENSE_ENTITLEMENT_STATUS`, `CHROME_PARENT_UAT`, `PA_REAL_E2E` = not run for
a stated, verified reason). `NEW_FAMILY_TO_DEVICE_ENROLLMENT` stays `NOT_YET`, not `PASS`
-- consistent with H4's original rule and re-confirmed against a real backend this Step,
not asserted from Step 4's evidence alone.

Working tree, commit, and push status: see
`docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md` Part L for the reconciliation and
final disposition.
