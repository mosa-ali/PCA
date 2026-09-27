# 12 — Combined Defect Register

`PARENT: P0=0 · P1=1 · P2=2 · P3=2` — `PLATFORM: P0=0 · P1=0 · P2=2 · P3=1`
(machine-readable mirror in `parent_platform_findings.json`). Severities not inflated.

## PP-F01 — Device-enrollment link base is localhost in the production bundle — **P1 · PARENT**
- **Area / route**: family device enrollment (link + QR) · client-config
- **File**: `parent-web/src/config/env.ts:79`; usage `pages/family/devices/enrollmentState.tsx:191-192`, `AddDeviceWizard.tsx:560-586`
- **Evidence**: env var `VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL` appears only in `env.ts` (not in `.env.example`/docs/CI); production bundle `https://parent.pcasafe.com/assets/index-pwh0Qt3P.js` contains `deviceEnrollmentLinkBaseUrl:"http://localhost:4000/enroll"` as the active value [LIVE]; local production-style build reproduces.
- **Current behavior**: every generated enrollment link/QR = `http://localhost:4000/enroll/<token>`.
- **Expected behavior**: a working production URL (parent origin) matching the Android App-Link/deep-link contract.
- **Android impact**: `EnrollmentLinkParser.kt` requires `https://enroll.pca.app/<token>` (App Link) or `pca://enroll?token=` — the localhost link matches neither; `enroll.pca.app` is itself a placeholder domain (dependency).
- **BLOCKS_PRE_PRODUCTION = YES** (enrollment-link acceptance) · **BLOCKS_PRODUCTION = YES**
- **Recommended fix**: add a production guard like `apiBaseUrl`'s; document the variable; set it to the parent origin; coordinate the Android host/assetlinks. **Owner**: parent-web + Android + deployment.
- **API_FINDING_ID**: none (parent/platform-local; the API layer is uninvolved).

## PP-F02 — Per-IP rate limiting ineffective in production — **P2 · BOTH**
- **Area**: anti-abuse for parent login/step-up and platform login/activation.
- **Evidence**: `[RECORDED 2026-09-24]` live A/B probes: the runtime's resolved client address is a
  platform hop (PCA_TRUSTED_PROXY_CIDRS lists private CIDRs only; no front-end chain), so per-IP
  limiter buckets never engage (10×401 and no 429; second client unaffected); per-email keying exact
  where used. Re-affirmed as API assessment R-01 (clientAddress/trustProxyConfig source).
- **Current behavior**: per-IP budgets ineffective; per-email (parent login) and server lockouts
  (authenticator attempts) still bound abuse.
- **Expected behavior**: XFF-trust for the platform front-end so limits key on the real client.
- **BLOCKS_PRE_PRODUCTION = NO · BLOCKS_PRODUCTION = YES (abuse control)**
- **Fix**: extend trusted-proxy configuration to the Azure front-end chain or key on its client-IP header; add a live A/B check. **Owner**: deployment/config + backend (shared with API R-01).

## PP-F03 — Deployment provenance and worktree divergence — **P2 · BOTH**
- **Area**: release identity for parent.pcasafe.com / platform.pcasafe.com.
- **Evidence**: `[RUN]` LOCAL_HEAD `6a2cc073` ≠ origin/pca-dev `9496fb19` (AHEAD=1); 194-line dirty
  worktree (parent-web 93, backend 86, platform 11) with **untracked migrations 0051–0054** and
  new identity/MFA sources; live shells dated 2026-09-25 with no SHA/digest surface [LIVE];
  no Azure-side record readable in session (last recorded web digests: parent sha256:4cea8cf7… and
  platform sha256:6bb97836… from the 2026-09-24 deploy lineage — since superseded by 09-25 builds).
- **Current behavior**: live revision cannot be proven equal to any assessed SHA; deployed schema vs
  source revision reconciliation unproven (untracked migrations).
- **Expected behavior**: deploy records digest + source SHA (e.g., release tag) per app; acceptance
  pins one revision.
- **BLOCKS_PRE_PRODUCTION = YES (acceptance) · BLOCKS_PRODUCTION = YES**
- **Fix**: publish digest↔SHA evidence for both apps; land or park the in-flight lanes; commit/park
  migrations 0051–0054 explicitly. **Owner**: deployment + migration lane.

## PP-F04 — Edge/header hardening: no HSTS; parent CSP meta-only; meta frame-ancestors console error — **P3 · BOTH**
- **Evidence**: `[LIVE]` no `strict-transport-security` on either domain; parent serves CSP via meta
  only (no header); both meta CSPs include `frame-ancestors 'none'`, which browsers ignore from meta
  (console error per load — observed live on platform login; same template in parent). XFO DENY +
  nosniff + referrer/permissions policies + COOP are present.
- **Impact**: advisory hardening; clickjacking still covered by XFO; CSP still enforced (meta).
- **BLOCKS**: NO / NO. **Fix**: add HSTS + move parent CSP to a response header; drop
  frame-ancestors from meta. **Owner**: deployment/nginx.

## PP-F05 — Parent full-suite flake under contention — **P3 · PARENT**
- **Evidence**: `DeviceEnrollmentSections.test.tsx` 1 failure under full-suite load two runs in a
  row; **24/24 × 3 isolated passes**; two sibling tests also load-sensitive; repo ruling:
  `LOCAL_FULL_PARENT_SUITE = INDETERMINATE_RESOURCE_CONTENTION`; CI shards ×8.
- **Impact**: developer/CI noise only; no product behavior implication found.
- **Fix**: give the test an explicit longer timeout or a deterministic clock; or leave CI as the
  authority per the existing ruling. **Owner**: parent-web tests (low priority).

## Explicit NON-findings (checked and clean)

- Demo/fixture production risk: NONE (both apps — build-time gate + CI negative control + honest
  unimplemented errors).
- Web Protection authoring unavailable in production: **intentional fail-closed** with honest UI
  (report 04 §3) — tracked as a product-completion item, not a defect.
- Platform client privilege assumptions: none (server authority everywhere; hints only).
- Cross-app configuration collapse (PCA-ADD-PA-001): none found; separate realms verified.
- Open redirects / token-in-storage / secret logging: none found (report 09).
