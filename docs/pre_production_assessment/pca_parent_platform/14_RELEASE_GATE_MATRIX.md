# 14 — Release Gate Matrix

Machine-readable mirror: `parent_platform_release_gates.json`.
Vocabulary: PASS / PARTIAL / FAIL / BLOCKED_EXTERNAL / UNPROVEN.

## Parent Web

| Gate | Value | Basis |
|---|---|---|
| SOURCE | PARTIAL | one unguarded production default (PP-F01); everything else strong |
| BUILD | PASS | exit 0 [RUN] |
| TYPECHECK | PASS | exit 0 [RUN] |
| LINT | PASS | exit 0, 0 warnings [RUN] |
| TESTS | PASS | 1063/1064; flake attributed + isolated green; CI sharded [RUN/RECORDED] |
| AUTH | PASS | report 06 §1 + real E2E |
| SESSION | PASS | HttpOnly cookie + CSRF; real E2E reload persistence |
| API_CONTRACT | PASS | 30/30 matched; exclusions explained (report 04) |
| FAMILY_STATE | PASS | sound guards; family creation intentionally outside UI (R-PP-07) |
| ERROR_HANDLING | PASS | closed code set → honest i18n messages |
| ARABIC | PASS (SOURCE) · NATIVE = EXTERNAL | 1527/1527 parity; RTL wiring |
| RESPONSIVE | PASS | CI-certified specs |
| SECURITY_FRONTEND | PARTIAL | edge headers (PP-F04) + rate-limit config (PP-F02) |
| LIVE_DOMAIN | PASS | [LIVE] 200/TLS/login render/denials correct |
| SOURCE_LIVE_MATCH | PARTIAL | no revision surface (PP-F03) |
| PRE_PRODUCTION | **CONDITIONAL** | fix PP-F01 + provenance before formal acceptance |
| PRODUCTION | **NO-GO** | PP-F01, PP-F03, PP-F02, API-F01, R-PP-02/05/07 |

## Platform Admin Web

| Gate | Value | Basis |
|---|---|---|
| SOURCE | PASS | report 03 |
| BUILD | PASS | exit 0 [RUN] |
| TYPECHECK | PASS | exit 0 [RUN] |
| LINT | PASS | exit 0 [RUN] |
| TESTS | PASS | 226/226 [RUN] |
| AUTH | PASS | report 06 §3 |
| MFA | **PARTIAL** | source+unit PASS; production completion never proven (BLOCKED_EXTERNAL owner) |
| RBAC_CLIENT_BEHAVIOR | PASS | hints + 93/93 server-guarded; roleBoundaries spec |
| API_CONTRACT | PASS | 53/53 (report 05) |
| ERROR_HANDLING | PASS | closed code set; uniform 401/403/404/409/400 |
| LOCALIZATION | PASS | 630/630; arabicShell spec |
| SECURITY_FRONTEND | PARTIAL | in-memory token + CSP strong; PP-F04 headers |
| LIVE_DOMAIN | PASS | [LIVE] 200/CSP/401-denial/login render |
| SOURCE_LIVE_MATCH | PARTIAL | PP-F03 |
| PRE_PRODUCTION | **CONDITIONAL** | real UAT blocked on owner activation (R-PP-01) + PP-F03 |
| PRODUCTION | **NO-GO** | R-PP-01, PP-F03, PP-F02, API-F01 |

## Shared / external gates

| Gate | Value | Basis |
|---|---|---|
| OWNER_PLATFORM_ACTIVATION | BLOCKED_EXTERNAL | runbook ready; owner required (R-PP-01) |
| ANDROID_APP_LINK_HOST (enroll.pca.app) | BLOCKED_EXTERNAL (infra) | placeholder domain; DNS/assetlinks needed (R-PP-02) |
| CRYPTO_REVIEW (PCA-DEC-020 lineage) | BLOCKED_EXTERNAL | gates device-session crypto features (R-PP-03) |
| NATIVE_ARABIC_SIGNOFF | EXTERNAL | unchanged |
| REAL_EMAIL_DELIVERY | NOT_EXECUTED | out of read-only scope |
| REPO_WORKTREE_GREEN | OPEN | API-F01 (16 backend failures) + R-PP-05 |
| DEPLOYMENT_PROVENANCE | UNPROVEN | PP-F03 |
