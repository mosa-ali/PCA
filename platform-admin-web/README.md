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
npm run test          # vitest unit/component/RBAC/i18n/a11y suite
npm run test:e2e      # Playwright (mocks the backend at the HTTP boundary -- see e2e/*.spec.ts headers)
npm run test:e2e:real # Playwright against a REAL backend + MySQL (see e2e-real/realBackend.spec.ts header)
npm run build
```

## Backend integration status (PCA-PA-3C, live)

Every route this app calls is now real and live server-side (Agent51's
`backend/src/http/routes/platformadmin/*` surface -- accounts, entitlements
+ requests, plans, price book, quotes, subscriptions/invoices/payments/
refunds/disputes (read-only), admin-users, audit, settings, dashboard).
Every page in this app (Dashboard, Accounts, Entitlements, Entitlement
Requests, Plans, Price Book, Custom Quotes, the read-only billing views,
Admin Users, Audit, Settings) calls the real HTTP surface through
`src/api/platformAdminApiClient.ts` -- no page renders a `ComingSoon`
placeholder or fabricated data. This was verified against an actual
Fastify + MySQL backend process (see `e2e-real/realBackend.spec.ts`'s
header for the exact bootstrap sequence), not merely against the mocked
`e2e/*.spec.ts` suite.

Two deliberate exceptions, both honest "unavailable" states rather than
simulated success (see `ROUND4_INTERFACE_CONTRACTS.md`'s explicit-gaps
list):

- **Family-account suspend/reactivate**: no such route exists (no
  authoritative account-status model). `AccountDetail.tsx` renders disabled
  Suspend/Reactivate buttons with an explicit "unavailable" message --
  never a fake success toast.
- **Refund issuance, subscription subscribe/cancel/modify, settlement
  provider config**: no write routes exist on this surface at all; not
  represented as actionable UI anywhere in this app.

Money is handled exclusively via `src/money/money.ts`: every `amountMinor`
is a wire decimal-integer STRING (never a JS `number`), parsed to an exact
`BigInt` and only ever formatted for display after that exact-safe
validation -- see that file's header for the full contract.

RBAC (`src/domain/roles.ts`, `src/domain/billingRbac.ts`), navigation
gating (`src/nav/navConfig.ts`), and route guards (`src/rbac/RouteGuard.tsx`,
`src/rbac/BillingRouteGuard.tsx`) are UI hints only, independently
cross-checked against `backend/src/platformadmin/auth/rbacPolicy.ts`'s and
`backend/src/billing/rbac.ts`'s real operation matrices -- the server
remains the sole authorization authority for every mutating request.
