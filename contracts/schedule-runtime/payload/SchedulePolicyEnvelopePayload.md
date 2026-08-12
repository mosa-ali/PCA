# Schedule policy envelope payload (POLICY_UPDATE)

Canonical shape for the plaintext-before-encryption bytes carried as a Family Envelope `POLICY_UPDATE` message's `payload` (`backend/src/familyenvelope/types.ts`), when the update being delivered is a schedule policy.

This document defines **only** the logical plaintext shape. It does not define, and this mission does not introduce:

- a central plaintext schedule table or endpoint,
- any server-side schedule evaluation requirement,
- any new envelope message type (the existing `POLICY_UPDATE` vocabulary entry is reused as-is, per mission §13/§16 — "no second authority").

The server/relay sees only the existing opaque `FamilyEnvelope` metadata (message id, `trustSetEpoch`, `keyEpoch`, `semanticVersion`, timestamps, signature) and ciphertext. It never decrypts or inspects this payload, exactly like every other `POLICY_UPDATE` payload today.

## Plaintext payload shape

```jsonc
{
  "kind": "SCHEDULE_POLICY_V1",   // discriminates this payload from other POLICY_UPDATE payload kinds (e.g. wellbeing-control's, doc 36) once decrypted
  "policy": /* SchedulePolicyV1, see ../SchedulePolicyV1.md */ { ... }
}
```

## Field-mapping to the envelope's own metadata

Two fields already exist on the outer `FamilyEnvelope` and MUST NOT be duplicated with different values inside the plaintext payload — a receiver that finds a mismatch must treat the message as malformed, the same posture the envelope layer already takes toward any other cross-field inconsistency:

- `FamilyEnvelope.trustSetEpoch` ⇔ `SchedulePolicyV1.trustSetEpoch`
- `FamilyEnvelope.keyEpoch` ⇔ `SchedulePolicyV1.keyEpoch`

`FamilyEnvelope.semanticVersion` (doc 22 §3/§4, strictly-increasing for `POLICY_UPDATE`) is the wire-level authority for accept/reject-as-stale at the envelope layer; `SchedulePolicyV1.policyRevision` is the schedule-domain's own record of that same monotonic fact, present in the plaintext so the accepted policy remains self-describing once decrypted and detached from its transport envelope (e.g. after being written to local persistence, per the offline/reboot requirement in mission §12).

## Receive-side flow (informative — implemented by other agents' owned paths)

1. Family Envelope receiver pipeline (`ReceiverPipeline.ts`, out of scope here) verifies protocol compatibility, idempotency, anti-replay, expiry, trust/key epoch and signature, and strict-version-increase for `POLICY_UPDATE` — exactly as it does today for every `POLICY_UPDATE`.
2. The payload is decrypted (out of scope here — existing E2EE machinery) to the plaintext shape above.
3. `kind` is checked against `"SCHEDULE_POLICY_V1"`; a different `kind` is routed to whatever other `POLICY_UPDATE` payload handler owns it (e.g. doc 36 wellbeing-message policy) rather than being force-parsed as a schedule policy.
4. `SchedulePolicyValidator` (this mission, `android/.../runtime/schedule/SchedulePolicyValidator.kt`) runs the policy-acceptance state machine (see `../SchedulePolicyV1.md`) before the policy is trusted for evaluation.
5. Agent 12's persistence layer (`SchedulePolicyStore`, port defined in `android/.../runtime/schedule/SchedulePolicyStore.kt`) durably saves the accepted plaintext `SchedulePolicyV1` so it survives an offline reboot per mission §12.

## Non-goals

- No plaintext schedule visible to the relay/service or any central plane.
- No new server-readable family-policy surface.
- No child-name, schedule-telemetry, or other content beyond opaque ids and the schedule structure itself (mission §17).
