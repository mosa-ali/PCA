# 09 — Frontend Security & Privacy (application-specific)

Scope per mission §29/§30: frontend-specific review only; API security is the API assessment's.

## 1. Token & storage exposure — PASS

- Parent: session lives in an HttpOnly cookie (unreadable to JS by construction); the only readable
  cookie is the CSRF companion, echoed back only (`realServiceAuthClient.ts:8-28`). No parent token
  in any storage — asserted by E2E (raw invitation token never in localStorage/sessionStorage/URL).
- Platform: operator token in a module-scoped in-memory store only — explicitly never
  localStorage/sessionStorage/cookie; lost on reload by design (`security/secureSession.ts:1-15`).
- Activation: one-time token cleared from address bar/history; QR drawn locally (no remote renderer,
  no outbound request) — lane evidence + source comments [READ].

## 2. XSS / rendering — PASS

- React text rendering throughout; the only `dangerouslySetInnerHTML`-adjacent surface found was
  none in application code paths reviewed; parent has `sanitizeText.ts` + `activitySummary` mapping
  with fixed translation keys (no raw server strings rendered as HTML).
- Parent meta CSP blocks inline scripts (`script-src 'self'`); platform header CSP is stricter
  (`default-src 'none'` allow-list). Both live-verified.

## 3. URL / redirect safety — PASS

- Parent return-path handling routes through a guard (login → `state.from` only, internal paths);
  no open-redirect found; the enrollment link carries the one-time token but the token is a
  server-bound invitation secret with single-use semantics (API assessment) — the E2E asserts the
  token never enters storage or the SPA URL beyond the enrollment element itself.
- Platform has no external redirect surface; activation route posts internal.

## 4. Password / MFA value handling — PASS

- Password fields standard; no logging of credentials (lint bans console; `reportDiagnostic`
  deliberately status-word-only — `realServiceAuthClient.ts:40-41` "Diagnostics carry status words
  only").
- MFA/step-up codes: local component state only, cleared after submit, never persisted
  (`StepUpContext.tsx` code reset; platform login holds no persisted value).

## 5. Console logging / error leakage — PASS

- Parent: `no-console` is an error; diagnostics via `security/diagnosticConsole.ts`
  (status-word discipline documented).
- Platform: same diagnostic module pattern; API client never surfaces server 5xx detail
  (closed code set — `platformAdminApiClient.ts:11-30`).
- Observed live console output: only the meta-CSP `frame-ancestors` browser warning (PP-F04).

## 6. Client privilege assumptions — PASS (both apps)

- Both apps ship explicit "UI hiding is not authorization; server re-authorizes everything" policies
  (parent `rbac/RouteGuard.tsx:19-27`; platform `rbac/RouteGuard.tsx:8-17`), and the server side
  enforces it (parent: API assessment §27 family isolation; platform: 93/93 guarded routes).
- No client-side role escalation path; platform dev-role switching exists only under
  fixture-backed demo mode in parent (`setDemoRole` gated by `isFixtureBacked`).

## 7. Privacy (mission §30) — PASS

- Parent stores no sensitive family data beyond session-scoped rendering; dev stores are
  dev-mode-only (`security/localFamilyDataStore.ts` under demo); logout clears session state and
  caches are not persisted (SW caches app shell only).
- Platform stores no parent/family personal data client-side; audit/account data fetched per view.
- No sensitive values in URLs (E2E asserts); no PII in logs (see §5).

## 8. Header-layer gaps (edge/platform config, recorded once)

- No HSTS on either domain; parent CSP is meta-only (no header). Meta `frame-ancestors` is ignored
  (console error) — XFO DENY still applies. → PP-F04 (P3).

## 9. Findings carried from evidence

- PP-F01 (enrollment link localhost) has no direct security consequence but breaks an onboarding
  flow; recorded in the defect register under PARENT.
- PP-F02 (per-IP rate limiting ineffective) is an abuse-control gap affecting parent login/step-up
  and platform login/activation; mitigations documented in report 06 §6.

```text
PARENT_FRONTEND_SECURITY   = PARTIAL (posture strong; edge/header + rate-limit gaps)
PLATFORM_FRONTEND_SECURITY = PARTIAL (same two gaps; token/CSP posture strong)
```
