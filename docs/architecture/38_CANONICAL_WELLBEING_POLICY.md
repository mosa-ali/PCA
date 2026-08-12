# 38 — Canonical Wellbeing Policy: Parent-SDK / Android WELL-1 Adapter (PCA-RUNTIME-WELL-1)

## 0. Why this document exists

Two independent authorities existed for the same conceptual domain (wellbeing categories,
triggers, and parent-authored content) before this work:

1. **Android `feature/wellbeing` runtime** (doc 35 "Positive Habits, Productive Alternatives &
   Healthy Digital Balance", PCA-WELL-006/009) -- the on-device engine that actually selects and
   delivers nudges (`NudgeSelectionEngine`, `WellbeingContentCatalogue`,
   `WellbeingTriggerDispatcher`).
2. **`parent-sdk/wellbeing-control`** (doc 36 "Parent-Controlled Wellbeing Message Policy",
   `WellbeingMessageControlV1`) -- the parent-authoring domain intended for Agent 7's parent-web UI.

They disagreed on naming (`WellbeingCategory`/`NudgeTrigger` vs. `WellbeingCategory`/
`WellbeingTrigger`). This document records which one is canonical, the full mapping between them,
the adapter architecture that connects them, the offline policy state machine, and what parent-web
would need to do differently now that this adapter exists. It does not modify `parent-web/**` or
`backend/**` (out of this worktree's ownership).

## 1. Canonical authority decision

**Android's `feature/wellbeing` runtime (doc 35) is canonical.** Evidence:

- Doc 35 is the actual engine: `NudgeSelectionEngine`, `WellbeingContentCatalogue`,
  `WellbeingNudgePolicy`, and every delivery surface are already built and tested against its
  13-category, 9-trigger taxonomy.
- Doc 36 section 1 states explicitly: *"WELL-1 ... is the on-device presentation and scheduling
  engine ... This document ... aligns terminology (categories, triggers) with WELL-1 so the two
  remain a single logical vocabulary, but it does not modify WELL-1's runtime engine, scheduling
  clock, or persistence."* Doc 36 was written to *follow* WELL-1, not replace it.
- Doc 36 section 15 (non-goals) reiterates: *"does not modify WELL-1's Android runtime."*
- No source evidence anywhere favors the parent-SDK's generic `CUSTOM` catch-all category as
  canonical -- it exists because a parent-authoring UI needs an escape hatch for content that
  doesn't fit the 12 substantive categories, not because it is a richer or more authoritative
  taxonomy.

Per the task's default rule, Android's richer 13-category set (now 14, see below) is therefore
canonical, and this adapter is the single explicit mapping layer between it and the parent-SDK
contract -- no third taxonomy was invented.

## 2. Category mapping

Android's `WellbeingCategory` enum (`android/.../feature/wellbeing/model/WellbeingEnums.kt`) was
extended by **one** additive value, `PARENT_CUSTOM_OTHER`, to receive the SDK's `CUSTOM`
catch-all (no existing category's meaning changed; both existing exhaustive `when` consumers,
`WellbeingCategoryLabels.kt` and `ParentWellbeingPolicyScreen.kt`, either already iterate
`WellbeingCategory.entries` generically or were updated with the new branch).

| Parent-SDK `WellbeingCategory` (types.ts) | Android `WellbeingCategory` | Notes |
|---|---|---|
| `SKILLS_AND_LEARNING` | `SKILLS_AND_LEARNING` | 1:1 |
| `READING` | `READING` | 1:1 |
| `FAITH_POSITIVE` | `FAITH_POSITIVE` | 1:1; see section 5 for the invariant this adapter preserves |
| `GRATITUDE` | `GRATITUDE` | 1:1 |
| `GOOD_DEED` | `GOOD_DEED` | 1:1 |
| `FAMILY_HELP` | `FAMILY_HELP` | 1:1 |
| `HOME_RESPONSIBILITY` | `HOME_RESPONSIBILITY` | 1:1 |
| `CREATIVITY` | `CREATIVITY` | 1:1 |
| `MOVEMENT_RESET` | `MOVEMENT_RESET` | 1:1; see section 6 (movement-safety guard) |
| `REST_AND_RESET` | `REST_AND_RESET` | 1:1 |
| `OUTDOOR_OR_OFFSCREEN` | `OUTDOOR_OR_OFFSCREEN` | 1:1 |
| `PLANNING_AND_ORGANIZATION` | `PLANNING_AND_ORGANIZATION` | 1:1 |
| `CUSTOM` | **`PARENT_CUSTOM_OTHER`** (new) | Generic catch-all with no Android equivalent before this work |
| *(none)* | `CHILD_SELECTED_FAVORITES` | Android-only: a dynamic, engine-synthesized bucket (favorites derived from `HELPFUL` feedback) a parent never authors content into, so the SDK contract never needed to name it |

Implementation: `android/.../feature/wellbeing/policy/CategoryMapping.kt`. `toAndroid()` is total
(every SDK category has exactly one Android home); `toSdkOrNull()` returns `null` only for
`CHILD_SELECTED_FAVORITES`.

## 3. Trigger mapping

| Parent-SDK `WellbeingTrigger` (types.ts) | Android `NudgeTrigger` | Notes |
|---|---|---|
| `PERIODIC` | `PERIODIC_HIGH_ENGAGEMENT_USE` | Same concept, different naming |
| `AFTER_UNLOCK` | `AFTER_SCREEN_UNLOCK` | Same concept |
| `RAPID_GAME_RETURN` | `IMMEDIATE_APP_RETURN` | Same concept ("child re-entered an eligible app quickly") |
| `BREAK_STARTED` | `BREAK_STARTED` | 1:1 |
| **`BREAK_ACTIVE`** | *(no discrete equivalent)* -> mapped to `BREAK_STARTED` | See below |
| `BREAK_COMPLETED` | `BREAK_COMPLETED` | 1:1 |
| `LONG_SESSION_ENDED` | `LONG_SESSION_ENDED` | 1:1 |
| `SCHEDULED_TIME` | `PARENT_SCHEDULED` | Same concept, different naming |
| `CHILD_REQUESTED_IDEA` | `CHILD_REQUESTED_IDEA` | 1:1 |
| *(none)* | `SCREEN_LOCKED_BEST_EFFORT` | Android-only: originates locally from Android's own runtime dispatch, never from parent policy |

**`BREAK_ACTIVE`** (a message eligible for the whole duration a break is in progress) has no
Android trigger equivalent: Android does not fire a discrete "still on break" trigger. Instead it
tracks `isBreakShieldActive` as *context* on whichever trigger is being evaluated and chooses
`BREAK_SHIELD_CARD` as the delivery surface when true. This adapter maps `BREAK_ACTIVE` to
Android's `BREAK_STARTED` trigger channel -- the discrete event Android fires when a break begins,
which is also when break-shield delivery starts being considered. This is a **deliberate, lossy,
documented** mapping, not a silent drop: a message that lists either `BREAK_STARTED` or
`BREAK_ACTIVE` is eligible on Android's `BREAK_STARTED` dispatch
(`TriggerMapping.coversAndroidTrigger`).

**`SCHEDULED_TIME`** (SDK) and **`PARENT_SCHEDULED`** (Android) are the same concept under
different naming and map 1:1 without loss.

**`SCREEN_LOCKED_BEST_EFFORT`** (Android) has no SDK equivalent: the SDK models "may this appear
on the lock screen" as a *delivery* concern (`DeliveryPolicy.lockScreenAllowed`), not a trigger. A
parent-authored message never declares this trigger; Android's own runtime dispatch produces it
locally and independently, and this adapter never needs to originate it (`toSdkOrNull` returns
`null` for it; no `SdkWellbeingTrigger` set ever covers it in
`TriggerMapping.coversAndroidTrigger`).

Implementation: `android/.../feature/wellbeing/policy/TriggerMapping.kt`.

## 4. Adapter architecture

```
Family Envelope / FTS sync (out of scope, another lane)
        |
        v  (already-decrypted, already-parsed policy payload)
ParentWellbeingPolicyV1                          <- policy/ParentWellbeingContract.kt
        |
        v
ParentPolicySyncCoordinator.receive()            <- policy/ParentPolicySyncCoordinator.kt
        |  (ParentPolicyRevisionGuard: stale-reject / duplicate-idempotent / newer-apply)
        v
WellbeingPolicySyncState { active, pending }      <- policy/WellbeingPolicySyncState.kt
        |
        |  ParentPolicySyncCoordinator.promote()  (explicit; never auto-replays anything)
        v
ParentPolicyStateStore  (durable, JSON, PersistentStateStore-backed)  <- policy/ParentPolicyStateStore.kt

                    active policy
        +---------------------+----------------------+
        v                                             v
ParentPolicyToAndroidPolicyAdapter          ParentCustomMessagePool.eligibleFor(trigger, ...)
  .curatedEntriesFor()  -> List<WellbeingSuggestion>    -> List<WellbeingSuggestion>
  .derivePolicy()       -> WellbeingNudgePolicy               ^
        |                                                     |  per message:
        |                                                ParentCustomMessageAdapter.map()
        |                                                  - CategoryMapping / locale / schedule /
        |                                                    target / archived-enabled filters
        |                                                  - CustomSuggestionSanitizer (reused)
        |                                                  - MovementContentGuard (new, item 9)
        v                                                     |
        +----------------------------+------------------------+
                                     v
        WellbeingTriggerDispatcher.dispatch(trigger, policy, rateState, catalogueEntries, customApprovedEntries)
                                     |            <- UNCHANGED, existing file
                                     v
                        NudgeSelectionEngine.evaluate(...)     <- UNCHANGED, existing file
                                     |
                                     v
                        NudgeSelection (DELIVERED / SUPPRESSED_* / NO_ELIGIBLE_SUGGESTION)
```

Files added (all under `android/app/src/main/java/org/pca/app/feature/wellbeing/`):

- `policy/ParentWellbeingContract.kt` -- Kotlin mirror of `WellbeingMessageControlV1` and its
  nested types (`SdkWellbeingCategory`, `SdkWellbeingTrigger`, `SdkTargetScope`,
  `SdkCustomWellbeingMessage`, `SdkDeliveryPolicy`, `SdkScheduleWindow`, etc.). A logical-domain
  mirror only, exactly as free of wire/crypto concerns as `policyEditorService.ts` is on the SDK
  side (doc 36 section 15's non-goals).
- `policy/CategoryMapping.kt`, `policy/TriggerMapping.kt` -- sections 2/3 above.
- `policy/ScheduleWindowEvaluator.kt` -- evaluates `ScheduleWindow` (date range / days-of-week /
  time windows, including midnight-crossing) against a wall-clock snapshot. Deliberately separate
  from `WellbeingScheduleContextSource` (PCA bedtime) -- see section 8.
- `policy/MovementContentGuard.kt` -- keyword-pattern safety floor for
  `MOVEMENT_RESET`-category custom content (item 9), mirroring
  `CustomSuggestionSanitizer`'s mechanical, deterministic style.
- `policy/ParentCustomMessageAdapter.kt` / `ParentCustomMessagePool` -- per-message and
  per-dispatch mapping into `WellbeingSuggestion` (see section 7 for the full field table).
- `policy/ParentPolicyToAndroidPolicyAdapter.kt` -- curated-entry filtering + frequency folding
  (see section 9).
- `policy/ParentPolicyRevisionGuard.kt` -- Kotlin port of `revisionGuard.ts` (section 10).
- `policy/WellbeingPolicySyncState.kt` -- the offline state machine (section 11).
- `policy/ParentPolicyStateStore.kt`, `policy/ParentPolicyJson.kt` -- durable JSON storage over
  the existing `PersistentStateStore` port.
- `policy/ParentPolicySyncCoordinator.kt` -- receive/promote facade (section 11).
- `policy/WellbeingFeedbackLogStore.kt` -- durable offline feedback log (section 12).
- `ports/WellbeingFeedbackSyncPort.kt` -- narrow port for a future privacy-minimized sync lane
  (section 12).

**Nothing in `NudgeSelectionEngine`, `WellbeingTriggerDispatcher`,
`WellbeingContentCatalogue`, `CustomSuggestionStore`, `WellbeingPolicyStore`, or
`WellbeingScheduleContextSource` was modified.** The adapter's entire job is to produce the exact
same `WellbeingNudgePolicy` / `List<WellbeingSuggestion>` shapes those files already accept.

### Ownership-boundary note on persistence

This worktree may not write to `android/.../feature/wellbeing/persistence/**`. `CustomSuggestionStore`
cannot represent several fields this adapter needs (per-message `requiresAdultSupervision`,
`lockScreenAllowed`, multi-language text, schedule, target, per-message frequency) -- its `add()`
signature and encoding hard-code `requiresAdultSupervision = false` / `lockScreenSafe = false` for
every entry, because it was built for a different flow (child/parent quick-add free text, gated by
a human content-safety reviewer). Rather than silently losing the parent-SDK's richer fields (which
would have broken item 8's hard gate for custom content), this adapter maintains its own durable
snapshot (`ParentPolicyStateStore`) over the *same* `PersistentStateStore` port every existing
store in this feature already uses (doc 35: "PCA-2 `PersistentStateStore` ... Does not add a second
storage mechanism") and reconstructs full-fidelity `WellbeingSuggestion`s directly, in memory, per
dispatch (`ParentCustomMessagePool.eligibleFor`) -- never through `CustomSuggestionStore`. This is
the same mechanism, a new logical store class, exactly matching how `WellbeingPolicyStore` /
`WellbeingRateStateStore` / `CustomSuggestionStore` / `DailyMissionStateStore` already coexist over
that one port.

`ParentPolicyStateStore.clear()` and `WellbeingFeedbackLogStore.clear()` are **not** wired into
`WellbeingDataEraser.purgeAll()` (that class also lives under `persistence/**`) -- see section 12
of this document ("parent-web / coordinator integration action") for the follow-up this implies.

## 5. Faith-content invariant preserved through the adapter

`FAITH_POSITIVE` maps 1:1 both ways. The adapter adds no path by which a parent policy can make it
mandatory or a gate for anything: `ParentPolicyToAndroidPolicyAdapter.derivePolicy` never touches
`WellbeingNudgePolicy.faithContentEnabled` at all (it is left exactly as the local
`WellbeingPolicyStore` already has it), and a `FAITH_POSITIVE`-category custom message goes through
the same `enabled`/`archivedAt`/target/schedule eligibility gates as every other category, with no
special-cased "required" or "unlock condition" flag anywhere in `SdkCustomWellbeingMessage`. This
preserves PCA-WELL-004 exactly as doc 35 states it.

## 6. Movement and household safety

- **Movement (item 9, PCA-WELL-025).** `MovementContentGuard` rejects `MOVEMENT_RESET`-category
  custom messages whose title/body mentions calories, weight, body-shape goals, or punitive/
  "make up for screen time" language, mirroring the curated catalogue's existing tone contract
  (`WellbeingContentCatalogueTest`'s "movement-reset content never mentions calories or weight").
  Curated content was already safe; this closes the same gap for parent-authored custom content.
- **Household/hazard (item 10, PCA-WELL-026).** No hazard-keyword classifier was added (none
  existed to extend, and the task explicitly says not to build one from scratch). Enforcement is
  entirely the `requiresAdultSupervision` gate (item 8), which this adapter maps faithfully and
  defensively (see section 7) and which `NudgeSelectionEngine`'s unchanged eligibility filter
  already excludes from every delivery surface except `IN_APP_CARD`.

## 7. Custom message field mapping

| SDK field (`CustomWellbeingMessage` / `DeliveryPolicy`) | Android target | Notes |
|---|---|---|
| `category` | `WellbeingSuggestion.category` | via `CategoryMapping.toAndroid` |
| `languageTexts[deviceLocale]` | `WellbeingSuggestion.messageId` (`custom_raw:` prefix, reusing the existing `WellbeingMessageResolver` convention) | **No auto-translate, no fallback**: a locale missing from `languageTexts` makes the message simply not eligible right now (item 7) |
| *(none -- SDK has no duration concept)* | `WellbeingSuggestion.duration = SHORT_2_5_MIN` | Deliberate one-way default (safest, least time-demanding bucket), documented, not a lossy round-trip of an SDK field |
| `delivery.requiresAdultSupervision` | `WellbeingSuggestion.requiresAdultSupervision` | Passed through faithfully; enforced by the unchanged engine gate |
| `delivery.lockScreenAllowed` | `WellbeingSuggestion.lockScreenSafe` | `lockScreenSafe = lockScreenAllowed && !requiresAdultSupervision` -- forced `false` whenever adult supervision is required, regardless of what the incoming payload claims (defense-in-depth, doc 36 PCA-WELLCTRL-071) |
| `delivery.triggers` | *(gates pool membership, not a `WellbeingSuggestion` field)* | via `TriggerMapping.coversAndroidTrigger` in `ParentCustomMessagePool.eligibleFor` |
| `schedule` (`startDate`/`endDate`/`daysOfWeek`/`timeWindows`) | *(gates pool membership)* | via `ScheduleWindowEvaluator.isActiveNow` -- see section 8 |
| `target` | *(gates pool membership)* | via `SdkTargetScope.reaches(childProfileId)` |
| `enabled` / `archivedAt` | *(gates pool membership)* | disabled or archived messages produce nothing |
| `delivery.minimumIntervalMinutes` / `maximumPerDay` / `repeatCooldownMinutes` | `WellbeingNudgePolicy.minimumInterval` / `maximumDailyNudges` / `sameSuggestionRepeatCooldown` | Policy-wide, not per-suggestion, on the Android side -- see section 9 (FREQUENCY) |

## 8. Schedule vs. PCA bedtime -- kept separate (item 14)

`ScheduleWindowEvaluator` (message-level "is this custom message in its authored calendar window
right now") and `WellbeingScheduleContextSource` (PCA-3 bedtime/schedule suppression, WELL-3) are
two distinct concerns, exactly matching how `NudgeDeliveryStatus` already distinguishes
`SUPPRESSED_PCA_BEDTIME` from other suppression reasons:

- `ScheduleWindowEvaluator` runs entirely inside `ParentCustomMessagePool.eligibleFor`, *before* a
  suggestion ever reaches `NudgeSelectionEngine` -- it only decides whether a given custom message
  is even in the candidate pool.
- `WellbeingScheduleContextSource` is consulted exactly where it already was, inside
  `WellbeingTriggerDispatcher.buildContext` -> `NudgeSelectionEngine.evaluate`, unchanged. This
  adapter ships no new implementation of that port and does not touch
  `NoOpWellbeingScheduleContextSource` -- the integration tests use a fake purely to prove the seam
  is still consulted, not to replace it.

`SdkScheduleWindow.timezoneId`, when present, is **not** converted -- `ScheduleWindowEvaluator`
always uses the device's own local wall clock, consistent with
`WallClockCalendarSource`'s existing lack of timezone-conversion capability. This is a documented
limitation, not a silent bug: doc 36 section 8 only requires syntactic timezone validity, and
device-local time is already correct for the common single-device-family case.

## 9. Frequency folding (item FREQUENCY)

`DeliveryPolicy` is per-message on the SDK side; `WellbeingNudgePolicy`'s anti-spam knobs are
policy-wide on the Android side, and this adapter does not add a per-suggestion mechanism (item 3:
consumed unchanged). `ParentPolicyToAndroidPolicyAdapter.derivePolicy` folds every enabled,
non-archived custom message's `DeliveryPolicy` using the **most conservative value** across all of
them, safety-first (a custom message's frequency intent is never exceeded, only matched or made
stricter):

- `minimumInterval` = `max(base value, every message's minimumIntervalMinutes)`
- `maximumDailyNudges` = `min(base value, every message's maximumPerDay)`
- `sameSuggestionRepeatCooldown` = `max(base value, every message's repeatCooldownMinutes)`

The SDK's own product-safe floors/ceiling (`bounds.ts`:
`MINIMUM_INTERVAL_MINUTES_FLOOR=5`, `MAXIMUM_PER_DAY_CEILING=12`, `REPEAT_COOLDOWN_MINUTES_FLOOR=15`)
are assumed already enforced client-side before a policy is accepted (doc 36 section 8); this
adapter only conservatively combines already-valid numbers.

## 10. Offline policy state machine (items 5, 15)

```
                 receive(payload, operationId)
                            |
                            v
            ParentPolicyRevisionGuard.evaluate(...)
             /              |                \
            v               v                 v
   DuplicateNoOp     StaleRejected         Accepted
   (snapshot           (snapshot          (commit revision,
    unchanged)          unchanged)         land in `pending`)
                                                  |
                                                  v
                                     WellbeingPolicySyncState
                                       { active, pending }
                                                  |
                                        promote() [explicit]
                                                  |
                                                  v
                                         pending -> active
                                       (rate state untouched)
```

- **ACTIVE**: the policy currently governing every `WellbeingTriggerDispatcher.dispatch` call.
  Survives offline/process-death indefinitely -- `ParentPolicyStateStore` persists it via the
  existing `PersistentStateStore` port, and network unavailability is never interpreted as
  "disable wellbeing" (nothing in this module treats an absent/failed sync as a policy change).
- **PENDING_DELIVERY** (`WellbeingPolicySyncState.pending`): a revision-accepted policy that has
  arrived but is not yet in effect. The old `active` policy keeps applying in full until an
  explicit `promote()` call -- never a partial/speculative blend of old and new.
- **Revision semantics** (`ParentPolicyRevisionGuard`, a direct port of `revisionGuard.ts`):
  a replayed `operationId` is always `DuplicateNoOp` regardless of revision numbers; otherwise a
  `newRevision` that is not strictly greater than the current revision is `StaleRejected`;
  otherwise the update is `Accepted` and lands in `pending`.
- **No reconnect backlog (item 13)**: `WellbeingPolicySyncState.promote()` and
  `ParentPolicySyncCoordinator.promote()` have signature `Snapshot -> Snapshot` -- there is no
  parameter or return value anywhere in that path that could carry a list of "nudges that would
  have fired." Promoting a policy changes what is eligible for *future* dispatches only; nudges
  missed while a policy was pending stay missed unless current eligibility naturally re-triggers
  one on the next real trigger. `ParentPolicyOfflineIntegrationTest` exercises this end to end.

## 11. Offline curated content and Give-Me-an-Idea (items 4, 6)

Curated content is unchanged: it stays bundled in `WellbeingContentCatalogue` (compiled into the
APK, zero network dependency). `ParentPolicyToAndroidPolicyAdapter.curatedEntriesFor` only ever
*filters* that bundled list by suggestionId enable/disable state from the parent policy -- it never
fetches or duplicates curated prose. `GiveMeAnIdeaButton` and
`WellbeingTriggerDispatcher.dispatch(CHILD_REQUESTED_IDEA, ...)` are untouched; feeding them
curated entries plus `ParentCustomMessagePool.eligibleFor(..., NudgeTrigger.CHILD_REQUESTED_IDEA, ...)`
is the only wiring needed, and both inputs are always locally available
(`ParentPolicyOfflineIntegrationTest`'s "offline give-me-an-idea" test proves this with no network
call anywhere in the path).

## 12. Offline feedback (item 12)

`WellbeingFeedbackLogStore` durably persists `NudgeFeedback` records (through
`PersistentStateStore`, fully offline) so `WellbeingAggregateSummaryBuilder` has something to read
from after a restart. No screen-time reward is granted anywhere in this store or its callers
(PCA-WELL-005 unchanged). `WellbeingFeedbackSyncPort` is a narrow, implementation-free interface
(matching the existing `ports/WellbeingPorts.kt` pattern) for a future privacy-minimized sync lane
to implement -- this module makes no network call itself, matching item 18 exactly.

## 13. Security / privacy summary

- No direct server call exists anywhere in `policy/**` or `ports/WellbeingFeedbackSyncPort.kt`.
- No new central plaintext storage: `ParentPolicyStateStore` and `WellbeingFeedbackLogStore` are
  local-only, over the same on-device `PersistentStateStore` port every existing store already
  uses; at-rest protection is that port's concern (unchanged).
- No hidden monitoring: this adapter reads only what it is explicitly handed
  (a `ParentWellbeingPolicyV1` payload, feedback events, wall-clock/locale) -- no new sensor,
  usage, or activity signal was added.
- No screen-time or emergency-restriction authority was added: every output of this adapter is
  either a `WellbeingNudgePolicy` or a `WellbeingSuggestion`, the same two types
  `NudgeSelectionEngine` already only ever reads for nudge selection.

## 14. Parent-web integration action (for the parent-web owner, not implemented here)

This worktree does not modify `parent-web/**`. If/when parent-web wires the real
`@pca/parent-sdk-wellbeing-control` package against a live Android receiving device, it should be
aware that:

1. **Duration is not authorable.** The SDK's `CustomWellbeingMessage` has no duration-bucket
   concept, so every parent-authored message currently lands on Android as
   `DurationBucket.SHORT_2_5_MIN`. If parent-web wants parents to set an expected duration, doc 36
   needs a new field, and this adapter would need a corresponding mapping.
2. **Frequency is policy-wide on-device, not per-message.** A parent setting different
   `minimumIntervalMinutes`/`maximumPerDay`/`repeatCooldownMinutes` per message should understand
   that Android folds all active messages' values together conservatively (section 9) -- the UI
   should probably not imply that each message gets its own independent cadence once delivered.
3. **`CUSTOM` category messages render as "Family idea" on-device** (`PARENT_CUSTOM_OTHER`'s
   label). If parent-web wants a more specific parent-facing label for this bucket, that's a
   parent-web-only copy decision; the underlying category identity doesn't need to change.
4. **`BREAK_ACTIVE` behaves identically to `BREAK_STARTED` on Android today.** If parent-web's UI
   currently implies `BREAK_ACTIVE` means "keeps re-triggering for the whole break," that is not
   what happens on-device -- it only becomes eligible at the break-start dispatch. Either the UI
   copy should be adjusted, or a future Android change would need a real "still on break" trigger
   (out of scope here).
5. **No language fallback.** If a parent saves a message with only an `en` variant, it will not
   appear at all on a device whose locale is `ar` (and vice versa) -- parent-web should probably
   surface this as a validation warning ("this message won't be shown to children using Arabic")
   rather than the device silently doing nothing.
6. **Retention/Delete-Now gap.** `ParentPolicyStateStore` and `WellbeingFeedbackLogStore` are not
   yet wired into `WellbeingDataEraser.purgeAll()` (that file is outside this worktree's
   ownership). Whoever next touches `persistence/WellbeingDataEraser.kt` should add both stores'
   `clear()` calls alongside the existing four.
