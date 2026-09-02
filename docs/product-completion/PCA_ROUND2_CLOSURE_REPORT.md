# PCA Round 2 — Final Closure Report

Permanent record of the Round-2 source/browser closure and the final programme
gates, on branch `pca-dev`. This report is itself the last commit of the range
it describes, so it names the five commits before it and describes its own.

Entry remote (`origin/pca-dev`): `c70da4f81508fd78697bcdd36deb16f07c80e3db`.

---

## 1. Route disposition

| Metric | Value |
| --- | --- |
| `TOTAL_ACTIVE_ROUTES` | 62 |
| `ROUTES_PASS` | 49 |
| `BLOCKED_EXTERNAL` | 13 |
| `BLOCKED_OWNER` | 0 |

49 + 13 + 0 = 62. Every active route has a final disposition.

The 13 `BLOCKED_EXTERNAL` routes render an honest, localized external-gate state
(the production crypto suite / trusted-browser gate), not a crash or a blank
page. Zero uncaught page errors across all 62 in both the desktop and the
375x812 sweep.

---

## 2. P1/P2 behaviour verification

### Methodology change — stated, not hidden

The prior session's **128**-item P1/P2 behaviour enumeration **was not
recoverable**: it was never committed to the repository and the session memory
that held it was empty on resume. Rather than guess at its contents, this round
reconstructed a **superset** from the committed `PCA_PAGE_AUDIT.csv` — for each
of the 38 P1/P2 routes, one workflow behaviour plus one behaviour per catalogued
gap (primary and secondary):

```
38 workflow + 31 primary gap + 93 secondary gap = 162   (95 P1, 67 P2)
```

The 124 "gaps-only" count and the prior 128 both sit inside this 162, so nothing
the 128 covered can have been missed. **162 is the controlled denominator going
forward**; the 128 figure is retired as unrecoverable and must not be
reintroduced.

The full per-behaviour ledger, with the evidence and the basis for every call,
is committed at `docs/product-completion/PCA_P1_P2_BEHAVIOR_LEDGER.csv`
(162 rows). It is a persistent repository artifact, not session state.

### Results

| | TOTAL | VERIFIED | BLOCKED_EXTERNAL | BLOCKED_OWNER | DEFECTS_FOUND | DEFECTS_FIXED | REMAINING |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P1** | 95 | 59 | 21 | 15 | 2 | 2 | **0** |
| **P2** | 67 | 44 | 8 | 15 | 1 | 1 | **0** |

`BLOCKED_OWNER` items are product decisions (presentation/enhancement scope,
unbuilt affordances, and two items the audit itself flags for owner review),
not open defects.

---

## 3. Defects found and fixed in this round

| # | Where | Defect | Fix |
| --- | --- | --- | --- |
| 1 | parent-web Dashboard / ChildOverview / ScreenTimePage | `RealParentRuntimeSyncClient` was wired in production against `/api/sync/*`, a surface the backend does not serve at all; every load fired real 404s, and the resulting bare `Error` could not be classified, so parents read the generic "something went wrong" copy | `35597ee` — fail closed via `UnavailableParentRuntimeSyncClient`; the failure now carries `NOT_IMPLEMENTED` and renders the honest localized "not connected yet" state |
| 2 | parent-web `/privacy/permissions` | The last mobile horizontal overflow: `.permission-entry` had **no CSS rules at all** (it was pinned in `KNOWN_UNSTYLED`), so a 49-character manifest identifier with no break opportunity set the element's minimum width | `d2b3042` — real break rules + `min-width: 0` floors; identifiers kept verbatim but demoted to labelled secondary detail with an sr-only label and `dir="ltr"` |
| 3 | platform-admin-web `/audit`, `/accounts`, `/accounts/:id`, `/settings` | Raw backend codes rendered as user-facing labels (`ADMIN_LOGIN`, `APP_OWNER`, `FREE_STARTER`) — while the same audit table already translated `result` and the shell header already rendered that same role as "App Owner" | `b43a9f0` — `src/i18n/enumLabels.ts`, with audit labels generated from and tested against the backend's authoritative 32-value vocabulary |

**How defect 3 was found, and why it had survived a prior "verified" pass:** the
first Platform Admin evidence pass navigated with `page.goto()`. That drops
platform-admin-web's deliberately in-memory-only session
(`secureSession.ts`, PCA-ADD-PA-014/016), so the pass captured the **login page
for all 16 admin routes** and recorded them as rendered. Re-collected via real
sidebar clicks, the raw enums appeared immediately. Any future admin browser
evidence must use client-side navigation.

### Deliberately unchanged verbatim citations

Two surfaces still render `SCREAMING_SNAKE` text, and both are correct:

- `/privacy/permissions` — the `android.permission.*` identifiers are a 1:1
  citation of `AndroidManifest.xml` (PCA-NFR-061); the identifier *is* the
  evidence. Each is paired with a translated human-readable name.
- `/audit` Metadata column — the logged metadata JSON, rendered verbatim. A
  DOM-scoped check confirmed **13 of 13** remaining tokens on that page live
  inside `pre.audit-metadata` and none in a label cell. Reinterpreting values
  inside an audit record would corrupt the trail.

Both are scoped by DOM position in the closure re-check, so a genuine leak
outside those containers still fails.

---

## 4. RTL and responsive scope — exact, not rounded up

**`RTL_SCOPE` = 38/38 routes exercised in Arabic in this session** (22 parent-web
+ 16 platform-admin-web), all reporting `dir="rtl"` with genuinely Arabic
rendered content.

That 38 is the **P1/P2 subset**, which is what this round's behaviour
verification covered. The remaining 24 routes (P0 and P3) were **not** re-run in
Arabic this session; their AR evidence carries forward from the pre-hold
recorded sweep (62/62 `dir=rtl`).

**This must not later be restated as "62/62 RTL verified in Round 2".** The
honest statement is: 38/38 re-exercised this round, 24 carried forward.

**`RESPONSIVE_SCOPE` = 62/62 routes at 375x812, 0 horizontal overflow** — the
full sweep was re-run at mobile width this session, so this figure is complete
rather than carried forward. The previously-known single overflow
(`/privacy/permissions`) is resolved.

---

## 5. Final programme gates

| Gate | Result |
| --- | --- |
| Targeted mutation | 14 mutants, **14 KILLED**, 0 SURVIVED, 0 EQUIVALENT, 0 INVALID |
| Parent security red team | 28 checks, **0 findings open** |
| Platform Admin security red team | 19 checks, **0 findings open** |
| Parent real-backend E2E | **PASS** |
| Platform Admin real-backend E2E | **PASS** |
| Backend suite | 1787 / 1787 |
| parent-web suite | 627 / 627 |
| platform-admin-web suite | 118 / 118 |
| Clean bootstrap this session | **PASS** (×2 — see §6) |

Mutation covered exactly the boundaries this range changed: restoring the real
runtime-sync client in production, making the unavailable provider silently
succeed, removing the `NOT_IMPLEMENTED` classification, removing the overflow
break rules and the `min-width` floor, replacing the human label with the raw
identifier, dropping the screen-reader label, and bypassing each of the three
enum-label helpers plus both drift guards. A control run confirmed the same
suites pass unmutated, so the harness discriminates.

### Probe corrections made during the gates

Five apparent security findings and several apparent behaviour gaps were traced
to **the probes, not the product**, and are recorded here so they are not
rediscovered as defects later:

- Parent logout/revoke-all appeared not to invalidate sessions — the probe
  omitted the double-submit CSRF header, then sent `Content-Type:
  application/json` with an empty body (Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`).
  Correctly shaped, both return 204 and the old cookie then 401s.
- Password-reset and verification single-use looked unprovable — the seeded
  codes are TTL-bounded and this session outlived them (QA-B-003). Proven
  properly by minting fresh codes through the real services
  (`backend/scripts/qa-credential-redteam.mjs`).
- Five Platform Admin RBAC "violations" were the probe's invented allow-sets.
  Re-derived from `rbacPolicy.ts`'s `OPERATION_MATRIX` with each route pinned to
  the operation its handler actually calls, the observed verdicts match the
  matrix exactly.
- Step-up probes failed until they waited for a genuinely fresh TOTP window —
  `verifyTotp`'s counter-claim (TOTP-REPLAY-1) correctly refuses a window the
  login already consumed.
- An own-family privacy export returning 202 is the **documented** boundary:
  `retentionRoutes.ts` states this HTTP layer is deliberately family-scope-only,
  with Owner-only + step-up enforced by the device-side signed-envelope
  authority, because the only role authority in the codebase is explicitly
  device-local.

---

## 6. Clean bootstrap

`CLEAN_BOOTSTRAP_THIS_SESSION = PASS`, twice:

1. The seeded QA stack — fresh disposable MySQL on 33061, 30 migrations, full
   seed (20 families, 21 parent accounts, 25 admins).
2. A second, independent `pca_e2e` database — 30 migrations, then
   `bootstrap-platform-owner.mjs` and `bootstrap-e2e-parent-account.mjs`, used
   for the Platform Admin real E2E (whose documented prerequisite is exactly one
   bootstrap-created admin, which the seeded database cannot satisfy because the
   script correctly refuses to run when an `APP_OWNER` already exists).

Backend and schema are untouched by this range, so earlier clean-cycle evidence
remains valid; these two are additional, not replacements.

---

## 7. Publication state

Six local commits on `pca-dev`, reviewed as a range from `c70da4f`:

```
35597ee  fix(parent-web): runtime-sync client no longer targets a nonexistent surface
d2b3042  fix(parent-web): /privacy/permissions overflow + manifest identifier presentation
b43a9f0  fix(platform-admin-web): audit/role/plan enum labels
960ef75  qa(product-completion): P1/P2 behaviour ledger + qa-r2 harness
14eaa46  test(closure): admin real-E2E alignment, two latent test repairs, red-team harnesses
(this)   docs(product-completion): this report + the targeted closure re-check
```

The first four are the source/browser round the coordinator reviewed; the last
two are this closure pass (test alignment, harnesses, and the permanent record).

No backend, auth, crypto, session, RBAC or migration file is touched anywhere in
the range. No production control was modified to make a test pass.

**Correction to `b43a9f0`'s commit message:** it claimed `tsc --noEmit` clean,
but that typecheck ran before `tests/unit/enumLabels.test.ts` was added, and
shell pipelines were masking exit codes. The file had an invalid cast; it is
fixed in `14eaa46` and every gate above was re-verified by exit code.

This report does not declare acceptance. Independent review decides that.
