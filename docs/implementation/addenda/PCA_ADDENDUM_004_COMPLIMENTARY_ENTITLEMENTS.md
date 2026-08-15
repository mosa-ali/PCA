# PCA Addendum 004 — Complimentary Entitlement Grants

## Control

| Field | Value |
|---|---|
| Addendum ID | PCA-ADDENDUM-004 |
| Authority | Owner-approved complimentary-entitlements programme (Round5 Section A) — recorded as part of `PCA-DEC-026`'s decision scope in `docs/architecture/31_RISK_DECISION_REGISTER.md` (complimentary grants are the commercial-capacity counterpart to that decision's identity/registration/free-access scope; they share invariants but are a distinct domain, hence a separate addendum rather than folding into Addendum 003) |
| Status | AUTHORING COMPLETE; ARCHITECTURE ONLY — NOT YET IMPLEMENTED; no `PCA-ADD-COMP-*` source exists in this repository as of this addendum's authoring date (Round5 pre-flight) |
| Baseline | A-100 Architecture v1.0, Addendum 001, Addendum 002, and Addendum 003 remain immutable and unamended |
| Scope | Durable, explicit, audited grants of additional entitlement capacity (and, distinctly, `COMMERCIAL_ACCESS`) to selected accounts/families at no charge |
| Out of scope | PriceBook/Quote/Payment mechanics (unchanged, Addendum 002), Family Owner commercial authority (unchanged, `PCA-DEC-025`), any HR/staff-directory integration (explicitly not built this round) |
| Authoring date | 2026-08-15 |
| Owning agent | PCA-MASTER-COORDINATOR (Round5 pre-flight governance pass; no source code authored or modified by this document) |

Its exact normative inventory is `PCA-ADD-COMP-001` through `PCA-ADD-COMP-025`.

---

## 1. What this is not

**PCA-ADD-COMP-001** A complimentary entitlement grant is NOT `paymentBypass=true`, NOT a zero-price global PriceBook entry, NOT a fake successful payment, and NOT a fake Invoice. It is a durable, explicit, audited grant record, architecturally distinct from every object in the Billing domain (Addendum 002 Sections 7–10).

**PCA-ADD-COMP-002** A complimentary grant MUST NOT create an Invoice, PaymentAttempt, PaymentTransaction, or provider event of any kind, under any circumstance. PriceBook itself remains completely unchanged by this addendum.

## 2. Grant model

**PCA-ADD-COMP-003** A complimentary grant is a durable record with at minimum: `grantId`, an opaque account/family reference, `entitlementType` (which capacity it affects), `category` (Section 3), the granted amount or approved resulting allowance, `effectiveFrom`, `expiresAt` (nullable — permanent grants have no expiry), `status`, a reason code, an optional internal note, `grantedByAdminId`, `createdAt`, `revokedAt`/`revokedByAdminId` (nullable), and a revision/version for optimistic-concurrency-safe mutation. The exact field set and table design is frozen by Writer58's implementation against this list before coding, not invented ad hoc per field.

**PCA-ADD-COMP-004** Grants apply to exactly one of `MANAGED_DEVICE_CAPACITY`, `PARENT_MEMBER_CAPACITY`, or `COMMERCIAL_ACCESS` (a grant of the free-access-policy kind described in Addendum 003 Section 5, extended here to non-registration-time grants — e.g. a staff family granted perpetual `COMMERCIAL_ACCESS` outside the registration flow). The three are never combined into one record or one counter.

**PCA-ADD-COMP-005** Effective entitlement is computed, never stored redundantly: `EFFECTIVE_ENTITLEMENT = BASE/PLAN_ALLOWANCE + sum(ACTIVE complimentary grants for that entitlementType)`, or another mathematically equivalent model the implementation freezes explicitly in source comments before coding. Prior grants are never double-counted, and the base allowance (`entitlement_defaults`/family entitlement row) is never mutated in place by a grant — `managedDeviceLimit += delta` as a direct, repeatable mutation on the base row is explicitly prohibited; the base row stays the base, and grants are summed on top at read/decision time.

**PCA-ADD-COMP-006** Grant activation and revocation are idempotent: retrying an activation or revocation request for the same grant (same `grantId`, same target state) MUST NOT change the effective entitlement a second time or create a duplicate audit trail.

## 3. Grant categories

**PCA-ADD-COMP-007** Supported categories, as a bounded enum/config (not free text): `FOUNDER`, `STAFF`, `STAFF_FAMILY`, `BETA_TESTER`, `PARTNER`, `PROMOTION`, `SUPPORT_EXCEPTION`, `LIFETIME_COMPLIMENTARY`, `TEMPORARY_COMPLIMENTARY`, `OTHER`.

**PCA-ADD-COMP-008** Staff status is never inferred from email domain or any other heuristic. `STAFF`/`STAFF_FAMILY` grants are manually, admin-authoritatively granted or revoked. No HR system integration is invented in this release.

**PCA-ADD-COMP-009** A PCA employee receiving a `STAFF`/`STAFF_FAMILY` grant remains an ordinary family member inside MyKids. The grant confers commercial eligibility only — never Platform Admin access from a family session, never family E2EE bypass, never access to another staff member's family, never support-master access. Employee/Platform-Admin identity and family-role authority remain architecturally separate, restating `PCA-ADD-PA-004`'s "no support master key" principle as binding on staff grants specifically.

## 4. Billable capacity above the grant

**PCA-ADD-COMP-010** Capacity requested above the family's currently active complimentary allowance follows the normal PriceBook/quote/payment rules unchanged (Addendum 002 Sections 9–10) — e.g. a family with an active complimentary `MANAGED_DEVICE_CAPACITY` allowance of 5 pays nothing for a target of 5 or below, and enters the ordinary paid quote/payment flow for any target above 5.

## 5. Expiry and revocation

**PCA-ADD-COMP-011** When a temporary grant expires or an active grant is revoked, effective entitlement is recomputed per PCA-ADD-COMP-005. If current usage now exceeds the new effective limit, the family enters `OVER_LIMIT` — the same state the existing entitlement model already uses for any over-capacity condition (no new terminal state is invented).

**PCA-ADD-COMP-012** Expiry or revocation MUST NEVER automatically unenroll a device, remove a family member, delete a child profile, or disable an existing occupant. It only blocks *new* capacity consumption until the family becomes compliant (removes something itself) or acquires capacity (paid or newly granted).

## 6. Authority and RBAC

**PCA-ADD-COMP-013** A family cannot create, edit, or revoke its own complimentary grant under any circumstance — this is exclusively a Platform Administration operation, server-authorized, never client-trusted.

**PCA-ADD-COMP-014** Role matrix (frozen; Writer58 must not diverge without an `INTERFACE_CHANGE_REQUEST`):

| Role | Authority |
|---|---|
| `APP_OWNER` | Full grant authority: create, change, revoke, renew/extend; the only role that may issue `LIFETIME_COMPLIMENTARY`/permanent grants by default |
| `PLATFORM_ADMIN` | Grant/revoke only within Owner-configured bounds (bounded delegation); permanent/lifetime grants remain `APP_OWNER`-only unless a future frozen architecture change explicitly widens this |
| `FINANCE_ADMIN` | Read/audit only, unless explicitly authorized for a specific bounded operation |
| `SUPPORT_ADMIN` | Read support-safe status only (no category/internal-note visibility beyond what Section 8 allows externally — Support sees what it needs to help a family, not necessarily the internal reasoning) |
| `AUDITOR_READ_ONLY` | Read only |

**PCA-ADD-COMP-015** Any grant/revoke/change mutation requires step-up (reusing the existing `PLATFORM_ADMIN_STEP_UP_SCOPES` mechanism; a new scope, e.g. `COMPLIMENTARY_GRANT_MUTATION`, is added to that enum rather than reusing `ENTITLEMENT_LIMIT_OVERRIDE` for a semantically distinct operation).

## 7. Audit

**PCA-ADD-COMP-016** At minimum, audit event types `COMPLIMENTARY_GRANT_CREATED`, `COMPLIMENTARY_GRANT_CHANGED`, `COMPLIMENTARY_GRANT_REVOKED`, `COMPLIMENTARY_GRANT_EXPIRED` (or the exact accepted vocabulary Writer58 aligns with `PlatformAdminAuditService`'s existing `eventType` conventions) are written for every grant lifecycle transition, with safe metadata only (grantId, category, entitlementType, targetLimit/amount, reason code, actor) — never family activity data.

## 8. Display surfaces

**PCA-ADD-COMP-017** Platform Administration → Accounts → Entitlements → Complimentary Capacity shows: base/current allowance, active complimentary grants, effective total, expiry, status, and safe reason/category, with grant/change/revoke/renew actions gated per Section 6. The frontend hiding a control for a denied role is a UX convenience only — server RBAC is authoritative regardless of what the UI shows or hides.

**PCA-ADD-COMP-018** MyKids may safely display: plan, base included capacity, complimentary capacity, effective total, active/reserved/available counts, and expiry if relevant — e.g. "FREE STARTER — Included devices: 1 — Complimentary devices: 4 — Total allowance: 5."

**PCA-ADD-COMP-019** MyKids MUST NEVER display: the internal note, any employee/staff record detail, the granting admin's ID, or internal support reasoning.

**PCA-ADD-COMP-020** Product copy MUST avoid language such as "payment bypass" anywhere in the family-facing surface — the family-facing framing is additional included capacity, not a description of circumventing billing.

## 9. Concurrency

**PCA-ADD-COMP-021** Real DB tests are required for: duplicate grant activation, concurrent grant + revoke on the same grant, concurrent effective-limit recalculation, an expiry race (grant expiring while a request that depends on it is in flight), and a grant-mutation racing a paid entitlement change on the same family. No test may produce a double-counted capacity result.

**PCA-ADD-COMP-022** Grant state transitions use database-authoritative conditional updates (the same pattern `QuoteRepository.tryConsume`'s conditional `UPDATE ... WHERE status = 'ACTIVE'` already establishes for the Billing domain), never an in-memory lock as correctness authority, since more than one backend instance may process a mutation concurrently.

## 10. Migration and schema

**PCA-ADD-COMP-023** Complimentary grants use their own dedicated migration and table(s), never overloaded onto `entitlement_defaults` (which remains the `FREE_STARTER` base-tier-default table only, per `PCA-DEC-022`) or onto any Billing-domain table.

**PCA-ADD-COMP-024** The migration lease for this addendum is assigned by the Coordinator from the actual next-free migration number at Writer58 launch time — never assumed in advance from a stale inventory.

**PCA-ADD-COMP-025** No production/Azure SQL is touched by this addendum's implementation or tests; disposable Docker Compose MySQL only, per the existing repository-wide database governance convention.

---

Total normative inventory: **`PCA-ADD-COMP-001` through `PCA-ADD-COMP-025`, 25 requirements.**
