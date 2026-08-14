# PCA implementation decision 002 — server-verifiable Family-Owner commercial authority

| Field | Decision |
|---|---|
| Status | `OWNER_APPROVED_OPTION_A` — `IMPLEMENTED_SOURCE_READY_FOR_COORDINATOR_REVIEW` (source-complete, tested; NOT yet wired as the production default — see PCA-FAMILY-AUTH-1-R1's `SHARED_INTEGRATION_REQUIRED`) |
| Date | 2026-08-14 (proposed), owner-approved and implemented same day (R1) |
| Originating lane | PCA-FAMILY-AUTH-1 / PCA-FAMILY-AUTH-1-R1 (worktree `claude-53-family-authority`, base `e989c67b`) |
| Scope | Whether/how PCA's backend may ever independently verify "this authenticated family session currently holds FAMILY_OWNER authority" for an HTTP-only commercial mutation (e.g. checkout), without a new server role ACL, an unsigned client claim, or family private key custody |
| Prior art | `backend/src/billing/authority/FamilyCommercialAuthorityResolver.ts` (PCA-BILL-2A-R1) already named this exact gap and shipped `UnavailableFamilyCommercialAuthorityResolver` as the fail-closed production default; `backend/src/childprofiles/ChildProfileMembershipResolver.ts` independently hit the identical shape for `CHILD_PROFILE` membership |
| R1 implementation | `backend/src/familycommercial/authority/**` (genesis anchor + attestation-chain engine/stores), `backend/src/billing/authority/FamilyCommercialAuthorityResolver.ts` (`AttestationChainFamilyCommercialAuthorityResolver` production candidate), `backend/migrations/0011_family_commercial_authority.sql`. Full test matrix (bootstrap/tamper/transfer/stale/revoked/cross-family/cross-member, plus real-MySQL genesis-race and chain-head-race concurrency) passes across two independent clean rooms. See PCA-FAMILY-AUTH-1-R1's final report for the complete gate results. |

## Why this is a decision, not a task

Doc 09 (`09_SECURITY_PRIVACY_E2EE.md`) §3.2 defines the Family Trust Set (FTS) as "a signed, versioned family object, not a server ACL," verified only by each **receiving device** against its own locally-held copy (PCA-SEC-017). §5.2 additionally lists "the plaintext of any policy content (screen-time rules, filter lists, **RBAC assignments**)" as a data class PCA infrastructure **MUST NOT** hold readable, and PCA-SEC-023 makes that a structural (schema-incapable-of-holding-it), not merely policy, guarantee.

Repository inventory for this lane (full detail below) confirms the backend today has:

- no family-scoped trust anchor (no root/genesis public key the server can use to verify a role claim);
- no server-visible FTS epoch/version;
- no revocation source beyond opaque device-key routing bookkeeping;
- no defined signed "role proof" format a client could submit;
- only a coarse `service_account_family_scopes` flag ("this account has *a* scope on this family," never a role).

Every existing resolver in this shape (`FamilyCommercialAuthorityResolver`, `ChildProfileMembershipResolver`) therefore fails closed to `AUTHORITY_UNAVAILABLE` by design, per the mission's own forbidden-shortcuts list (no `family_roles` server ACL, no unsigned role claim, no header/JWT role without cryptographic linkage to the accepted FTS, no "first parent"/device-owner heuristic, no support or platform-admin override). None of the forbidden shortcuts were introduced. No new trust artifact exists in the accepted architecture that would let the server close this gap safely, so per the mission's Conditional Implementation Rule (§5), implementation **stops here** and this package is returned instead.

## Inventory (server-verifiable evidence available today)

| Question | Answer | Evidence |
|---|---|---|
| `TRUST_ANCHOR_AVAILABLE_TO_SERVER` | NO | `familytrustset/FamilyTrustSetStore.ts` header: device-local state, "never a server-side source of truth." No family root/genesis public key table exists (`backend/migrations/0001_mysql_baseline.sql`). |
| `CURRENT_FTS_AVAILABLE_TO_SERVER` | NO | Server sees only opaque ciphertext (`relay_envelopes`, `recovery_envelopes`), never FTS role/epoch content. |
| `PUBLIC_SIGNATURE_KEYS_AVAILABLE` | PARTIAL | `device_public_keys` (DSK/DEK, per device) is registered at enrollment — proves device identity/possession, carries no role or FTS linkage. |
| `FTS_VERSION_AVAILABLE` | NO | No `trust_set_epoch`/`key_epoch` column tied to role state anywhere server-side. (`familyenvelope/DataVersionLedger.ts` tracks a *policy semantic version* floor for envelope replay — a different, unrelated concept.) |
| `REVOCATION_AVAILABLE` | PARTIAL | `devices.revoked_at` / `device_public_keys.status` and the doc 09 §5.1 "revocation intent record" are routing/delivery bookkeeping only, explicitly not an authoritative role-revocation source. |
| `SESSION_TO_FAMILY_BINDING` | YES (weak) | `service_account_family_scopes` (`account_id`, `family_id`, `status`) — comment: "NOT family RBAC." |
| `SESSION_TO_MEMBER_BINDING` | NO role | `service_sessions` binds session → `account_id` only; no role. |
| `ROLE_PROOF_FORMAT_EXISTS` | NO (server-verifiable) | The FTS epoch (`FamilyTrustSetEpoch`) is the signed, role-bearing object, but it is device-local; no endpoint or verifier accepts one server-side today. |
| `REPLAY_PROTECTION_EXISTS` | YES, wrong layer | `familyenvelope/ReplayLedger.ts` + doc 09 §4 cover generic family-control envelopes, not a role-proof submission (none exists to protect). |

`NEW_SERVER_ROLE_ACL_CREATED = NO`, `FAMILY_PRIVATE_KEY_REQUIRED = NO`, `CLIENT_ROLE_CLAIM_TRUSTED = NO` for every option below — none of them relax these.

## Options

### OPTION A — Genesis-anchored Owner attestation (new cryptographic protocol)

At family creation, the genesis Owner's DSK public key is registered server-side as a **per-family root of trust** (the enrollment/licensing service already independently corroborates the account at that moment, per doc 09 §5.1's "account/license relationship" row). Every subsequent FTS epoch rotation is signed transitively back to that root (owner-DSK-signs-next-epoch, per `familytrustset/types.ts`'s existing signature model). A new, minimal-disclosure artifact — an **Owner Epoch Attestation** (`familyId`, `trustSetEpoch`, `ownerDeviceId`, `ownerDskKeyId`, chain-of-custody signature, short TTL) — is what a device submits alongside a commercial mutation; the server verifies the signature chain back to its stored root and the epoch is fresh, without ever learning the rest of the FTS (which members exist, Administrator/Viewer/Child assignments stay undisclosed).

- **Trust model**: root-of-trust-at-enrollment + signature chain; server never sees full RBAC, only "who is the current Owner, as of which epoch."
- **Server knowledge**: one new durable fact per family (root public key) + a bounded attestation cache (epoch number, owner device/key ID, expiry) — verification/cache metadata only, not a role ACL.
- **Crypto proof**: yes, real — server-verifiable signature chain, not a self-assertion.
- **Revocation**: an epoch rotation that removes/replaces the Owner immediately invalidates prior attestations (chain no longer resolves to the new epoch); TTL bounds staleness between rotations.
- **Privacy**: consistent with doc 09 §5.1's existing "public keys are MAY-know" allowance; discloses only the Owner's device identity per epoch, nothing else in the FTS.
- **Migration impact**: new table(s) for the root key and attestation cache (candidate `0011_family_commercial_authority.sql`); no changes to §5.2's RBAC-plaintext prohibition.
- **Client changes**: Android/iOS device signing code must compute and expose the chain-of-custody signature at epoch-rotation time — cross-platform work, not backend-only.
- **Security tradeoff**: the strongest fidelity to "cryptographic Family-Owner enforcement, no server ACL" of the three; also the highest engineering cost and the only one requiring new client-side crypto plumbing and a doc 09/18 amendment.

### OPTION B — Interactive step-up co-signature (no new durable trust artifact)

A commercial mutation that needs Owner authority creates a pending action and relays a signing challenge (reusing the existing `deviceauth` nonce/`DeviceSignatureVerifier` proof-of-possession plumbing) to the family's devices. The device that locally resolves itself as Owner (via its own FTS copy, exactly as `ParentActionAuthorizationService` already does for other actions) signs the nonce; the server verifies the signature against that device's already-registered DSK public key and completes the mutation. No role is stored or asserted server-side beyond "this already-registered device answered this challenge."

- **Trust model**: possession-based (WebAuthn-like), not role-based; the *role* determination stays entirely device-local, exactly as today — the server only learns "a device I already trust answered."
- **Server knowledge**: none new beyond a short-lived challenge/response record (reuses existing `device_challenges`-style pattern).
- **Crypto proof**: proof of possession of a registered device key, not proof of Owner role — closing the gap requires trusting the responding device's own local FTS check, which is a materially weaker guarantee than Option A (any device with a valid, registered DSK could in principle answer if its own local check were compromised, whereas Option A's chain proof is independently verifiable by the server).
- **Revocation**: immediate — a revoked device fails proof-of-possession outright (already-existing mechanism).
- **Privacy**: no RBAC content leaves the device at all.
- **Migration impact**: small — a challenge/response table, reusing existing `deviceauth` primitives; no new root-of-trust concept.
- **Client changes**: moderate — new challenge-handling UX ("approve this purchase") on whichever device is Owner; must be online, or the mutation fails closed.
- **Security tradeoff**: cheaper and reuses existing infrastructure, but changes the checkout UX (synchronous completion becomes conditional on an online Owner device answering a challenge) and only proves possession, not role — needs explicit product/security sign-off that this substitution is acceptable.

### OPTION C — Decouple commercial authority from family RBAC (product redefinition, no new crypto)

Treat "who may authorize spend" as a distinct, already-server-resolvable concept — the account holder of record (doc 09 §5.1's "account/license relationship," already legitimately server-known) — rather than the cryptographic FAMILY_OWNER role. Family-role-based Owner/Administrator distinctions remain a client-presented policy, not a server-enforced gate, for this one action class. Alternatively, Owner-gated commercial mutations route through an existing human-mediated or re-authenticated web-portal session the server already trusts (account credentials), explicitly separating "commercial Owner" from "family-RBAC Owner."

- **Trust model**: commercial authority = account of record, not FTS role.
- **Server knowledge**: nothing new — reuses existing account/license state.
- **Crypto proof**: none needed; not solving the stated problem cryptographically, redefining it instead.
- **Revocation**: whatever the account/license system already does.
- **Privacy**: strictly better (no new disclosure at all).
- **Migration impact**: none.
- **Client changes**: minimal.
- **Security tradeoff**: cheapest, ships immediately, but changes the *security promise* — "the FTS Owner authorizes spend" becomes "the account holder authorizes spend," which may silently reopen the exact Administrator-can-pay concern PCA-BILL-2A-R1 closed if the account holder and FTS Owner are ever allowed to diverge. This is a product-scope question for the owner, not a safe default to adopt unilaterally.

## Recommendation

Option A if the product requires a genuine cryptographic Family-Owner guarantee for commercial actions (most consistent with doc 09's stated trust model, at the cost of new client-side crypto work across Android/iOS). Option B as a faster interim if an interactive step-up UX for Owner-gated commercial actions is acceptable. Option C only as an explicit, owner-approved product scoping decision — never as a silent substitute for A/B, since it changes what "Family Owner authorizes this" actually means.

**Owner ruling (PCA-FAMILY-AUTH-1-R1, 2026-08-14): Option A approved.** Option B and Option C are explicitly NOT selected.

## R1 implementation summary

Option A is now source-complete: a per-family genesis anchor (`FamilyAuthorityGenesisAnchor`, self-signed by the founding device's DSK at the server-authorized bootstrap ceremony) plus an append-only, signature-verified Owner-attestation chain (`FamilyOwnerAttestation`, each transfer signed by the OUTGOING Owner's DSK, never self-certified by the incoming Owner) — `backend/src/familycommercial/authority/`. The server durably stores only verification/lineage metadata (genesis public key, attestation chain rows, a current-head pointer) — never a role ACL, never private key material, never the rest of the family trust set (Administrator/Viewer/Child assignments stay device-side per doc 09 §5.2).

`AttestationChainFamilyCommercialAuthorityResolver` (`backend/src/billing/authority/FamilyCommercialAuthorityResolver.ts`) is the production candidate, implementing the SAME resolver interface `billingCheckoutRoutes.ts` already depended on (now `async` — a compile-only signature extension, with the one required `await` + two new fail-closed status branches added to that route; see PCA-FAMILY-AUTH-1-R1's SHARED_INTEGRATION_REQUIRED for why this was unavoidable and exactly what changed). `resolveCurrentOwner` re-verifies the stored head's signature live on every call (defense-in-depth against a tampered row) and checks freshness/revocation against `expiresAt`/`status` — never trusting a persisted boolean alone.

Full required test matrix passes (bootstrap/genesis, tamper matrix, Owner transfer, stale/revoked matrix, cross-family/cross-member denial, genesis-race and chain-head-race concurrency against two independent real-MySQL clean rooms, restart/multi-instance durability, schema-privacy). `UnavailableFamilyCommercialAuthorityResolver` remains the actual production default until a Coordinator performs the main.ts wiring change (not done by this lane — see SHARED_INTEGRATION_REQUIRED).
