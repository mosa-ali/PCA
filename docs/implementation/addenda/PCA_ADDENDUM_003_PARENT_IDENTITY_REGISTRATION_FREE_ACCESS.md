# PCA Addendum 003 — Parent Account Identity, Registration, and Free-Access Policy

## Control

| Field | Value |
|---|---|
| Addendum ID | PCA-ADDENDUM-003 |
| Authority | `PCA-DEC-026 = OWNER_APPROVED_OPTION_C` (self-service parent registration, email verification, first-verified-parent family genesis, `FREE_ACCESS` policy) — see `docs/architecture/31_RISK_DECISION_REGISTER.md`; technical decision `docs/implementation/decisions/PCA_IMPL_DECISION_003_PARENT_ACCOUNT_IDENTITY.md` |
| Status | AUTHORING COMPLETE; ARCHITECTURE ONLY — NOT YET IMPLEMENTED; no `PCA-ADD-IDENT-*` source exists in this repository as of this addendum's authoring date (Round5 pre-flight) |
| Baseline | A-100 Architecture v1.0 (199 requirements) and Addendum 001 (25) and Addendum 002 (98) remain immutable and unamended. This addendum is additional authority layered on top |
| Scope | Parent/family account identity, self-service registration, email verification, family genesis on first registration, browser-reachable service-session issuance (`FAMILY_SERVICE_SESSION_V1`), and the `FREE_ACCESS` commercial-access policy a registration snapshots |
| Out of scope | Family Owner commercial authority (unchanged, `PCA-DEC-025`), Platform Administration auth (unchanged, architecturally separate), Family Trust Set cryptography, device enrollment, passkey/WebAuthn (deferred, Option A not selected), Android TV (deferred, out of scope for the whole programme) |
| Authoring date | 2026-08-15 |
| Owning agent | PCA-MASTER-COORDINATOR (Round5 pre-flight governance pass; no source code authored or modified by this document) |

This addendum specifies a new product surface with no source today: a parent/family identity and registration domain, and a platform-configurable free-access commercial policy. Its exact normative inventory is `PCA-ADD-IDENT-001` through `PCA-ADD-IDENT-024`. Implementation mapping, once implementation begins, is maintained in `docs/implementation/PCA_IMPLEMENTATION_TRACEABILITY.md`.

---

## 1. Identity domain separation

**PCA-ADD-IDENT-001** Parent account identity (`backend/src/parentaccount/**`) MUST be an architecturally independent credential domain from Platform Administration (`backend/src/platformadmin/auth/**`) — no shared table, no shared session type, no shared RBAC, restating `PCA-ADD-PA-001`–`005`'s separation principle as binding on this new domain as well.

**PCA-ADD-IDENT-002** A parent service session (`FAMILY_SERVICE_SESSION_V1`) MUST NOT be usable to authenticate into Platform Administration, and a Platform Administration session MUST NOT be usable to authenticate as a parent.

**PCA-ADD-IDENT-003** Email is never stored as a queryable plaintext key. `parentaccount` stores a normalized-lowercase-email hash for lookup/uniqueness only, mirroring the existing `hashAdminEmail` pattern. Password is stored only as a salted hash.

## 2. Registration and email verification

**PCA-ADD-IDENT-004** Registration requires email, password, and password-confirmation (client-side match check is UX only; the server never trusts a client-asserted match — it only ever receives and hashes the single submitted password).

**PCA-ADD-IDENT-005** On submission, PCA generates a single-use, time-bounded, cryptographically random verification code and sends it to the submitted email address via a provider-agnostic sending seam. A `TEST_SANDBOX`-style deliverable-to-logs/test-harness sender is acceptable for this round (matching the existing payment-provider `TEST_SANDBOX` precedent); real provider selection remains `EXTERNAL_GATE`.

**PCA-ADD-IDENT-006** The account remains `PENDING_VERIFICATION` until the correct code is submitted before expiry. No session is issued and no family is created in this state.

**PCA-ADD-IDENT-007** Verification codes are single-use, expire on a bounded TTL, and are rate-limited per account and per source IP to resist brute-force/enumeration.

**PCA-ADD-IDENT-008** On successful verification, the account transitions to `VERIFIED` exactly once; this transition is what produces the `VerifiedIdentity` that `AuthService.issueSession` already requires as its precondition — no new precondition is invented at the `AuthService` layer.

## 3. Family genesis on first registration

**PCA-ADD-IDENT-009** The first successfully verified parent for a not-yet-existing family automatically triggers the existing, architecture-authorized family genesis/bootstrap process (`GenesisAnchorStore`/`FamilyOwnerAttestationChainEngine`, `PCA-DEC-025` Option A) and becomes that family's initial Family Owner. This addendum does not reimplement genesis; it adds the registration trigger.

**PCA-ADD-IDENT-010** First registration MUST NOT require an existing trusted family device or any other family member's prior action — it is the trust root for a new family, not a join flow.

**PCA-ADD-IDENT-011** A second/subsequent registration under a distinct email address does not join an existing family automatically; family joining (invitation-based enrollment) remains governed by the existing invitation/enrollment architecture (doc 05, Addendum 001), unchanged by this addendum.

## 4. Session issuance (`FAMILY_SERVICE_SESSION_V1`)

**PCA-ADD-IDENT-012** A browser service session is issued only after email verification succeeds (registration) or on subsequent successful sign-in against an already-verified account (email + password). Transport is an HttpOnly, Secure-in-production, SameSite=Strict cookie; state-changing routes additionally require a double-submit CSRF token.

**PCA-ADD-IDENT-013** A service session proves account identity only. It MUST NOT be treated as, or substituted for, Family Owner commercial authority anywhere in the implementation. `PCA-DEC-025`'s attestation-chain resolver remains the sole authority for FAMILY_OWNER-gated commercial mutations.

**PCA-ADD-IDENT-014** Session revocation and expiry fail closed: an expired or revoked session cookie is treated identically to no cookie on every subsequent request, never a degraded-but-functional intermediate state.

**PCA-ADD-IDENT-015** A session is bound to exactly one `accountId` at issuance and does not enumerate or switch families; per-request family-scope authorization (`FamilyScopeRecord`/`AuthzService`) is unchanged by this addendum.

**PCA-ADD-IDENT-016** No family private key (FDEK/DSK/DEK/recovery secret) is ever received, derived, or stored by the registration or session-issuance flow, restating `PCA-ADD-PA-004`'s invariant as binding here.

## 5. `FREE_ACCESS` commercial-access policy

**PCA-ADD-IDENT-017** `FREE_ACCESS` is a platform-configurable commercial-access policy, distinct from and layered alongside (never instead of) the `FREE_STARTER` entitlement defaults (`PCA-DEC-022`). It is configured via:

```
FREE_ACCESS_MODE            = TIME_LIMITED | PERPETUAL
FREE_ACCESS_DURATION_DAYS   = administrator-configured when TIME_LIMITED (initial intended value: 30)
DEFAULT_PARENT_MEMBER_LIMIT = administrator-configured
DEFAULT_MANAGED_DEVICE_LIMIT = administrator-configured
```

**PCA-ADD-IDENT-018** Every account snapshots the `FREE_ACCESS` policy in effect at registration time. Changing the platform defaults applies prospectively to new registrations only; it never silently recomputes an existing account's already-snapshotted policy. This mirrors the existing `EntitlementDefaultsRecord` snapshot-on-first-touch discipline (`EntitlementService.getOrCreateForFamily`), extended to this new policy surface — implementation should evaluate whether `DEFAULT_PARENT_MEMBER_LIMIT`/`DEFAULT_MANAGED_DEVICE_LIMIT` here compose with or remain distinct from `entitlement_defaults`' existing `FREE_STARTER` row, and document the exact reconciliation in source comments and the corresponding traceability entry — they must not silently diverge into two uncoordinated sources of truth for the same numbers.

**PCA-ADD-IDENT-019** A bulk/administrative change to an existing account's already-snapshotted `FREE_ACCESS` policy requires an explicit, separately audited action — never a side effect of changing the platform-wide defaults.

**PCA-ADD-IDENT-020** During a `TIME_LIMITED` free period, MyKids displays a daily in-app reminder showing the exact remaining days and expiry date, with a Billing action.

**PCA-ADD-IDENT-021** After expiry of a `TIME_LIMITED` `FREE_ACCESS` policy: parent authentication remains available; Billing remains available; safe account/device status remains available; new paid/commercial capability acquisition is restricted until activation/payment; existing enrolled child protections MUST NOT be disabled, suspended, or removed merely because the commercial free period expired — this restates the `PCA-ADD-PA-023`-style never-force-remove invariant as binding on `FREE_ACCESS` expiry specifically, not only on over-limit entitlement states.

**PCA-ADD-IDENT-022** Expiry of `FREE_ACCESS` does not by itself force `OVER_LIMIT` state — over-limit is an entitlement-capacity concept (Addendum 004); `FREE_ACCESS` expiry only restricts *new* commercial-capability acquisition, consistent with PCA-ADD-IDENT-021.

**PCA-ADD-IDENT-023** `FREE_ACCESS` policy configuration is Platform-Administration-owned and audited, using the same RBAC/step-up discipline `PCA-ADD-PA-024`'s config-not-hardcoded mandate already established for `FREE_STARTER` defaults.

**PCA-ADD-IDENT-024** No dollar/day/limit figure in this document is a fixed production value beyond the explicitly labeled illustrative default (`FREE_ACCESS_DURATION_DAYS` initial intended value: 30 days) — all values are Platform-Administration-configurable at runtime, never hardcoded in source.

---

Total normative inventory: **`PCA-ADD-IDENT-001` through `PCA-ADD-IDENT-024`, 24 requirements.**
