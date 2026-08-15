# PCA implementation decision 003 — parent account identity and family service session

| Field | Decision |
|---|---|
| Status | ACCEPTED — architecture frozen for PCA-AUTH-SESSION-1 (Round5, `FAMILY_SERVICE_SESSION_V1`) |
| Date | 2026-08-15 |
| Authority | `PCA-DEC-026 = OWNER_APPROVED_OPTION_C`, see `docs/architecture/31_RISK_DECISION_REGISTER.md` |
| Scope | `backend/src/auth/**` (identity verification + session issuance extension), a new `backend/src/parentaccount/**` domain, `parent-web/src/api/**` (real session client), plus the `FREE_ACCESS` policy surface this registration flow snapshots. Does not touch Family Owner commercial authority (`PCA-DEC-025`), Platform Administration auth (architecturally separate, unchanged), or device/Family-Trust-Set cryptography. |
| Normative requirements | `PCA_ADDENDUM_003_PARENT_IDENTITY_REGISTRATION_FREE_ACCESS.md`, `PCA-ADD-IDENT-*` |

## Problem

Round4 shipped a genuine, tested `RealBillingClient`/`RealCommercialNotificationClient` in `parent-web` (`PCA-MYKIDS-BILL-3`), but both fail fast with `SERVICE_SESSION_UNAVAILABLE`: no browser-reachable route anywhere in `backend/src/http/routes/*.ts` issues the bearer/service-session token `requireServiceSession` requires. `AuthService.issueSession(identity: VerifiedIdentity)` exists but has zero call sites — it is explicitly documented as requiring its caller to have already performed "a real upstream verification step," and nothing in this repository produces a `VerifiedIdentity`. `parent-web`'s existing `RealServiceAuthClient` independently guesses at an `/api/auth/login` HttpOnly-cookie contract; that guess was never implemented server-side and is architecturally inconsistent with `fastifyAuthPlugin.ts`'s Bearer-header-only session check. Neither side of this mismatch is an approved architecture — both are dead/speculative code this decision resolves by freezing one authoritative model.

## Options considered (per Round5 Section J/K)

- **A — Passkey/WebAuthn.** Real, phishing-resistant, but introduces a full credential-registration ceremony and ongoing platform-authenticator dependency the Owner did not ask for; deferred as a possible future hardening, not this round's scope.
- **B — Trusted-browser relay extending Family Trust Set device-trust.** More native to this codebase's existing device-centric trust model (`RealTrustedBrowserProvider`'s `PAIRING_PENDING` state machine already exists client-side), but requires designing a net-new backend relay + parent-approval protocol from nothing; larger and slower than the Owner's requested self-service flow.
- **C — Self-service email + password registration with email-verification code.** Selected. Matches the Owner's explicit decision text below.
- **D — Defer.** Not selected; the Owner chose to resolve this now.

## Decision

**Owner-approved self-service parent account registration (Option C, `PCA-DEC-026`):**

1. A new parent registers with email, password, and password confirmation. This is a genuinely new credential store — `backend/src/parentaccount/**` — architecturally independent of Platform Administration's `platform_admin_accounts` (no shared table, no shared session type, no shared RBAC; same separation principle `PCA-ADD-PA-001`–`005` already establishes between Platform Administration and MyKids).
2. PCA sends a one-time verification code to the entered email address. The parent enters the code to prove control of the mailbox. This backend has no email-sending or OTP-generation primitive today (confirmed by exhaustive Round5 pre-flight search); both are new.
3. On successful code verification, the account becomes `VERIFIED`. Verification is what produces `AuthService`'s `VerifiedIdentity` — the "real upstream verification step" `issueSession`'s own doc comment already requires. No new session-issuance contract is invented at the `AuthService` layer; a new *identity-producing* step is added upstream of it.
4. The **first** verified parent for a not-yet-existing family automatically initializes a new family and becomes its initial Family Owner through the existing, architecture-authorized family genesis/bootstrap process (`backend/src/familycommercial/authority/GenesisAnchorStore`/`FamilyOwnerAttestationChainEngine`, `PCA-DEC-025` Option A) — registration triggers genesis, it does not reimplement it.
5. PCA issues the browser service session only after step 3. Transport: **HttpOnly, Secure (in production), SameSite=Strict cookie** — not a bearer token in a JS-readable response body or storage. This supersedes `RealServiceAuthClient`'s speculative cookie guess by actually implementing the missing server side of it, and supersedes `fastifyAuthPlugin.ts`'s Bearer-only check by adding cookie support without removing service-to-service Bearer support where that's still appropriate (`bootstrapRoutes.ts`/`invitationRoutes.ts`/`pairingRoutes.ts`/`retentionRoutes.ts` keep their existing Bearer-based `requireServiceSession` usage unchanged; the new cookie path is additive, gated by the frozen `FAMILY_SERVICE_SESSION_V1` contract, not a silent redefinition of the existing plugin's semantics for its current callers).
6. The account automatically receives the platform-configured `FREE_ACCESS` policy (see `PCA_ADDENDUM_003` for the full policy model) — snapshotted at registration time, never recomputed from a later-changed default.
7. **No PCA Administrator approval is required** for ordinary registration — this is unlike every existing Platform-Administration-mediated entitlement mutation (`device-override`, `setEntitlementLimit`), which are deliberately admin-initiated. Registration is the one place a family-facing action changes commercial entitlement state without an admin actor, and it is bounded by the platform-admin-*configured* `FREE_ACCESS` defaults, not by an unbounded self-service grant.
8. **First registration never requires an existing trusted family device.** This is a deliberate divergence from the device-centric bootstrap Option B would have required — registration is the trust root for a brand-new family, not something that presupposes trust already exists.

**Explicit non-collapse (binding invariant):** a service session proves account identity only — "this is a recognized, email-verified parent account." It never implies Family Owner commercial authority. `PCA-DEC-025`'s Option-A genesis-anchored attestation chain remains the sole mechanism that answers "is this caller the Family Owner" for commercial mutations (checkout-CREATE, entitlement request create/cancel). A freshly registered parent *is* the Family Owner of their newly-genesis-anchored family (step 4), but that fact is established by the attestation chain, not inferred from the session.

## Session contract — `FAMILY_SERVICE_SESSION_V1` (frozen)

- **Transport**: HttpOnly, Secure (production), SameSite=Strict cookie. CSRF: state-changing routes require a double-submit CSRF token (a non-HttpOnly companion cookie echoed in a custom request header) — cookie presence alone never authorizes a mutation.
- **Establish**: only as a side effect of successful registration + email verification, or successful sign-in (email + password, verified account) — see `PCA_ADDENDUM_003` for exact routes.
- **Read**: a `whoami`-equivalent route reads current session state (account recognized, `familyId` if resolved) without re-verifying credentials.
- **Revoke/logout**: explicit route; also **fail closed** on expiry — an expired or revoked cookie is treated identically to no cookie, never a degraded-but-functional state.
- **Scope**: a session is bound to exactly one `accountId` at issuance; it does not enumerate or switch families. Cross-family access still requires the existing `FamilyScopeRecord`/`AuthzService` check per request, unchanged.
- **No raw identity stored where architecture requires opaque hashes**: `parentaccount` stores only a normalized-lowercase-email hash for lookup/uniqueness (mirroring `hashAdminEmail`'s pattern), never plaintext email as a queryable key; password is stored only as a salted hash (Platform Administration's `passwordCredential.ts` pattern is the precedent, adapted, not shared).
- **No family private key transferred to server, ever** — registration and session issuance touch only the new `parentaccount` credential domain and the existing genesis/attestation-chain bootstrap; they never receive, derive, or store FDEK/DSK/DEK/recovery-secret material (restates `PCA-ADD-PA-004`'s invariant as binding on this new domain too).
- **No reusable secret logged**: verification codes and password hashes are never written to `platform_admin_audit_events`-style logs or application logs in plaintext or hash form beyond what's strictly needed for rate-limiting/lockout bookkeeping.

## Reconciliation with `PCA-DEC-022` (FREE_STARTER)

`FREE_STARTER` (`PCA-DEC-022`) is an **entitlement-defaults** tier: `parentMemberLimit`/`managedDeviceLimit` numbers a family's entitlement row snapshots on first touch. `FREE_ACCESS` (this decision) is a **broader commercial-access** policy: it additionally gates whether *any* new paid/commercial capability is available at all, on a `TIME_LIMITED | PERPETUAL` basis, independent of the specific limit numbers. A registration snapshots both: the family's entitlement row still resolves through the existing `EntitlementService.getOrCreateForFamily`/`FREE_STARTER_TIER` path unchanged, and the account additionally snapshots the platform-configured `FREE_ACCESS` policy (mode, duration, and the `DEFAULT_PARENT_MEMBER_LIMIT`/`DEFAULT_MANAGED_DEVICE_LIMIT` the Owner specified as themselves platform-admin-configurable — see `PCA_ADDENDUM_003` for whether/how these map onto or extend the existing `entitlement_defaults` table). This decision does not redefine, weaken, or delete `PCA-DEC-022`; `PCA_ADDENDUM_003` must show its exact worked reconciliation before Writer57/58 implement either.

## Consequences and gates

- This is new schema (a `parentaccount` credential domain) and a new email-sending capability — both require a dedicated migration lease and, for email, a provider-agnostic sending seam (real provider selection is out of scope this round; a `TEST_SANDBOX`-style deliverable-to-logs/test-harness sender is acceptable for now, matching the existing payment-provider `TEST_SANDBOX` precedent).
- `RealServiceAuthClient`'s existing `signIn(email, password)` code becomes real, live-tested code once the server side exists — Writer57 must verify its current implementation actually matches the cookie/CSRF contract above, not assume it's already correct merely because it compiles.
- Full negative-test matrix required (unverified identity, malformed proof, disabled account, expired/revoked session, wrong family, cross-family replay, session fixation, CSRF, XSS token-exposure absence) — see `ROUND5_AGENT57_ASSIGNMENT.md`.
- Family Owner commercial authority (`PCA-DEC-025`) is unchanged by this decision and must not be re-derived from session state anywhere in the implementation.
