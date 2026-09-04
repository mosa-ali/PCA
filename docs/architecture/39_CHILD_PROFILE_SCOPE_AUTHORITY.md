# 39 — Child-Profile Target Membership Authority

## 1. Scope and gap closed

Doc 18 Section 3 already requires every parent action to carry a `targetScope`, and PCA-10's `ParentActionAuthorizationService` (`backend/src/familyrbac/`) already cross-checks `DEVICE`/`MEMBER` targets against the same verified Family Trust Set the acting device's role was resolved from. Until this document, `CHILD_PROFILE` targets were the one `TargetScopeKind` (doc 18/`familyrbac/types.ts`) with no equivalent check: a legitimately resolved Owner/Administrator of family A could name any `childProfileId`, including one belonging to family B, and the authorization pre-check passed it through untouched. This is `PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION` — a target-scope IDOR, structurally identical in shape to the DEVICE/MEMBER gap doc 18 already closes, just on the one target kind that had no directory to check against.

This document defines the closing mechanism: `ChildProfileMembershipResolver` (`backend/src/childprofiles/`), its integration into `ParentActionAuthorizationService`, and the fail-closed contract every caller and future backing implementation must honor.

## 2. Membership resolver contract

```
resolveMembership(familyId, childProfileId) -> MEMBER_OF_FAMILY | NOT_MEMBER | NOT_FOUND | UNAVAILABLE
```

`familyId` is always the value the acting device's role was ALREADY resolved from by `TrustSetRoleResolver` — never a value read back off the target, never a value asserted by the client. A `familyId` the client supplies is not proof of anything; this module never treats it as such.

Four honestly distinct outcomes, mirroring `ActorResolutionFailure`'s existing shape:

- **MEMBER_OF_FAMILY** — the profile exists and belongs to the queried family. The only outcome that lets evaluation proceed to the ordinary role/step-up matrix.
- **NOT_MEMBER** — the profile exists but belongs to a different family.
- **NOT_FOUND** — no such profile exists.
- **UNAVAILABLE** — the resolver could not determine membership (no backing source wired, backing source errored or timed out).

## 3. Fail-closed default, no central directory

Section 4 of the PCA10 lane brief is explicit: this module does not ship a readable central child-profile directory merely to make the pre-check convenient. `ParentActionAuthorizationService`'s default constructor argument is `UnavailableChildProfileMembershipResolver`, which returns `UNAVAILABLE` unconditionally. Every non-`MEMBER_OF_FAMILY` outcome — `NOT_MEMBER`, `NOT_FOUND`, `UNAVAILABLE`, and a malformed profile id caught before the resolver is even consulted — denies the action. A production deployment that forgets to inject a real, trustworthy resolver denies `CHILD_PROFILE`-targeted operations; it does not silently reopen the IDOR by defaulting to allow.

Wiring a real resolver backed by a trusted endpoint or verified local family state (an async source, a Coordinator-owned adapter over local storage, etc.) is explicitly left as a separate, later Coordinator binding (lane brief Section 13). `StaticChildProfileMembershipResolver` in this module is a reference/test-only implementation — an explicit static map a caller populates from whatever trustworthy source it has, never a queryable directory this module exposes on its own.

## 4. Integration point

`ParentActionAuthorizationService.evaluate()` gained one branch, positioned identically to the existing DEVICE/MEMBER cross-check and running before the role/step-up matrix:

1. Reject a malformed `targetScope.id` (empty or over length) without ever calling the resolver.
2. Call `resolveMembership(request.familyId, request.targetScope.id)`.
3. Anything other than `MEMBER_OF_FAMILY` denies with the SAME public reason (`CROSS_FAMILY_TARGET`) as every other target-resolution failure shape.

The resolver is consulted fresh on every `authorize()` call — this service holds no membership cache of its own, so a family reassignment or profile removal on the backing source is reflected on the very next call, not served stale.

## 5. Error oracle

Lane brief Section 6: public behavior must never let a caller distinguish "this profile exists in another family" from "this profile doesn't exist" from "membership couldn't be checked." All four `ChildProfileMembershipStatus` values other than `MEMBER_OF_FAMILY`, and the malformed-id short-circuit, collapse to the identical `AuthorizationDenyReason` (`CROSS_FAMILY_TARGET`) already used for cross-family `DEVICE`/`MEMBER` targets. No new deny reason was introduced for `CHILD_PROFILE` specifically — introducing one would itself have been an oracle.

## 6. Offline and reconnect re-validation

Doc 18 Section 1's governing rule — the receiving/deciding endpoint's own live check is the true authority, never a cached UI decision or a value trusted merely because it was queued while offline — already structures `ChildRequestService.decide()` (`backend/src/childrequests/`): `decide()` calls `ParentActionAuthorizationService.authorize()` at APPLICATION time, not at the time an offline request was drafted or queued. Because that authorize() call reads the CURRENT trust-set epoch and CURRENT child-profile membership on every invocation, an action that sat queued offline is re-validated — family, actor role, and (as of this document) target membership — against whatever is true at the moment it is actually applied, not against whatever was true (or assumed) when it was queued. A parent endpoint with stale local state cannot force a stale authorization decision through merely by having queued the action earlier: the decision is always computed fresh, at apply time, by the trusted receiving service.

This document adds no new offline-queue machinery of its own (that surface belongs to `familyenvelope`/`relay`, outside this lane's ownership); it closes the one target kind that previously bypassed re-validation entirely.

## 7. Idempotency: binding a cached decision to its exact request

`ActionIdempotencyLedger` already guarantees a genuine retry of the same `(idempotencyKey, actionId)` pair returns the same recorded decision rather than a fresh (and potentially different) re-evaluation — deliberate, since a legitimate offline retry or duplicate reconnect delivery must not flip outcome merely because trust-set state moved in between.

That guarantee had a gap: nothing bound the cached decision to the REST of the request. An `(idempotencyKey, actionId)` pair replayed with a mutated `targetScope` — pointing at a different, possibly cross-family, child profile — matched the cache purely on `actionId` and returned the ORIGINAL target's verdict for the NEW target. `authorize()` now computes a `requestFingerprint` (family, actor, operation, target kind + id) alongside the cached lookup; a fingerprint mismatch is treated as a new request, not a replay, and always falls through to fresh evaluation. A genuinely identical replay — same family, actor, operation, and target — is unaffected and still returns the cached outcome exactly as before.

## 8. Step-up never overrides family scope

Membership is checked before the role/step-up matrix runs. A wrong-family `CHILD_PROFILE` target is denied at the membership check regardless of whether a valid, fresh step-up assertion is attached to the request — step-up authenticates the ACTOR, it never substitutes for target-scope authority.

## 9. Child request paths (`ChildRequestService`)

`submit`, `decide`, `cancel`, and `acknowledgeApplied` were inspected. `decide()` is the only one of the four that calls into `ParentActionAuthorizationService`, and it does so unconditionally — a child device deciding its own request resolves `REQUEST_ONLY` (never `ALLOW`) purely from the trust-set-resolved `CHILD` role, so self-approval was already structurally impossible before this change and remains so. Because `decide()` forwards the caller-supplied `targetScope` straight into `authorize()`, the CHILD_PROFILE membership check above applies to every child-request decision without any change to `ChildRequestService` itself — closing the gap in `familyrbac` closes it for child requests for free. `cancel()` and `acknowledgeApplied()` gate only on `childDeviceId === requestingDeviceId` and never consult family/child-profile scope at all, which is correct: both operate on a request the caller already knows the ID of and can only affect that caller's own requester identity, not an arbitrary family/child target.

## 10. Residual scope

Runtime wiring of a real, trustworthy `ChildProfileMembershipResolver` backed by verified local family state or a trusted endpoint remains a separate Coordinator-owned binding (lane brief Section 13) — this document defines the contract and the fail-closed default a production deployment falls back to until that binding lands, not the binding itself.

## 11. The central child-profile membership registry, and why Section 3's prohibition survives it

Change `CHG-2026-09-04-01` (doc 00 Section 9) admits one central artifact, under exactly this
owner-approved sentence and no broader reading:

> "The central service may maintain an opaque child-profile membership registry consisting of a
> server-minted `childProfileId` bound to `familyId`. No readable child-profile content is
> permitted in the central service."

**Section 3's prohibition is unchanged and still binding.** This document forbids shipping a
*readable central child-profile directory* merely to make a pre-check convenient. The registry
approved here is not that directory, and the distinction is substantive rather than a matter of
naming:

| Section 3 forbids | This registry is |
|---|---|
| A directory of child **profiles** - readable content about children | An edge set of opaque **identifiers**: this id exists, and it belongs to this family |
| A convenience surface making the membership pre-check cheap to run | An existence authority making it possible for a child to exist **before** a device, which doc 08 Section 4's Owner-local "Create child profile" step otherwise could not durably record |
| Something that leaks who a child is | Something from which an attacker learns only that some opaque family has some number of opaque child identifiers |

**Nothing readable moves.** The authoritative readable child entity remains `FamilyMember`
(doc 10 Section 3.2), and its `displayName` remains local plaintext only, never present in any
central-service-visible field. The readable label a parent sees is held in the trusted parent
context. The central row carries the child's identifier; the child's content does not move.

**The fact itself is not new centrally.** A `(familyId, childProfileId)` pair is already held by
`enrollment_invitations` and by `eye_protection_settings`. What changes is that the pair
becomes a first-class opaque edge rather than a side effect of one invitation, and that the
identifier becomes **server-minted** - which removes a real defect: a client-minted identifier under
a globally unique constraint turns a duplicate-entry error into a cross-family existence oracle, the
precise failure Section 5 already prohibits.

**Section 5's error-oracle rule governs this registry too.** "This identifier belongs to another
family" must remain indistinguishable from "this identifier does not exist". A lookup may confirm
existence and ownership to an authorized caller and must reveal nothing to anyone else.

**`ChildProfileMembershipResolver` is unaffected.** Its interface and its synchronous, actor-derived
contract are unchanged by this section; the registry does not become its backing store, and no
resolver behaviour is altered by `CHG-2026-09-04-01`.

**This is not precedent.** The approval permits an edge, not a directory. Adding a readable child
field, a lookup returning more than existence and ownership, or a distinguishable other-family
outcome each require a **new** doc 00 Section 9 entry and their own owner approval.
`CHG-2026-09-04-01` may not be cited in support of any of them.
