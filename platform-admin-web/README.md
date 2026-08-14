# PCA Platform Administration Web (PCA-PA-3)

Operator-facing control-plane console for PCA's commercial/account back
office: accounts, entitlements, billing, admin-user management, and audit.
This is a standalone application, architecturally and operationally
separate from `parent-web` (the family-facing product) -- see
`docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md`
Section 2 for the three-product-plane trust boundary this app is one leg of.

It shares no session type, token, RBAC model, or route namespace with
`parent-web`. Do not add `/parent/admin`, an `isAdmin` toggle, or any hidden
route inside `parent-web` -- Platform Administration authentication only
ever happens here, against `/platform-admin/auth/*`.

## Running locally

```
npm install
cp .env.example .env   # point VITE_PCA_PLATFORM_ADMIN_API_BASE_URL at the backend
npm run dev             # http://localhost:4100
```

## Quality gates

```
npm run typecheck
npm run lint
npm run test        # vitest unit/component/RBAC/i18n/a11y suite
npm run test:e2e     # Playwright (mocks the backend at the HTTP boundary -- see e2e/*.spec.ts headers)
npm run build
```

## BACKEND_GAP_REQUIRED

As of this app's authoring (base `2b16941` on `pca-dev`), the backend's
Platform Administration HTTP surface is limited to exactly five routes,
all in `backend/src/http/routes/platformAdminAuthRoutes.ts`:

- `POST /platform-admin/auth/login`
- `POST /platform-admin/auth/logout`
- `POST /platform-admin/auth/sessions/revoke-all`
- `POST /platform-admin/auth/step-up`
- `GET /platform-admin/auth/whoami`

This app implements those five real, wired to a genuine HTTP client
(`src/api/platformAdminAuthClient.ts`) -- login, MFA, session management,
and step-up re-authentication are fully functional against a running
backend.

Every other route in this app (dashboard KPIs, accounts, entitlements,
entitlement requests, all of billing, admin-user management, audit,
settings) renders a `ComingSoon` component (`src/components/common/ComingSoon.tsx`)
instead of fabricated data, because **no corresponding HTTP endpoint exists
server-side yet**, even though the underlying domain logic does:

| Area | Domain logic exists at | HTTP route status |
|---|---|---|
| Dashboard KPIs | -- (no aggregation service written yet) | missing |
| Accounts (list/detail/suspend/reactivate) | -- | missing |
| Entitlements | `backend/src/entitlements/EntitlementService.ts` | missing |
| Entitlement requests | `backend/src/entitlements/requests/ChangeRequestService.ts` | missing |
| Billing plans | `backend/src/billing/plan.ts` | missing |
| Price book | `backend/src/billing/priceBook.ts` | missing |
| Custom quotes | `backend/src/billing/quote.ts`, `backend/src/entitlements/quote/QuotePort.ts` | missing |
| Invoices | `backend/src/billing/invoice.ts` | missing |
| Payments/refunds/disputes | `backend/src/billing/payment.ts`, `refund.ts`, `dispute.ts` | missing |
| Admin-user management | `backend/src/platformadmin/auth/PlatformAdminAccountService.ts` | missing |
| Audit log (queryable) | `backend/src/platformadmin/audit/PlatformAdminAuditService.ts` | missing |
| Platform settings | -- | missing |

None of this app's code invents a fake production endpoint for any of the
above. Each `ComingSoon` screen states, verbatim, which backend file
implements the domain logic and that no HTTP route wires it up yet, so an
operator (and the next engineer) can tell "not built" from "broken."

RBAC (`src/domain/roles.ts`), navigation gating (`src/nav/navConfig.ts`),
and route guards (`src/rbac/RouteGuard.tsx`) are pre-wired for every one of
these areas per the addendum's Section 3.7 permission matrix, so wiring a
real HTTP client in for any of them is additive -- it does not require any
RBAC or routing rework.
