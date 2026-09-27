# 11 — Previous Assessment Reconciliation

Prior evidence sources (the mission-named folders `pca_parent` / `pca_platform` are **empty**;
the historical reviews live elsewhere — see table): SESSION 2B closure (2026-09-14, commit
`1333ae07`), PRE_SESSION_3 master closure (2026-09-15), ROUND2 closure, field sessions of
2026-09-24 (deploy hotfix + grants + S6/S8), plus the new API assessment (2026-09-26).

## 1. Previous PARENT findings (mission §41)

| Old item (source) | Old status | Current evidence | Final status |
|---|---|---|---|
| Parent auth/session UAT (SESSION_2B: `PARENT_SESSION=NOT_EXECUTED`, `BROWSER_UAT=BLOCKED`) | NOT_EXECUTED | Same-day real-backend E2E: sign-in, cookie persistence, guard redirect, Settings data — 1/1 passed; suite 1063/1064 [RUN 2026-09-26] | **RESOLVED** (browser UAT for session flow now exists; full acceptance remains conditional on PP-F01/PP-F03) |
| Genesis ceremony fail-closed (`GENESIS_PRODUCTION_COMPOSITION=FAIL_CLOSED_BY_DESIGN`) | FAIL-CLOSED | Genesis programme superseded by `f66e0e28` "Replace Parent Genesis with TOTP MFA"; 0 genesis references in source AND live bundle; parent MFA (TOTP) auth in place | **SUPERSEDED** (report 02 §1) |
| `PLATFORM_ADMIN_MFA_STATUS=PENDING_SETUP` (owner-stated) | PENDING | unchanged in current read-only scope; MFA now also the parent-auth mechanism (DEC-037) | **STILL_OPEN** (owner gate; report 03) |
| `TLS=UNVERIFIED` / `PRIVATE_PATH=UNVERIFIED` (SESSION_2B) | UNVERIFIED | Live TLS 1.3 + certs verified for both domains; PWA/private path functional (SW + reload flow) | **RESOLVED** |
| `PUBLIC_DEPLOYED=NO`, `PARENT_SIGNIN_DESTINATION=TOPOLOGY_AND_LIVE_UAT_PENDING` | PENDING | parent.pcasafe.com live (login 200) and linked from public programme docs; app.pcasafe.com remains future-domain placeholder | **PARTIALLY RESOLVED** (parent live; app.pcasafe.com decision open) |
| `REAL_EMAIL_DELIVERY=NOT_EXECUTED` | NOT_EXECUTED | unchanged this session (no email interaction allowed) | **STILL_OPEN (external)** |
| `AUTH_B=OWNER_TEST_IDENTITY_REQUIRED` | OWNER GATE | 2026-09-24 owner sign-in acceptance passed after grants fix (recorded) | **RESOLVED** (recorded live acceptance) |
| Parent login failure ("Not approved" era) | BROKEN→FIXED | 2026-09-24: privilege fix applied + verified; login-copy hotfix deployed; today's E2E re-proves the flow | **RESOLVED** |
| PARENT C functional campaign (`*_NOT_EXECUTED` blocks) | NOT_STARTED | large parts now exercised via suites + E2E; full functional campaign still owner/UAT-scoped | **PARTIALLY RESOLVED** |

New parent findings this assessment: PP-F01 (enrollment link), PP-F05 (flake) — see register 12.

## 2. Previous PLATFORM findings (mission §42)

| Old item | Old status | Current evidence | Final status |
|---|---|---|---|
| Activation atomicity/token hygiene gates (SESSION_2B PASS set) | PASS (source) | Re-read of lane files: token hash-only, single-use/expiry/revocation, TOTP replay protection, scrypt, AES-256-GCM still present; activation QR lane + key-ring hardening commits landed | **CONFIRMED / RESOLVED** |
| MFA key rotation findings F1/F2/F4 (2026-09-25 review lane) | FIXED (commits 81e0550c/e1d2e5d1) | fixes in worktree/history as recorded; no regression seen in current read | **RESOLVED (as recorded)** |
| F3/F5/F6/F7 (reviewer items) | OUTSTANDING | no evidence they landed in the reviewed surface; not re-derived this session | **STILL_OPEN (low severity; not release-blocking alone)** |
| `PLATFORM_OWNER_STATE=PENDING_ACTIVATION` (MFA PENDING_SETUP; activation token expired 2026-09-23; recovery runbook ready) | BLOCKED on owner | unchanged — production MFA still unproven; login page live + unit-tested | **STILL_OPEN (owner action)** |
| S7 lockout test (bounded 5-attempt) | NOT RUN (owner stopped 2026-09-24) | unchanged | **STILL_OPEN (owner)** |
| S8 per-IP limiter deviation | DEVIATION | live-confirmed again by API assessment R-01; per-email keying exact | **STILL_OPEN** → PP-F02 |
| Platform admin E2E evidence | CI-certified, local runs limited | local `--list` only; CI runs the real suite with assert manifests | **EXTERNAL/CI-dependent** |

New platform findings this assessment: none above P3 (PP-F02 shared; PP-F03 provenance; PP-F04
headers).

## 3. Classification summary (mission vocab)

- STILL_OPEN: platform owner activation/MFA + S7; real email delivery; F3/F5/F6/F7 reviewer items
  (platform lane); per-IP limiter effectiveness.
- RESOLVED: parent login defect (privilege+copy), TLS verification, session UAT evidence,
  activation source gate set (re-verified).
- SUPERSEDED: Genesis ceremony findings (whole Genesis programme → TOTP MFA).
- STALE: SESSION_2B "parent-web not executed" states (the surface has since been built, tested and
  deployed — do not carry forward).
- NOT_REPRODUCIBLE: none claimed (nothing was re-run that failed to reproduce).
- EXTERNAL: native Arabic signoff; app.pcasafe.com decision; real-email delivery; owner MFA actions.
