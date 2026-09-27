# 00 — Parent + Platform Admin Final Pre-Production Assessment — Executive Summary

Assessment date: 2026-09-26 · Read-only · 0 source/database/production/git mutations.

```text
PARENT_PRE_PRODUCTION = CONDITIONAL
PARENT_PRODUCTION     = NO-GO

PLATFORM_PRE_PRODUCTION = CONDITIONAL
PLATFORM_PRODUCTION     = NO-GO

PARENT_API_CONTRACT   = PASS   (30/30 real client paths match backend routes; 4 exclusions are comments)
PLATFORM_API_CONTRACT = PASS   (53/53; all 93 platform-admin backend routes session-guarded)

PARENT_LIVE   = PASS
PLATFORM_LIVE = PASS

PARENT_P0 = 0
PARENT_P1 = 1     (PP-F01 device-enrollment link base = localhost in the production bundle)
PARENT_P2 = 2     (PP-F02 rate-limit effectiveness; PP-F03 deployment provenance)
PARENT_P3 = 2     (PP-F04 edge headers/meta-CSP; PP-F05 full-suite flake)

PLATFORM_P0 = 0
PLATFORM_P1 = 0
PLATFORM_P2 = 2   (PP-F02; PP-F03)
PLATFORM_P3 = 1   (PP-F04)

NEW_API_DEPENDENCY_FINDINGS = API-F01, API-F06, API-F07 (parent); API-F01 + shared infra (platform)

TOP_BLOCKERS =
1. PARENT PP-F01 — the live parent console generates device-enrollment links/QRCs on
   http://localhost:4000/enroll (verified inside the production bundle) — the enrollment
   link path cannot work in production for any user.
2. PLATFORM owner activation — production MFA has never been completed live (last recorded
   state 2026-09-24: PENDING_ACTIVATION, MFA_COMPLETED=0; S7 lockout test never run).
   Owner/external action, not an engineering defect.
3. PP-F03 — deployment provenance: no revision/digest surface ties the live parent/platform
   builds (2026-09-25) to a recorded SHA; origin/pca-dev ≠ local HEAD; 194-line dirty worktree
   with untracked migrations 0051–0054 pending.
4. PP-F02 — per-IP rate limiting is ineffective in production today (platform-hop client
   address; PCA_TRUSTED_PROXY_CIDRS not covering the front-end chain); per-email keying is
   exact where used. Shared with the API assessment's R-01.
5. API-F01 (carried) — the repository worktree is not green (16 unit failures, in-flight
   migration lanes); blocks formal acceptance and CI merging.

OWNER_ACTION_REQUIRED = YES
   - fix/verify the parent-web production build env for the enrollment link base
     (VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL; then coordinate Android APP_LINK_HOST)
   - complete Platform Admin activation + MFA (recovery runbook exists)
   - record deployment digest/SHA evidence for both web apps
   - decide app.pcasafe.com status (still nginx/placeholder; docs/public still call it the
     future parent domain)
   - crypto review gate (PCA-DEC-020) continues to gate device-session crypto features

WHAT CHANGED SINCE THE PRIOR ASSESSMENTS (2026-09-14/15 closures + 2026-09-24 field sessions):
the Parent Genesis ceremony programme is superseded by "Replace Parent Genesis with TOTP
MFA" (f66e0e28) — the current parent-web and live bundle contain ZERO genesis code; parent
auth is now email+password+TOTP with CSRF-cookie sessions; the platform-admin commercial
consolidation lanes landed; both domains are live with current shells.
```

Detailed verdicts, matrices and registers: reports 01–16 and the five JSON registers in
this folder.
