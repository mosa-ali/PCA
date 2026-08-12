# Child-profile target membership scope — logical contract

This directory defines the **logical**, representation-neutral contract catalogue for `PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION`, described in [architecture document 39](../../docs/architecture/39_CHILD_PROFILE_SCOPE_AUTHORITY.md). It is not an API specification, a wire format, or an implementation — it pins the vocabulary and fail-closed rules the `backend/src/childprofiles/` and `backend/src/familyrbac/` implementation must honor, following the same conventions as the [family-envelope contract foundation](../README.md) and [wellbeing-control catalogue](../wellbeing-control/README.md).

`catalogue.json` captures: the four membership outcomes and which one alone allows; the single public deny reason every non-allowing outcome and malformed-id case must collapse to (the error-oracle rule); the fail-closed default when no resolver is injected; the prohibition on a readable central child-profile directory; the rule that only the actor's own already-resolved family may back the membership check (never a client-asserted one); freshness (no membership caching inside the authorization service); offline/reconnect re-validation fields; step-up/family-scope ordering; the idempotency request-fingerprint fields that prevent a mutated target from riding a cached decision; and the `ChildRequestService` path expectations (self-approval structurally impossible).

Run the self-contained validation suite with:

```powershell
node --test contracts/child-profile-scope/test/*.test.cjs
```

The checks reject: `MEMBER_OF_FAMILY` declared as a denying status, a distinct public deny reason per failure case (the error oracle this catalogue exists to prevent), a no-resolver-injected default that isn't `UNAVAILABLE`, a readable central child-profile directory declared permitted, a client-asserted `familyId` treated as proof, membership caching inside the authorization service, queue-time state trusted on reconnect, a dropped re-validation field, step-up declared able to override family scope, a request fingerprint missing a security-relevant field, a mutated target allowed to ride a cached idempotency outcome, and self-approval declared possible.
