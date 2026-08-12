# SchedulePolicyV1 — canonical policy document

`SchedulePolicyV1` is the versioned, opaque-id-only logical document a family's schedule policy is authored as. It is never stored or transmitted in plaintext by any central service (mission §13) — it is only ever handled as: (a) plaintext on the authoring parent device, (b) an E2EE ciphertext payload in transit (see [`payload/SchedulePolicyEnvelopePayload.md`](payload/SchedulePolicyEnvelopePayload.md)), and (c) plaintext at rest on the child device inside its existing local encrypted persistence.

## Fields

| Field | Type | Notes |
|---|---|---|
| `version` | `"1"` (literal) | Contract version tag; a future `SchedulePolicyV2` would be a new, additive document type, never a silent shape change under the same tag. |
| `policyId` | opaque string | Stable identifier for "this child's schedule policy", not a per-revision id. |
| `policyRevision` | positive integer | Strictly increasing per `policyId` (mirrors the Family Envelope `POLICY_UPDATE` strict-version-increase rule in doc 22 — this is the *schedule-domain* record of that same discipline, not a competing authority; see `isAcceptableRevision` below). |
| `familyId` | opaque string | Same opaque family identifier used throughout doc 22/09. |
| `childProfileId` | opaque string | Opaque per-child identifier. No child name, ever (mission §17). |
| `timezone` | IANA string | The family-authored default timezone for this policy document (distinct from any individual window's own `timezone`, and distinct from the *evaluating device's* current timezone — see `travel-does-not-relax-window-anchored-to-family-timezone` in the evaluation vectors). |
| `windows` | `ScheduleWindow[]` | See below. |
| `bonusGrants` | `BonusGrant[]` | See below. |
| `parentExceptions` | `ParentException[]` | See below (named `exceptions` on `ScheduleEvaluationInput` — same shape). |
| `dailyLimits` | `DailyAppLimit[]` | One entry per distinct `appScope` the family has configured a daily limit for; the evaluator is fed the single entry relevant to the app token being evaluated (see "Resolving an evaluation input" below). |
| `trustSetEpoch` | non-negative integer | The Family Trust Set epoch this policy was authored/signed under (doc 22 / `familytrustset`). |
| `keyEpoch` | non-negative integer | The key epoch this policy was authored/signed under (doc 22 `KEY_ROTATION`). |
| `issuedAt` | UTC instant | When the parent authored/signed this revision. |
| `effectiveFrom` | UTC instant | When this revision becomes the intended active policy. A policy accepted before its own `effectiveFrom` is a valid *accepted* record but not yet the one a child device should prefer over a currently-effective earlier revision — this is a persistence/scheduling nuance owned by Agent 12, not the evaluator, which is only ever fed one already-resolved policy at a time. |
| `expiresAt` | UTC instant \| `null` | Optional. See the policy-acceptance state machine below for fail-safe expiry handling. |

`ScheduleWindow`, `TimeOfDay`, `AppScope`, `BonusGrant`, `ParentException`, `DailyAppLimit`, `EnforcementCapabilityState`, `ScheduleDecisionKind` and `ScheduleDecision` are unchanged from `backend/src/schedule/types.ts` — see that file for the authoritative field list and the doc comments on cross-midnight window semantics, opaque app tokens, and UTC-only expiry. The Kotlin conforming types in `SchedulePolicy.kt` mirror these field-for-field.

## Resolving an evaluation input

A `SchedulePolicyV1` is a *container*; the evaluator (`evaluateSchedule` / Kotlin `ScheduleEvaluator.evaluate`) takes a narrower `ScheduleEvaluationInput` for one `(nowUtc, appToken)` pair. The runtime facade resolves one from the other by:

- `windows` → the policy's full `windows` list (the evaluator itself filters by app scope and activity).
- `bonusGrants` → the policy's full `bonusGrants` list.
- `exceptions` → the policy's full `parentExceptions` list.
- `dailyLimit` → the single `DailyAppLimit` from `dailyLimits` whose `appScope` includes the app token being evaluated (`ALL`, or an explicit list containing it), or `undefined` if none matches (an app with no configured daily limit is never limited).
- `timezone` → the policy's `timezone` (may be overridden per-call by the device's current IANA zone; see the travel vector — this only affects daily-limit local-date anchoring, never window activation, which always uses each window's own authored `timezone`).

This resolution is deliberately trivial and lossless — it never re-derives or infers precedence; all precedence lives entirely inside the evaluator per `engine.ts`'s documented rules.

## Policy-acceptance state machine (`ScheduleRuntimeState`)

New for this mission — no pre-existing TS production counterpart. Sits in front of the evaluator: given whatever `SchedulePolicyV1` record is currently persisted locally, decide which policy (if any) the evaluator should actually be fed for this tick, and what to honestly tell the parent-facing UI about freshness.

States: `CURRENT` | `STALE_REMOTE` | `INVALID` | `EPOCH_STALE` | `NO_ACCEPTED_POLICY`.

Full precedence and every case is captured as executable vectors in [`vectors/policy-acceptance-v1.json`](vectors/policy-acceptance-v1.json); in prose:

1. **No candidate policy has ever been accepted locally** → `NO_ACCEPTED_POLICY`, `effectivePolicy = null`. At the evaluator this is behaviorally identical to an empty policy (`ALLOWED`, no restrictions ever configured) — there is no special-cased decision kind for it, matching the existing engine's own "offline restart with no policy sync yet" test.
2. **The candidate fails structural validation** (malformed window fields, mirroring `validateScheduleWindow`) → `INVALID`. Fails safe onto `lastKnownGoodPolicy` if one exists; only resolves to `null` (again, evaluator-equivalent to no restrictions) when literally nothing has ever validated. Never crashes, never fabricates a restriction that was never configured.
3. **The candidate's own `expiresAt` has passed** → `INVALID`. Fails safe onto `lastKnownGoodPolicy` — mission §11 explicitly forbids "expired ⇒ unrestricted"; an expired policy must not silently open access, it must fall back to whatever was last validly in force.
4. **The candidate's `trustSetEpoch` or `keyEpoch` is strictly behind the device's current known epoch** (e.g. a device-revoke or key rotation happened since this policy was authored/signed) → `EPOCH_STALE`. Fails safe onto `lastKnownGoodPolicy` if available, else onto the candidate itself (it is not corrupted, only possibly trust-stale — still better than no enforcement at all).
5. **Offline, and the last confirmed sync is missing or older than a staleness threshold** → `STALE_REMOTE`. `effectivePolicy` is still the candidate, fully enforced — this is a label for parent-facing UI honesty only (mission §11: "a stale remote connection does NOT automatically invalidate the local policy"). Connectivity is never itself an enforcement input.
6. **Otherwise** → `CURRENT`.

### Revision acceptance

A small, separate, pure helper — `isAcceptableRevision(candidateRevision, previouslyAcceptedRevision)` — used by the persistence layer (Agent 12) as a local defense-in-depth check when merging an incoming policy record: acceptable iff `previouslyAcceptedRevision` is absent or `candidateRevision` is *strictly greater*. The primary authority for monotonic version enforcement in transit remains the Family Envelope's `DataVersionLedger` (doc 22 §POLICY_UPDATE) — this is a same-semantics local safety net for the schedule domain's own persisted record, not a competing authority.
