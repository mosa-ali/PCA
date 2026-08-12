# PCA runtime schedule — canonical contract

This directory defines the **canonical, cross-runtime schedule contract** described in [architecture document 37](../../docs/architecture/37_RUNTIME_SCHEDULE_CONFORMANCE.md): one logical `SchedulePolicyV1` document, one deterministic decision precedence, and one shared conformance vector set that both the existing TypeScript reference (`backend/src/schedule/`) and the new Android Kotlin conforming implementation (`android/app/src/main/java/org/pca/app/runtime/schedule/`) are checked against.

It follows the same conventions as the [family-envelope contract foundation](../README.md): logical, representation-neutral, no real family data, and never a wire-format or crypto specification in its own right.

## Files

- [`SchedulePolicyV1.md`](SchedulePolicyV1.md) — the canonical policy document shape, window semantics, and the policy-acceptance state machine (`ScheduleRuntimeState`).
- [`vectors/schedule-conformance-v1.json`](vectors/schedule-conformance-v1.json) — 41 shared vectors exercising `ScheduleEvaluationInput -> ScheduleDecision` (the per-tick enforcement decision). Ground truth for precedence and boundary semantics is `backend/src/schedule/engine.ts`'s documented precedence and its own pre-existing test suite; this file is cross-checked, never used to *invent* new precedence.
- [`vectors/policy-acceptance-v1.json`](vectors/policy-acceptance-v1.json) — 15 shared vectors exercising the policy-freshness/epoch gate (`ScheduleRuntimeState`) that sits in front of the evaluator, plus the local revision-acceptance helper. This layer has no pre-existing TS production counterpart; it is new logic for this mission, defined once here.
- [`payload/SchedulePolicyEnvelopePayload.md`](payload/SchedulePolicyEnvelopePayload.md) — the canonical plaintext-before-encryption payload shape for delivering a `SchedulePolicyV1` over the existing Family Envelope `POLICY_UPDATE` message type. No new central service, no plaintext schedule table, no plaintext schedule API.

## Reference vs. conforming implementation

- **Reference (unmodified, read-only for this contract):** `backend/src/schedule/engine.ts`, `policy.ts`, `timezone.ts`. This module never rewrites that engine; `backend/test/runtime-schedule-conformance/` feeds the shared vectors into it as-is and records any real mismatch rather than silently changing it (see doc 37 §TS_REFERENCE_RESULT).
- **Conforming implementation:** `android/app/src/main/java/org/pca/app/runtime/schedule/`, a pure Kotlin, JVM-testable evaluator with identical precedence, boundary and offline semantics, verified against the same vector files.

Both implementations consume the same JSON vector files — there is exactly one canonical schedule authority (mission section 16); TS and Kotlin are a reference and a conforming implementation of it, never two independently-evolving products.

## Running the TS side

```powershell
cd backend
npm run build
node --test test/runtime-schedule-conformance/*.test.mjs
```

## Running the Android side

```powershell
cd android
./gradlew.bat testDebugUnitTest --tests "org.pca.app.runtime.schedule.*"
```
