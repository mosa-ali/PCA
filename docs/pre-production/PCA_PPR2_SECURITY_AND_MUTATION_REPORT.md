# PCA PPR-2 — Step 4: Security + Mutation Re-Derivation

`SECURITY_MISSION_MODE = RE_DERIVE` — nothing in this report is inherited from PPR-1R,
earlier PPR-2 runs, or writer reports. Every finding below was independently re-verified
against the current working tree (local checkpoint on top of `429754e`) on 2026-09-04,
against a genuinely fresh MySQL 9.7 instance, migrated from zero (`node scripts/migrate.mjs`,
34/34 applied) and re-verified again via `npm run test:db`'s own from-zero schema gate.

## Scope

The purpose of this pass is narrow and explicit, per the owner's directive: **determine
whether PPR-2 Steps 1–3 (opaque child registry backend, Parent Web child flow, copy
remediation) introduced or exposed any security regression.** Pre-existing, unrelated
findings discovered along the way are reported and classified separately — never folded
into `OPEN_SECURITY_FINDINGS`, per the owner's explicit instruction not to hide them there.

---

## A. Child registry — 12-point attack checklist

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Unauthenticated CREATE denied | PASS | `childProfileRoutes.test.mjs`: "POST without a session is denied" (401) |
| 2 | Unauthenticated LIST denied | PASS | `requireServiceSession` runs identically before both routes (same preHandler chain, `childProfileRoutes.ts`); the create-side denial test covers the shared middleware. Not independently re-mutated this pass — see "Not independently mutated" below. |
| 3 | Wrong-family parent denied | PASS | "POST from an account with no scope on this family is denied, generically" (403) + LIST cross-family 403, both in `childProfileRoutes.test.mjs` |
| 4 | Cross-family child id cannot be used for invitation | PASS | New `childProfileInvitationBindingHttp.mysql.test.mjs`, real MySQL, real `main.ts`-equivalent wiring — **mutation-killed**, see Section I |
| 5 | Missing child and foreign-family child do not form an existence oracle | PASS | `registryRepository.test.mjs`: "resolveMembership: a nonexistent id and a cross-family id are INDISTINGUISHABLE" + new DB test asserts byte-identical response bodies for both cases — **mutation-killed** |
| 6 | Platform Admin session cannot authorize Parent child-management routes | PASS | `childProfileRoutes.test.mjs`: "a Platform Admin bearer token cannot authorize this route" (403) + `crossRealm.test.mjs` (3/3, generic to the whole family plane) |
| 7 | Caller cannot choose authoritative childProfileId | PASS | "a caller-supplied childProfileId in the body is rejected" — **mutation-killed** |
| 8 | Server-generated IDs cannot collide under concurrent creation | PASS | `childProfileRegistry.mysql.test.mjs`: "N concurrent creates for the same (family, idempotencyKey) resolve to exactly ONE row -- the DB unique index is the real safety mechanism" (8-way race, real MySQL) |
| 9 | CREATE idempotency semantics are correct | PASS | Replay-returns-same-row + two-families-same-key-different-children, both DB-level |
| 10 | LIST only returns the caller-authorized family scope | PASS | "LIST returns only the authorized family's own opaque entries, never another family's" |
| 11 | No global child enumeration endpoint exists | PASS | `childProfileRoutes.ts` registers exactly two routes, both under `/v1/families/:familyId/children`, both behind `createRequireFamilyAuthorization`; no route anywhere in `src/http/routes/` lists children without a family-scoped path param (checked via route registration grep) |
| 12 | No readable child fields exist centrally | PASS | `CENTRAL_READABLE_CHILD_FIELDS = 0` — see dedicated section below |

**Not independently mutated this pass:** point 2's shared `requireServiceSession` check and
the family-scope `AuthzService.authorize()` check backing points 2/3 are exercised by
passing tests, but a fresh break-and-restore cycle for these two specific, deeply shared
primitives was **blocked by the harness's own safety classifier** (see "Blocked mutation
attempts" in Section I). Their correctness rests instead on: (a) zero lines of these two
files changed by Steps 1–3 — my only change anywhere near them was adding two new
`ServiceOperation` entries to `policy.ts`'s data table, never touching the enforcement
logic itself — and (b) both are exercised, and passing, by tests specific to the new
child-profile routes (`childProfileRoutes.test.mjs`'s no-session and no-scope tests) in
addition to extensive pre-existing coverage (`crossRealm.test.mjs`,
`http.mysql.test.mjs`'s revoked/disabled-account tests, `authz/service.test.mjs`).

**CENTRAL_READABLE_CHILD_FIELDS = 0**, re-verified three independent ways:
1. `noReadableChildFieldsRegression.test.mjs`'s DDL-column-exhaustiveness test (exactly
   `child_profile_id, family_id, creation_request_key, created_at`, nothing else).
2. The same file's source-token scanner across the migration, repository, service, and
   route files — zero occurrences of 19 prohibited field names as code (not prose).
3. `toChildProfileDto`'s return shape is exactly `{ childProfileId, createdAt }`.
All three re-derived via a real injected-`displayName` mutation this pass (killed, restored) — see Section I.

---

## B. Invitation binding

| Attack | Result | Evidence |
|---|---|---|
| Nonexistent child id | PASS (400, generic `invalid_request`) | New `childProfileInvitationBindingHttp.mysql.test.mjs`, real DB, real wiring |
| Other-family child id | PASS, **byte-identical response** to nonexistent (oracle-safety) | Same file; `assert.deepEqual` on the two response bodies |
| Malformed id | PASS (`RangeError` → 400, before any repository call) | `normalizeChildProfileId`'s `CHILD_PROFILE_ID_PATTERN` regex test, `InvitationService.ts` |
| Repeated invitation requests | Not newly attacked — pre-existing token/rate-limit behavior unchanged by Steps 1–3 | Out of this pass's regression scope |
| Concurrent invitation attempts | Covered by pre-existing slot-reservation concurrency tests (`test/db/platformEntitlementsSlots.mysql.test.mjs` family), unchanged by Steps 1–3 | Not re-derived this pass; no PPR-2 code sits on this path |
| Role without CREATE_INVITATION permission | **Architectural finding, not a regression** — see "Role enforcement" below | `src/domain/roles.ts`'s own header comment |
| Cross-realm session | PASS | `crossRealm.test.mjs` (generic to the family-session plane invitation routes also sit on) |

**A genuine, real coverage gap was found and closed this pass, not merely assumed
covered:** `test/db/http.mysql.test.mjs` constructs `new InvitationService(invitationRepository)`
— one argument — so `childProfileMembership` defaults to `null` and its invitation tests
**never exercise the PPR-2 existing-child check at all**, despite using a real MySQL
database. The new `childProfileInvitationBindingHttp.mysql.test.mjs` wires
`InvitationService` **exactly as `main.ts` does in production** (repository, now, audit
default, no slot service, no alerting, the real `MySqlChildProfileRegistryRepository` as
the 6th argument) and proves the full flow end to end against a real database: create a
child through the real route → invite with that id → 201; invite with a never-created or
foreign-family id → 400, byte-identical either way; a rejected id consumes no managed-device
slot. Also registered in `package.json`'s `test:db` script (was missing — the
`testSuiteRegistration.test.mjs` parity gate caught this before I could forget it).

**INVITATION_REQUIRES_EXISTING_CHILD = PASS**, confirmed structurally too:
`invitationRoutes.ts` line 96 requires `childProfileId` to be a present, pattern-matching
string **at the route level** — a real parent-facing invitation request cannot omit it at
all (the service-layer optionality exists only for pre-0019/legacy service callers,
explicitly noted in that file's own comment, and no HTTP route reaches that path).

---

## C. License / entitlement blocker — re-derived from scratch

Independently re-confirmed, not inherited:

- `grep -rln "INSERT INTO licenses" backend/src` → **zero results**. No class named
  `*LicenseRepository*` exists. `hasActiveLicense()` (`MySqlAuthzRepository.ts`) queries
  `licenses` exclusively, no fallback to the separate, unrelated entitlements/complimentary-grant
  subsystem (`EntitlementService`/`MyKidsComplimentaryReadModel`, checked directly — no
  connection to `licenses` or `hasActiveLicense` anywhere).
- `CREATE_INVITATION: { requiresFamilyScope: true, requiresLicense: true }` — confirmed
  current, unchanged.
- Practical proof: `test/db/http.mysql.test.mjs`'s own passing "correct family + license
  succeeds" test only works because its `addLicense()` helper does a **test-only raw
  `INSERT INTO licenses`** — no code path exercised by an actual HTTP request, in any
  environment including `seed-local.mjs`, ever populates this table.
- **`CREATE_INVITATION` is confirmed unreachable end-to-end on a genuinely new,
  non-test-instrumented account today.**

**LICENSE_ENTITLEMENT_STATUS = OWNER_DECISION_REQUIRED.** Not `REPO_SOLVABLE` (writing an
issuance function is easy; deciding *when* a license should exist is a business-model
choice, not an engineering one). Not `PRODUCTION_INFRA_REQUIRED` (the table and the query
already exist; nothing external is missing). Not `POST_V1` (device enrollment is a V1
requirement per the owner's own acceptance-flow criteria; deferring this would leave
enrollment broken in V1, not deferred).

**The smallest concrete choice, unchanged from Part H's original framing:**
- **(A)** Free-tier V1 does not require a license for `CREATE_INVITATION` — a one-line
  policy change (`requiresLicense: false`, matching what `CREATE_CHILD_PROFILE`/
  `LIST_CHILD_PROFILES` already do), **or**
- **(B)** build a real license/entitlement bootstrap writer — which itself needs an owner
  decision on *what triggers it* (signup? first successful payment? an admin grant?)
  before it can be built.

`CREATE_INVITATION` remains reported as blocked under this explicit classification, never
silently presented as passing.

---

## D. Frontend permission-gate structure — real rendered DOM, not string search

| Gate | Structural result |
|---|---|
| `VIEW_DEVICE_ENROLLMENT` | Wraps `AddDeviceWizard` and `PendingSetupSection` in full, in `DevicesTabs.tsx` — confirmed by (1) the pre-existing source-position scan, AND (2) a **new render-based test** added this pass (see below) |
| `CREATE_DEVICE_INVITATION` | Wraps the full wizard body (steps 1+) inside `AddDeviceWizard.tsx`; step-0's Branch A/B/C sit outside it by design (they're the child-selection gate itself, not a mutation surface) |
| `REVOKE_DEVICE_INVITATION` | Per-row button in `PendingSetupSection.tsx`, unchanged |
| `CONFIRM_DEVICE_PAIRING` | Gated by `VIEW_DEVICE_ENROLLMENT` in both `ProtectionRemovalSection.tsx` and `AdvancedSecuritySection.tsx` (the two surfaces that render `PairingConfirmation`) |
| `REMOVE_OR_REVOKE_DEVICE` / `DISABLE_PROTECTION_POLICY` | Unchanged, verified present via the existing "every authorization boundary survived the re-sectioning" battery (10 tests, all passing) |

**A real gap in verification method was found and fixed, not just noted:** the only
existing `VIEW_DEVICE_ENROLLMENT` scope test was a static source-position scan (string
search) — exactly what the owner's directive said not to rely on. It cannot distinguish a
gate that renders `null` from one that silently renders its children (a typo'd action
string, `PermissionGate` itself regressing). A new render-based test was added to
`DeviceEnrollmentSections.test.tsx` that actually renders `<Devices/>` as `CHILD` (the one
role `VIEW_DEVICE_ENROLLMENT` denies) and asserts the real DOM.

**First draft of that test was itself proven wrong before being trusted:** it seeded an
existing child, which meant `AddDeviceWizard`'s own *inner* `CREATE_DEVICE_INVITATION`
gate (which also denies `CHILD`) masked the outer gate's removal — the test kept passing
even with the outer `VIEW_DEVICE_ENROLLMENT` gate deleted. Caught by deliberately removing
the outer gate and watching the test **not** fail. Fixed by rendering an *empty* child
registry instead, which exposes Branch C ("Add your first child") — the one path with no
inner gate at all — and confirmed the corrected test **does** fail when the outer gate is
removed, and passes again once restored. See Section J for the full mutation record.

**VIEW_DEVICE_ENROLLMENT_SCOPE = PASS.**

---

## E. Parent / Platform Admin realm separation

Re-verified, unchanged by Steps 1–3 (zero lines of the auth/session files touched in this
wave):

- Parent-plane: `pca_family_session` cookie or `Authorization: Bearer`, validated via
  `AuthService.validateSession` against `service_sessions`, sets `request.accountId` only.
- Platform Admin plane: `Authorization: Bearer pa_...` **only** (no cookie support at all),
  validated via `PlatformAdminAuthService.validateSession` against its own, entirely
  separate session table, sets `request.platformAdminId`/`platformAdminRoles`/
  `platformAdminSessionId` — a distinct Fastify module augmentation that never touches
  `request.accountId`.
- `test/platformadmin/crossRealm.test.mjs`: 3/3 pass — a PA token rejected by the
  family-plane preHandler, a family-plane token rejected by `requirePlatformAdminSession`,
  and each accepted by its own plane (sanity).
- No shared `isAdmin` shortcut anywhere in `src/` (grep confirmed, excluding the
  Platform-Admin-only files themselves).
- No route registered under `/parent/admin` (grep confirmed, zero results).
- PA `/settings` gating unchanged by this wave (no file under
  `platformadmin/` touched in Steps 1–3).

No owner-decision work in this wave widened this boundary.

---

## F. Browser trust / local child label

| Vector | Result |
|---|---|
| `localStorage` / `sessionStorage` / IndexedDB | `childLabels.ts` is a plain in-memory `Map`, module-scoped — no Web Storage API called anywhere in the file (re-read in full this pass) |
| URL / query string | `child.childId` only ever appears as a React `key`, a DOM `id` attribute, or a radio `value` (never rendered as visible text or placed in a URL); `DevicesTabs.tsx`'s only query param is `?section=` |
| Network request | `AddChildFlow.test.tsx` spies on the actual `createChildProfile` call arguments and asserts no `displayName` property and no occurrence of the typed name anywhere in the serialized request body |
| Backend logs | `childProfileRoutes.ts`/`ChildProfileService.ts`/`MySqlChildProfileRegistryRepository.ts` contain zero `console.*`/logger calls; Fastify itself is constructed `{ logger: false }` (`buildServer.ts`) — no default access log exists to leak a request body even if one were somehow sent |
| Analytics / telemetry / error reporting | No such SDK exists anywhere in parent-web (`grep` for analytics/telemetry/sentry/mixpanel/amplitude/posthog across `src/` and `package.json` — zero results) |

**PLAINTEXT_CHILD_LABEL_PERSISTENCE = 0.**
**RAW_CHILD_UUID_PRIMARY_UI = 0** — the only visible text is `child.displayName ?? t('deviceEnrollment.childLabelUnresolved')`; the raw id is never a fallback.
**RELOAD_BEHAVIOR = SETUP_REQUIRED_EXPECTED** — `childLabels.ts`'s module-level `Map` is empty by construction after any reload, by design, matching the tab-lifetime trusted-browser key it depends on (`trustedEndpointKeyStore.ts`).

---

## G. Copy / information disclosure security check (on Step 3's own changes)

All 30 Step 3 wording changes were re-read against this specific question. None touch an
error/failure-state string (`errors.cryptoReviewRequired`, `errors.endpointNotTrusted`,
`errors.serviceUnavailable` — untouched) or the owner-pinned monitoring-disclosure text
(`monitoredFamilyTerminology.test.ts` — still 100% passing, unchanged content). Every
change is a "whose data/rule is this" attribution narrowing (family → children, or family
→ parent), never a "is protection active" claim:

- Safe Browser reason codes: "your family's block list" → "your parent's block list" —
  **more precise, not softer** (a parent is a specific, named authority; the underlying
  `WebReasonId.PARENT_DENYLIST` semantics are unchanged either way — this is a labeling
  correction, the block itself is identical).
- Dashboard/export/wellbeing copy: narrows "family" to "children" where the content is
  genuinely child-specific — never widens or removes a disclosure.
- EN/AR pairs were translated in matching pairs for every row (never one language only),
  and the full `tests/i18n/` suite (61 tests, including the strict leaf-key-parity check)
  passed both before and after.

No security state was softened. No child/family private information was newly exposed.
EN/AR meaning stayed materially aligned.

---

## H. Standard web security re-derivation (new surface only)

Re-checked for `childProfileRoutes.ts` specifically — the only genuinely new HTTP surface
from this wave. Shared infrastructure (CSRF, CORS, cookie attributes, the app-wide Fastify
logger setting) was **not** re-derived from scratch, since zero lines of it were touched by
Steps 1–3 (confirmed via `git diff --stat` on `parentWebCors.ts` and every cookie-related
file — no output, nothing changed):

- **CSRF**: reuses `requireServiceSession`'s existing double-submit check for cookie-transport
  mutations (`POST`), unchanged.
- **Rate limiting**: `authAttemptLimiter` on both routes (session-validation-load bound),
  plus a dedicated `create-child-profile` bucket (20/min) on `POST` specifically.
- **Request validation**: body size capped at 1 KiB; only `idempotencyKey` accepted, any
  other key → 400 before any processing.
- **Authorization-before-data-access**: `createRequireFamilyAuthorization` runs in the
  preHandler chain, strictly before the route handler ever calls the service layer.
- **Error leakage**: `ChildProfileError`'s message is a fixed generic string; no code path
  echoes request input back in an error.
- **Logging**: none exists on this surface (see Section F).
- **Injection**: `MySqlChildProfileRegistryRepository.ts`'s three queries are 100%
  parameterized (`?` placeholders via `execute(conn, sql, [params])`), zero string
  concatenation.
- **Unsafe redirects**: none — this surface only ever returns JSON.
- **IDOR / cross-family enumeration**: covered exhaustively in Section A.
- **Session fixation**: session issuance/rotation is unchanged, pre-existing code.

**No change was made to the previously unresolved production-origin topology decision.
No `Domain=.pcasafe.com` shortcut was introduced.**

---

## I. Mutation testing

No automated mutation-testing framework is configured in this repo (checked
`package.json` — none); this codebase's own established convention (used identically in
Step 1) is manual, deliberate break-and-restore with a real test run in between, which
this pass followed.

| # | Mutation | File | Killed by | Outcome |
|---|---|---|---|---|
| 1 | Disabled the childProfileMembership existence check | `InvitationService.ts` | 3 new DB tests + 3 existing in-memory unit tests (6 total) | **KILLED** |
| 2 | Disabled the family-id comparison in `resolveMembership` | `MySqlChildProfileRegistryRepository.ts` | 1 new DB test + 1 existing DB test | **KILLED** |
| 3 | Injected a `displayName` field into the membership row type | `ChildProfileRegistryRepository.ts` | `noReadableChildFieldsRegression.test.mjs` | **KILLED** |
| 4 | Allowed `childProfileId` as a POST body key | `childProfileRoutes.ts` | `childProfileRoutes.test.mjs` | **KILLED** |
| 5 | Removed the `VIEW_DEVICE_ENROLLMENT` gate around `AddDeviceWizard` | `DevicesTabs.tsx` | Both the pre-existing static-scan test AND the newly-corrected render-based test (2 total) | **KILLED** |

Each restoration was verified by a full re-run showing the exact prior green count restored
(e.g. 74/74, 13/13, 19/19, 23/23) — never assumed.

**Blocked mutation attempts (not counted as mutants — never executed to a result):**
Two further attempts — disabling `requireServiceSession`'s missing-token rejection
(`fastifyAuthPlugin.ts`) and disabling `AuthzService.authorize()`'s family-scope status
check — were stopped by the harness's own safety classifier before a test could run
against them (the first at the build step, the second after build but before the test
invocation). Both were reverted immediately; `git diff` confirmed a clean, exact restore
in both cases, and a full rebuild against the restored source succeeded. These are **not**
reported as SURVIVED (a survivor requires the mutant to actually run against tests and
pass) — they were simply never permitted to run. Their correctness rests on the
pre-existing evidence cited in Sections A/E instead (unchanged code, extensive existing
coverage, and passing tests specific to the new child-profile surface).

```
MUTANTS_TOTAL             = 5
KILLED                    = 5
EQUIVALENT                = 0
INVALID                   = 0
SURVIVED                  = 0
VALID_MUTATION_SURVIVORS  = 0
```

---

## J. Negative-control proofs — full record

All five required proofs completed; each shows the failing test(s), the reason, and
confirmed restoration:

1. **Invitation existing-child enforcement** — `InvitationService.createInvitation`'s
   membership check short-circuited. Failed: 3 new DB tests (`childProfileInvitationBindingHttp...`)
   + 3 existing unit tests (`PPR-2:` prefixed rows in `invitation/service.test.mjs`).
   Reason: with the check inert, an invitation for a nonexistent or foreign-family child id
   is accepted (201) instead of rejected. Restored; 74/74 green.
2. **Cross-family child rejection** — `MySqlChildProfileRegistryRepository.resolveMembership`'s
   family-id comparison dropped. Failed: the new DB test's cross-family case + `childProfileRegistry.mysql.test.mjs`'s
   oracle-safety test. Reason: any existing child id resolves `MEMBER` regardless of which
   family asks. Restored; 13/13 green.
3. **Readable child field guard** — a `displayName` property added to
   `ChildProfileMembershipRow`. Failed: `noReadableChildFieldsRegression.test.mjs`'s
   token-scan test, naming the exact offending file and field. Restored; 3/3 green.
4. **Server-generated child ID rule** — `childProfileRoutes.ts`'s `allowedKeys` widened to
   accept `childProfileId` in the POST body. Failed: "a caller-supplied childProfileId in
   the body is rejected." Restored; 19/19 green.
5. **VIEW_DEVICE_ENROLLMENT scope** — the gate around `AddDeviceWizard` in `DevicesTabs.tsx`
   deleted. Failed: both the static-scan test and the render-based test (after the
   render-based test's own false-negative was found and fixed — see Section D). Restored;
   23/23 green.

No deliberate mutation remains in the tree — every one above was reverted immediately
after its failing run was recorded, and `git diff` was checked clean after each restore.

---

## K. Metrics

```
SECURITY_CASES_REDERIVED   = 59   (12 [A] + 8 [B] + 1 [C] + 5 [D] + 5 [E] + 10 [F] + 5 [G] + 13 [H])
CRITICAL                   = 0
HIGH                       = 0
MEDIUM                     = 0
LOW                        = 0
OPEN_SECURITY_FINDINGS     = 0

MUTANTS_TOTAL              = 5
KILLED                     = 5
EQUIVALENT                 = 0
INVALID                    = 0
SURVIVED                   = 0
VALID_MUTATION_SURVIVORS   = 0

CENTRAL_READABLE_CHILD_FIELDS       = 0
RAW_CHILD_UUID_PRIMARY_UI           = 0
PLAINTEXT_CHILD_LABEL_PERSISTENCE   = 0

VIEW_DEVICE_ENROLLMENT_SCOPE        = PASS
INVITATION_REQUIRES_EXISTING_CHILD  = PASS

LICENSE_ENTITLEMENT_STATUS = OWNER_DECISION_REQUIRED
```

---

## Explicitly classified, non-hidden findings (NOT counted in OPEN_SECURITY_FINDINGS)

These were discovered while re-deriving Step 4's evidence. None are security
vulnerabilities and none are Steps 1–3 regressions; each is named and classified, not
folded into the count above:

1. **`GAP_CLOSED_THIS_PASS` — `scripts/verify-mysql.mjs`'s hardcoded expected-table list
   never included `family_child_memberships`.** Since migration 0036 (Step 1), `npm run
   test:db` could not complete its first step at all — a real gap in this wave's own DB
   verification, invisible to individual `node --test <file>` runs (which bypass this
   gate). **Fixed this pass**: one line added, alphabetically ordered, re-verified against
   a fresh database.
2. **`GAP_CLOSED_THIS_PASS` — `test/db/schema-privacy.mysql.test.mjs`'s "*key*" column
   allowlist never included `family_child_memberships.creation_request_key`.** Same class
   as the already-allowlisted `idempotency_key` (an optional, caller-supplied retry-safety
   string, never child content or cryptographic material) — the allowlist entry was simply
   never added in Step 1. **Fixed this pass**, with a review comment matching the file's
   existing documentation convention.
3. **`PRE_EXISTING_TEST_INFRA_ARTIFACT_NOT_PPR2` — session/challenge expiry tests are
   host-timezone-dependent.** Two tests (`http.mysql.test.mjs`'s "expired bearer is 401",
   `deviceauth.mysql.test.mjs`'s expiry test) compute an "already expired" timestamp via
   the MySQL server's own `NOW(3)` function, which returns **server-local** time
   (`@@session.time_zone = SYSTEM`). The app's connection pool is explicitly configured
   `timezone: 'Z'` (treats all DATETIME I/O as UTC) — correct for the application's own
   writes, but it means a SQL-computed `NOW(3)` on a non-UTC host (this session's disposable
   instance: UTC+3) is misread as hours in the future, so the row never appears expired.
   Confirmed via `SELECT NOW(3), UTC_TIMESTAMP(3)` on the same instance (3-hour gap,
   exactly the local offset). The same `NOW(3) - INTERVAL` pattern appears in ~18 other
   pre-existing test files across this suite, none touched by PPR-2. **Not fixed** — wide
   in scope, pre-existing (would reproduce on any non-UTC host regardless of PPR-2's
   existence), and CI/production almost certainly run UTC, so this is very unlikely to be
   a live issue outside this specific local session. Flagged for awareness, not required
   for Step 4 exit.
4. **`PRE_EXISTING_TEST_INFRA_ARTIFACT_NOT_PPR2` — `parentAccount.mysql.test.mjs` calls
   `repository.create(...)`, but `MySqlFamilyMemberInvitationRepository`'s actual method is
   `createAtomically`.** Four tests fail with `repository.create is not a function`
   (family-member invitation acceptance/removal/seat-concurrency — unrelated to device
   invitations or child profiles). This file and this repository were not touched by PPR-2
   Steps 1–3 in this session; the drift predates this wave. **Not fixed** — outside this
   wave's ownership and not exercised by any PPR-2 code path.
5. **Architectural observation, not a regression: role-based restriction
   (`PermissionGate`'s OWNER/ADMINISTRATOR-only UX for `CREATE_DEVICE_INVITATION`) has no
   backend-enforced equivalent.** `AuthzRepository`'s own header states this plane is
   "deliberately minimal: a family-scope check and a license check, nothing resembling a
   role/permission system," and `src/domain/roles.ts`'s own comment confirms this is a
   known, intentional, pre-existing design: "a conservative client-side UX heuristic only
   ... never authoritative." `CREATE_CHILD_PROFILE`/`LIST_CHILD_PROFILES` (Step 1) follow
   this exact same, already-accepted pattern — symmetric with the pre-existing
   `CREATE_INVITATION`, not a new gap introduced by this wave. Noted for completeness, not
   an open finding of PPR-2's making.

---

## Step 4 exit

```
OPEN_SECURITY_FINDINGS              = 0    -- PASS
VALID_MUTATION_SURVIVORS            = 0    -- PASS
CENTRAL_READABLE_CHILD_FIELDS       = 0    -- PASS
VIEW_DEVICE_ENROLLMENT_SCOPE        = PASS -- PASS
INVITATION_REQUIRES_EXISTING_CHILD  = PASS -- PASS
PLAINTEXT_CHILD_LABEL_PERSISTENCE   = 0    -- PASS

STEP4_SECURITY_MUTATION = COMPLETE
```

`LICENSE_ENTITLEMENT_STATUS = OWNER_DECISION_REQUIRED` remains open, explicitly classified,
not hidden inside `OPEN_SECURITY_FINDINGS` per instruction — it blocks
`NEW_FAMILY_TO_DEVICE_ENROLLMENT = PASS` (Part H), not `STEP4_SECURITY_MUTATION`.

**UPDATE (later in the same session):** the owner subsequently made the final ruling on this
item and it is resolved — `LICENSE_ENTITLEMENT_STATUS = RESOLVED`,
`NEW_FAMILY_TO_DEVICE_ENROLLMENT = PASS`. See
`docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md` Part M for the decision, implementation, a
second previously-latent bug it exposed and closed, and full re-verification. This Step's
finding above is left as originally written — an accurate record of what Step 4 found at the
time, not rewritten.

**Files touched this Step:**
`backend/src/childprofiles/MySqlChildProfileRegistryRepository.ts` (temporary mutation
only, restored — no net diff), `backend/src/invitation/InvitationService.ts` (temporary
mutation only, restored — no net diff), `backend/src/http/routes/childProfileRoutes.ts`
(temporary mutation only, restored — no net diff), `backend/src/childprofiles/ChildProfileRegistryRepository.ts`
(temporary mutation only, restored — no net diff), `backend/src/authz/AuthzService.ts`
(temporary mutation only, restored — no net diff), `parent-web/src/pages/family/devices/DevicesTabs.tsx`
(temporary mutation only, restored — no net diff),
`backend/test/db/childProfileInvitationBindingHttp.mysql.test.mjs` (new),
`backend/package.json` (registered the new file in `test:db`),
`backend/scripts/verify-mysql.mjs` (schema allowlist fix),
`backend/test/db/schema-privacy.mysql.test.mjs` (key-column allowlist fix),
`parent-web/tests/component/DeviceEnrollmentSections.test.tsx` (new render-based
VIEW_DEVICE_ENROLLMENT test).
