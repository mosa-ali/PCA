# 37 — Runtime Schedule Contract & Cross-Runtime Conformance

Owning agent: **PCA-CLAUDE-10-RUNTIME-SCHEDULE**. This document specifies the canonical, cross-runtime schedule contract (`SchedulePolicyV1`), the shared TS/Kotlin conformance vector suite that keeps the existing TypeScript reference engine and the new Android Kotlin evaluator in lock-step, and the offline-first / policy-freshness guarantees the Android runtime facade provides to PCA enforcement and future WELL-1/WELL-3 wellbeing code. It does not modify, and is not itself, the reference engine (`backend/src/schedule/**`), the family envelope transport (`backend/src/familyenvelope/**`), or any persistence implementation (`android/.../persistence/**`) — those remain other agents' owned authority, referenced here only as read-only ground truth or as a port this document defines.

## 1. Owner product invariant — offline first

PCA-RTSCHED-001: PCA continues local child protection whether Internet is available or unavailable. Loss of Internet may reduce remote visibility and synchronization; it MUST NOT disable locally enforceable parental-control policy. A previously accepted, verified family schedule continues to evaluate locally while the child device is offline. Airplane mode / network loss never bypasses BEDTIME, SCHOOL_MODE, BLOCK_PERIOD, ALLOW_PERIOD, daily limits, or valid parent exceptions. This is the governing invariant behind every design decision in this document, in particular §5 (policy-acceptance fail-safe rules) and §7 (offline/reboot).

## 2. Scope and relationship to the existing schedule engine

`backend/src/schedule/engine.ts`, `policy.ts` and `timezone.ts` already implement a real, tested schedule evaluator for the TypeScript backend/parent-web surface. Android had no equivalent general schedule authority prior to this mission. This document and its accompanying contract (`contracts/schedule-runtime/`) do **not** rewrite that engine — they:

1. Define one canonical schedule contract (`SchedulePolicyV1`, `contracts/schedule-runtime/SchedulePolicyV1.md`).
2. Capture the TS engine's existing, already-tested precedence and boundary semantics as shared TS/Kotlin conformance vectors (§4).
3. Implement a pure, JVM-testable Android Kotlin evaluator conforming to those vectors (§6, `android/app/src/main/java/org/pca/app/runtime/schedule/`).
4. Define deterministic offline evaluation and a new policy-freshness/epoch gate that has no pre-existing TS counterpart (§5).
5. Define a signed/E2EE-compatible schedule policy payload reusing the existing Family Envelope `POLICY_UPDATE` message type (§8).
6. Define an Android runtime facade (`ScheduleRuntime`) usable by PCA enforcement and future WELL-1/WELL-3 wellbeing code (§9).

There is exactly one canonical schedule authority (§10): TypeScript is the reference implementation, Android Kotlin is a conforming implementation, and both are checked against the same JSON vector files. Neither evolves independently.

## 3. `SchedulePolicyV1` — canonical policy document

Full field-by-field contract: `contracts/schedule-runtime/SchedulePolicyV1.md`. Summary:

| Field | Notes |
|---|---|
| `version`, `policyId`, `policyRevision` | Contract version tag; opaque stable id; strictly-increasing revision per `policyId`. |
| `familyId`, `childProfileId` | Opaque ids only — no child names anywhere in this contract (§11). |
| `timezone` | The policy's authored default timezone. |
| `windows` | `ScheduleWindow[]` — `BEDTIME`, `SCHOOL_MODE`, `ALLOW_PERIOD`, `BLOCK_PERIOD`, each with `id`, `daysOfWeek`, `start`/`end` (`TimeOfDay`), `appScope`, and its own `timezone`. Supports midnight crossing (§4.1). |
| `bonusGrants`, `parentExceptions`, `dailyLimits` | Unchanged in shape from `backend/src/schedule/types.ts`'s `BonusGrant` / `ParentException` / `DailyAppLimit`. |
| `trustSetEpoch`, `keyEpoch` | The Family Trust Set / key epoch this policy was authored/signed under (doc 22). |
| `issuedAt`, `effectiveFrom`, `expiresAt?` | UTC instants. |

App scopes are opaque-id-only (`ALL` or an explicit app-token list) — this contract never carries app display names, only opaque tokens, per the existing TS contract.

### 3.1 Midnight crossing

A window whose `end` is not strictly after its `start` is interpreted as crossing midnight into the following calendar day, still anchored to the day `start` falls on for `daysOfWeek` matching — unchanged from the TS reference (`policy.ts`'s `isWindowActive` doc comment), mirrored exactly in the Kotlin `isWindowActive` (`SchedulePolicyRules.kt`).

## 4. Precedence — read from the actual reference implementation

PCA-RTSCHED-010: the decision precedence below is transcribed from `backend/src/schedule/engine.ts`'s `evaluateSchedule` doc comment and cross-checked against that file's own pre-existing test suite (`backend/test/schedule/engine.test.mjs`) — not inferred from prose alone, per mission instruction. Highest precedence first:

1. An active parent exception overrides everything, including bedtime and school mode.
2. Bedtime blocks unconditionally for its app scope.
3. School mode allows an app only if **every** simultaneously-active `SCHOOL_MODE` window's allow-scope includes it (intersection / most-restrictive-wins across overlapping school windows); otherwise blocks, with `matchedWindowIds` listing every excluding window, sorted lexicographically (never insertion order — verified order-independent by the `school-mode-intersection-blocks-order-independent` vector).
4. An explicit block period blocks its app scope.
5. An explicit allow period restricts its app scope to only inside that window.
6. The daily minute limit, bonus-extended if an active grant applies.
7. Default allow.

A capability check wraps the whole precedence: when `enforcementCapability` is not `ENFORCED` and the intended decision is restrictive, the engine reports `ENFORCEMENT_UNAVAILABLE` with `intendedDecision` set, rather than either a bare block or a silent allow — this is the "capability degraded/unavailable" honesty requirement, and it never suppresses an already-`ALLOWED` verdict.

## 5. Policy-acceptance state machine — new logic

PCA-RTSCHED-020: unlike §4, this state machine (`ScheduleRuntimeState`: `CURRENT` | `STALE_REMOTE` | `INVALID` | `EPOCH_STALE` | `NO_ACCEPTED_POLICY`) has **no pre-existing TS production counterpart** — it is new for this mission, defined once in `contracts/schedule-runtime/SchedulePolicyV1.md` and implemented twice: a TS-side reference (`backend/test/runtime-schedule-conformance/policyAcceptanceReference.mjs`, deliberately test-only, never `backend/src/schedule`) and the Kotlin production implementation (`SchedulePolicyValidator.kt`), kept in lock-step purely via the shared vectors in `contracts/schedule-runtime/vectors/policy-acceptance-v1.json`.

Precedence, evaluated in order:

1. No candidate policy ever accepted → `NO_ACCEPTED_POLICY`, `effectivePolicy = null` (evaluator-equivalent to an empty policy → `ALLOWED`).
2. Candidate fails structural validation (mirrors `validateScheduleWindow`) → `INVALID`, fails safe onto `lastKnownGoodPolicy`.
3. Candidate's own `expiresAt` has passed → `INVALID`, fails safe onto `lastKnownGoodPolicy`. PCA-RTSCHED-021: expiry never defaults to unrestricted access — mission instruction is explicit on this point.
4. Candidate's `trustSetEpoch`/`keyEpoch` is strictly behind the device's current known epoch (e.g. a device revoke happened since) → `EPOCH_STALE`, fails safe onto `lastKnownGoodPolicy` if available, else onto the candidate itself (still enforced, never dropped to unrestricted).
5. Offline and the last confirmed sync is missing or older than a staleness threshold (default 72h, `PolicyAcceptanceInput.DEFAULT_REMOTE_STALENESS_THRESHOLD_MILLIS`) → `STALE_REMOTE`. **Labeling-only** — `effectivePolicy` is still the candidate, fully enforced. PCA-RTSCHED-022: "offline for 24 hours ⇒ restrictions disabled" is explicitly not implemented; connectivity is never itself an enforcement input.
6. Otherwise → `CURRENT`.

A small separate helper, `isAcceptableRevision(candidateRevision, previouslyAcceptedRevision)`, is a local defense-in-depth revision-monotonicity check for the schedule domain's own persisted record — the primary authority for monotonic version enforcement in transit remains the Family Envelope's `DataVersionLedger` (doc 22 §`POLICY_UPDATE`); this is not a competing authority.

## 6. Android evaluator

`android/app/src/main/java/org/pca/app/runtime/schedule/` — pure Kotlin, JVM-testable, UI-independent:

- `SchedulePolicy.kt` — `SchedulePolicyV1`, `ScheduleWindow`, `TimeOfDay`, `AppScope` (sealed: `All` / `Apps`), `BonusGrant`, `ParentException`, `DailyAppLimit`, `EnforcementCapabilityState`, `Connectivity`, `ScheduleDecisionKind`, `ScheduleDecision`, `ScheduleEvaluationInput`.
- `ScheduleTimezone.kt` — `toZonedWallClock` via `java.time.ZoneId` (minSdk 26, natively available — same approach as the existing `feature/prayer` timezone handling), matching the TS reference's `Intl.DateTimeFormat`-based approach: DST/offset handling is delegated entirely to the platform's tz database, never hand-rolled offset math.
- `SchedulePolicyRules.kt` — `appScopeIncludes`, `validateScheduleWindow`, `isWindowActive`.
- `ScheduleEvaluator.kt` — the §4 precedence, field-for-field mirroring `engine.ts`.
- `SchedulePolicyValidator.kt` — the §5 state machine.
- `SchedulePolicyStore.kt` — the persistence port (§7).
- `SchedulePolicyEnvelopePayload.kt` — the §8 payload codec.
- `ScheduleRuntime.kt` — the §9 facade.

## 7. Offline / reboot

PCA-RTSCHED-030: runtime contract supports: policy accepted → Internet lost → process/device restart → policy reloaded from local persistence → same schedule decision still produced. Exercised by `ScheduleRuntimeRebootOfflineTest.kt`, which simulates a restart by constructing a brand-new `ScheduleRuntime`/store pair from only a persisted `SchedulePolicySnapshot` and asserting an identical decision.

The port Agent 12 (local persistence) must satisfy is `SchedulePolicyStore` (`save`/`load` of `SchedulePolicySnapshot`, carrying `candidatePolicy`, `lastKnownGoodPolicy`, `lastPolicySyncAtUtc`, `deviceTrustSetEpoch`, `deviceKeyEpoch` — durable facts only, never a cached decision, so a stale cached decision can never be replayed after the facts that produced it have changed). `InMemorySchedulePolicyStore` is the reference/test-default implementation; a durable (e.g. encrypted-DataStore-backed) implementation lives under `android/.../persistence/**`, read-only to this mission.

`ScheduleRuntimeState.STALE_REMOTE` distinguishes "offline a long time" from every other state without ever changing the effective policy (§5) — see `offline for a long duration does not disable restrictions` in `ScheduleRuntimeRebootOfflineTest.kt`.

## 8. E2EE-compatible policy payload

Full spec: `contracts/schedule-runtime/payload/SchedulePolicyEnvelopePayload.md`. Summary: a `SCHEDULE_POLICY_V1`-tagged JSON plaintext payload (`{ "kind": "SCHEDULE_POLICY_V1", "policy": SchedulePolicyV1 }`) carried as the existing Family Envelope `POLICY_UPDATE` message type's `payload` (`backend/src/familyenvelope/types.ts`). No new envelope message type, no central plaintext schedule table, no plaintext schedule API, no server-side schedule evaluation requirement — the server/relay sees only the existing opaque envelope metadata and ciphertext, exactly as it does today for every other `POLICY_UPDATE`.

`SchedulePolicyEnvelopePayload.kt` implements the codec using `org.json` (part of the Android platform framework at app runtime — no new Gradle dependency; the pre-existing `testImplementation(libs.org.json)` supplies a real implementation for JVM unit tests). It does not touch actual encryption/signing — that remains the existing E2EE machinery and `android/.../runtime/sync/**`, both read-only to this mission.

## 9. Android runtime facade — WELL-3 closure support

`ScheduleRuntime` (`ScheduleRuntime.kt`) is the single entry point PCA enforcement and future WELL-1/WELL-3 code should call, composing §5 (which policy is trusted) with §4 (what that policy decides) so there is exactly one composition point rather than every caller re-deriving it.

PCA-RTSCHED-040 (mission §15 / WELL-3 closure support): `isPcaBedtimeActive(nowUtc)` and `isScheduledQuietContext(nowUtc)` are provided for a future `WellbeingScheduleContextSource` in `feature/wellbeing` (read-only to this mission) to answer those two questions without reimplementing schedule evaluation. `isPcaBedtimeActive` checks only `BEDTIME` windows; `isScheduledQuietContext` checks `BEDTIME` **or** `SCHOOL_MODE` — BEDTIME is deliberately kept a distinct, separately-queryable concept from Break Shield (`feature/screentime/engine/ScreenTimeEngine.kt`'s `BREAK_SHIELD` mode), which is an unrelated feature.

## 10. No second authority

PCA-RTSCHED-050: TypeScript (`backend/src/schedule/**`) and Kotlin (`android/.../runtime/schedule/**`) must not become two independently-evolving schedule products. The canonical contract lives in `contracts/schedule-runtime/`; the TS package is the reference implementation (read-only to this mission); the Kotlin package is a conforming implementation, checked against the same vector files as the TS reference (`contracts/schedule-runtime/vectors/schedule-conformance-v1.json`, `policy-acceptance-v1.json`). Any future divergence must be resolved by updating the shared vectors and re-verifying both sides, never by one side silently drifting.

## 11. Security & privacy

PCA-RTSCHED-060: malformed window configuration (out-of-range hour/minute, empty `daysOfWeek`, invalid weekday entries, unrecognized IANA timezone, duplicate window ids at the persistence-merge layer) is rejected as `INVALID_CONFIG` / `INVALID`, never silently coerced or allowed. No child names anywhere in this contract — only opaque `familyId`/`childProfileId`/`policyId` ids. No schedule telemetry. No server-readable family policy (§8).

## 12. Test coverage

- **TS reference:** `backend/test/runtime-schedule-conformance/evaluationVectors.test.mjs` (43 assertions over 41 shared vectors, run against the unmodified `backend/src/schedule/engine.ts`) and `policyAcceptanceVectors.test.mjs` (16 assertions over the new policy-acceptance reference). Both pass at 0 failures against the current reference engine; the full pre-existing backend suite (861 tests) passes unmodified alongside them.
- **Android:** `ScheduleConformanceVectorTest.kt` (41 shared evaluation vectors), `PolicyAcceptanceConformanceVectorTest.kt` (15 policy-acceptance + 4 revision-acceptance vectors), `ScheduleRuntimeRebootOfflineTest.kt` (offline/reboot + WELL-3 helpers), `SchedulePolicyEnvelopePayloadTest.kt` (round-trip + malformed-input rejection). All pass under `./gradlew.bat testDebugUnitTest`; `./gradlew.bat assembleDebug` succeeds.

See `docs/architecture/COORDINATOR_INTEGRATION_QUEUE.md` for this mission's final coordinator-facing summary block.
