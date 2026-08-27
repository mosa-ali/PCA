# PCA Product Completion & Runtime UX Verification — Stage 0 Audit

Generated 2026-08-27. Baseline: pca-dev @ `d04a0816b9876c75ebcd5b9d53163ded76c5d1e9` (verified against `origin/pca-dev`). `main` unchanged at `f8d5a6fa33b70873901cfb272a6eabfaa9deb2dd`.

This is a full route/source/product audit of parent-web and platform-admin-web, performed by 12 parallel writer-scoped audits reading actual source (components, API clients, backend routes, tests, i18n locales, CSS). See `PCA_PAGE_AUDIT.csv` for the per-route data. This document is the synthesis, the writer ownership plan, and the priority backlog.

**`PCA_PAGE_AUDIT.csv` is a frozen Stage-0 discovery baseline — it is not updated as fixes land.** Current, per-P0 remediation status lives in `PCA_P0_DISPOSITION.csv` (16/16 P0s, one row each, with normative evidence for every reclassification). Current runtime/browser-QA truth across all 60 routes lives in `PCA_PAGE_QA_LEDGER.csv`. Both are checked by `tooling/product-completion/validate-ledgers.mjs`, which must pass before any product-completion documentation commit.

## Executive summary

60 active routes audited (39 parent-web, 21 platform-admin-web). Priority distribution: **16 P0, 20 P1, 18 P2, 6 P3.**

The dominant finding is **not** cosmetic incompleteness. Most pages are visually coherent, fully bilingual (EN/AR key-parity is excellent almost everywhere), and RTL/responsive CSS is broadly solid (logical properties, `.responsive-cards` fallbacks). The real problem is **functional**: a large fraction of "source complete" pages are wired to nothing, or to a stub that always fails, in production. Three distinct root-cause patterns account for the majority of P0/P1 findings:

1. **A single external gate blocks a large, legitimate slice of Parent Web.** `CRYPTO_SUITE_APPROVED_FOR_PRODUCTION = false` is hardcoded in `parent-sdk/browser-runtime/src/cryptoGate.ts` pending human security review (this is the `PRODUCTION_CRYPTO_SUITE` / `CRYPTO_SECURITY_REVIEW` external gate already registered in `docs/release_readiness/external_gate_matrix.json`). Every real (non-demo) call through `RealParentFamilyDataGateway` — Dashboard, ChildrenList, ChildOverview, ScreenTime, Apps, WebProtection, YouTube, Activity, Location status, Devices status — fails closed by design. **This is correct, honest, fail-closed engineering and must not be touched, bypassed, or weakened by any writer.** It is out of scope for this programme; it is an owner/external decision already tracked. Writers must build/fix everything *around* it (UI, wiring, secondary bugs) without depending on it becoming available.

2. **Real, fully-built backend endpoints exist with no frontend caller, or a frontend caller that unconditionally throws/no-ops.** This is the highest-value, lowest-risk category of fix — pure frontend work against already-correct, already-tested backend contracts:
   - `Requests.tsx`: backend `/decide` and `/bonus-time/grant` are fully implemented; `RealRequestClient` throws "not implemented" unconditionally. **P0.**
   - `LocationPage.tsx`: Safe Zone CRUD is fully real (backend route, typed client, crypto-authoring boundary, complete bilingual strings) with zero UI ever calling it. **P1.**
   - Platform Admin `AccountDetail.tsx`: suspend/reactivate is fully built server-side (RBAC + step-up + audit) but the buttons are permanently disabled placeholders. **P1**, compounded by the readmodel bug below.
   - Platform Admin `/settings`: a full category settings system (branding, payment-provider, notifications, maintenance, feature flags) exists server-side; the UI shows a now-false stale placeholder claiming it doesn't. **P1.**

3. **Silent failure / missing feedback on mutating actions**, the same anti-pattern a prior commit already fixed once in `Requests.tsx` (`fix(parent-web): surface Requests-page action failures instead of silently swallowing them`) but which recurs elsewhere untouched: `WellbeingAdmin.tsx` (bare `catch {}` on every action), `Notifications.tsx` (`markRead`/`acknowledge` have no try/catch at all), `AppsPage.tsx` toggle (silent catch, no visible failure state).

A smaller number of standalone, concrete defects were also found and are cheap to fix: `PrayerPage.tsx` has a hardcoded untranslated "Reminders:" string; `TrustedBrowser.tsx` ships literal `"(dev)"`/`"(dev stub)"` production button copy in **both** locales; `Recovery.tsx`'s "Start recovery transaction" button has **no `onClick` handler at all**; `ChildLayout.tsx` renders the raw `childId` route param instead of the child's name; `ProtectionStatus.tsx`'s alert panel hardcodes English text and bypasses i18n entirely (a real RTL/i18n regression); Platform Admin's `AccountsList`/`AccountDetail` readmodel hardcodes every account's status to `'AVAILABLE'`; Platform Admin billing tables (invoices, payments, pricing) render status enums raw/untranslated with no badge, so failed payments and open disputes are visually indistinguishable from healthy rows; `SettlementBatches`/`SettlementReconciliation` render the reconciliation exception amount as a bare unformatted integer instead of money — on the one page whose entire purpose is surfacing financial exceptions; `RealDeviceEnrollmentClient` discards the HTTP 403 body's `code` field entirely, so the `MANAGED_DEVICE_LIMIT_REACHED` code added in a recent backend fix (`d0b7029`) never reaches any UI.

**Design system**: no shared `PageHeader`, `SectionHeader`, `KpiCard`, `InfoCard`, `FilterBar`, `SearchInput`, `Pagination`, `Modal`/`ConfirmDialog`, `Drawer`, `FormSection`, `Toast`, or `InlineAlert` component exists in parent-web. Every list page hand-rolls its own table; there are 4 independent modal implementations (one doesn't even use the shared focus-trap hook). `States.tsx` (Loading/Error/Empty) and the offline-notice family are the two genuine reuse successes. Platform Admin's design system is comparatively more consistent (shared `.table-wrap`, `.filters`, `.pagination` CSS conventions) but has the same missing-status-badge problem across its billing/settlement tables.

**No forgot-password / account-recovery flow exists anywhere in the app** (frontend or backend) — a genuine missing product feature, not a styling gap.

**Runtime/Docker (Writer 13 lane)**: no `docker-compose.yml` exists at the repo root (only a `backend/Dockerfile`); `backend/scripts/seed-local.mjs` currently seeds only two minimal "happy path" families. **Docker's daemon is confirmed unavailable in this environment** (client present, server/daemon connection refused — same finding as the prior remediation session). This blocks any real-browser-against-real-DB verification and the final acceptance barrier's Docker/real-E2E requirements until Docker Desktop is actually running. This is an environment fact, not a defect, and will not be fabricated around.

## Owner decision: resolved

**Platform Admin `/settings` RBAC scope — RESOLVED, keep the stricter page-level gate.** The route-level gate restricting the whole page to `ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS` (APP_OWNER/PLATFORM_ADMIN only) is confirmed correct and intentional, matching `tests/unit/App.routeSecurity.test.tsx`'s existing assertion that AUDITOR_READ_ONLY is redirected away from admin-account management. It is **not** being widened to SUPPORT_ADMIN/FINANCE_ADMIN/AUDITOR_READ_ONLY. The backend's free-starter-defaults/currency/market-mapping read endpoints gating on `VIEW_SUPPORT_ACCOUNT_METADATA` (ALLOW for every role) are a separate, legitimate surface — those endpoints have non-page consumers and their existing permission is preserved unchanged; only the `/settings` *page* gate was in question, and it stays as-is. No RBAC boundary was widened or narrowed.

## Writer ownership (confirmed against actual route evidence; unchanged from the default proposal)

| Writer | Scope | Routes | P0 | P1 |
|---|---|---|---|---|
| W01 | Design system + Parent Web auth/shell | register, verify-email, login, not-permitted, 404 (parent) | 0 | 2 |
| W02 | Dashboard + children + overview | dashboard, children, overview | 1 | 1 |
| W03 | Screen-time + apps | screen-time, apps | 2 | 0 |
| W04 | Web-protection + YouTube + activity | 3 routes | 0 | 2 |
| W05 | Location + eye-protection + prayer | 3 routes | 0 | 2 |
| W06 | Requests + wellbeing + notifications | 4 routes | 2 | 2 |
| W07 | Family members/roles/devices | 3 routes | 2 | 0 |
| W08 | Privacy + security + settings | 10 routes | 5 | 3 |
| W09 | Subscription/billing (parent) | 6 routes | 1 | 3 |
| W10 | Platform Admin dashboard/accounts/entitlements | 7 routes | 0 | 2 |
| W11 | Platform Admin billing/settlement | 8 routes | 2 | 2 |
| W12 | Platform Admin admin/security/settings + auth/shell | 6 routes | 0 | 1 |
| W13 | Local runtime / Docker / DB / seed / real browser QA | n/a (infra) | — | — |

No reassignment was needed versus the default proposal — actual route ownership matched the proposed boundaries exactly. Two cross-cutting fixes span writer boundaries and need coordinator-level sequencing rather than one writer working alone:
- The discarded 403 `code` field lives in `parent-web/src/api/real/realDeviceEnrollmentClient.ts`, consumed by both W07 (Devices) and W09 (DeviceIncreaseRequest) — **W07 owns the client fix**, W09 wires the resulting code into its own page.
- Platform Admin's missing status-badge/i18n pattern recurs across every W11 route (pricing, invoices, payments) — **W11 fixes it once as a shared pattern**, not four times independently.

## Priority backlog (P0, 16 items)

1. `Requests.tsx` — **FIXED (`d496f32`)**, wired `RealRequestClient.decide()`/`grantBonusTime()` to the real, already-built backend (W06). Still externally gated for function by `UnavailableTrustSetRoleResolver` (fails closed 403 until a real trust-set source is wired) — see `PCA_P0_DISPOSITION.csv`.
2. `WellbeingAdmin.tsx` — **RECLASSIFIED_NOT_DEFECT.** No backend/client is being built here: `parent-web/src/domain/wellbeing.ts`'s own header states this is "the UI-side data shape for the future Agent-8 wellbeing message-control feature... Storage/delivery authority is out of scope here," and `unavailableProviders.ts` groups `WellbeingMessageAdminClient` with `FamilyAuthorityGateway` as "still genuinely unimplemented" (future scope, not a wiring gap like Requests). The silent-catch anti-pattern (`toggleCurated`/`duplicate`/`archive`/`restore`/`saveDraft`) was fixed independently (`3d43f7d`). Building the backend now would be scope creep against the accepted architecture (W06).
3. `Members.tsx` — no family-authority backend exists at all; demo-only today. Confirmed no `FamilyAuthorityGateway` implementation exists anywhere in the repo (unlike `TrustSetRoleResolver`, which has a real, unwired class). Tracked as a genuine open gap (`NOT_STARTED`), not a deferred feature (W07).
4. `Devices.tsx`/panels — localize `ProtectionAdministrationPanel` (~40 orphaned strings); fix RBAC gating inconsistency (W07)
5. `Retention.tsx` / `Export.tsx` / `DeleteNow.tsx` — no browser bearer-token session flow; render already-authored disclosure copy (W08, 3 items)
6. `Recovery.tsx` — **RECLASSIFIED_EXTERNAL_GATE, crypto-primitive-level (`914c6d5` fixed the UI-honesty portion only).** The dead "Start recovery transaction" button (no `onClick` handler at all) was replaced with an honest not-yet-available message. The underlying ceremony was deliberately not built: `docs/implementation/PCA_COMPLETION_V2_MATRIX.json`'s `PCA-13` phase states recovery cryptography (RS→RWK KDF, recovery envelope AEAD/KEM open) is `NOT_IMPLEMENTED`, and `backend/src/familyrbac/UnavailableAuthorizedRecoveryAuthority.ts` mirrors `UnavailableTrustSetRoleResolver`'s fail-closed-pending-review posture — the same class of gate as `PRODUCTION_CRYPTO_SUITE`, requiring human security review before any implementation. Not rushed in this remediation pass (W08).
7. `Audit.tsx` (parent) — no backend at all for family-facing audit trail (W08)
8. `Dashboard.tsx` / `ChildOverview.tsx` (parent) — fix runtime-sync API path mismatch and `ChildLayout`'s raw-childId heading (W02, 2 items — both fixable independent of the crypto gate)
9. `ScreenTimePage.tsx` / `AppsPage.tsx` — no backend route exists for screen-time or app-rule reads/writes (W03, 2 items)
10. `DeviceIncreaseRequest.tsx` — surface the `MANAGED_DEVICE_LIMIT_REACHED` code once W07's client fix lands (W09)
11. `BillingPayments.tsx` (PA) — failed/disputed rows indistinguishable from healthy rows; no refund/dispute action UI despite RBAC ops existing (W11)
12. `SettlementReconciliation.tsx` (PA) — reconciliation exception amount not formatted as money (W11)

## Sequencing

Given W02/W03/W04/W05/W06/W07/W08's P0s are frontend-and-backend wiring work (not deep new capability) and are independent of Docker, they can proceed now. W13 (Docker/DB/seed authoring) can also proceed now — the compose file and expanded seed data can be **authored** even though they cannot be **verified** until Docker's daemon is running; any such work will be explicitly marked unverified rather than claimed as passing. Real-E2E and real-browser QA against a live DB remain blocked until Docker is available.

## Regression checkpoints

Per programme spec: checkpoint after W01–W04, full Parent Web checkpoint after W05–W09, Platform Admin checkpoint after W10–W12, full system checkpoint after W13. These will run typecheck/lint/unit/mocked-E2E/build/demo-gate for each app, consistent with what was already re-verified once this session (see prior remediation: Parent Web 480/480, Platform Admin 91/91, both mocked-E2E suites green).
