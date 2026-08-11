# 35 — Positive Habits, Productive Alternatives & Healthy Digital Balance (PCA-WELL-1)

## Purpose and boundary

**PCA-WELL-001.** PCA-WELL-1 is a *positive nudge and alternative-activity suggestion* layer. It
is not a second enforcement engine: it never locks, blocks, delays, shortens, extends, or grants
screen time. It consumes existing signals from PCA-3 (Screen-Time/Break Engine, doc 12) and PCA-4
(App Usage visibility, doc 15) and offers the child low-pressure, dignity-respecting suggestions
for alternative activities. All enforcement authority remains with PCA-3; the Break Shield timer
(`ScreenTimeEngine`) is authoritative and untouched by this module.

**PCA-WELL-002 (Child-dignity contract).** No suggestion, notification, summary, or policy surface
produced by this module may use shame, fear, guilt, threats, manipulation, comparison to siblings,
rankings, "red scores", streak-loss punishment, or medical/addiction diagnosis language. A refused
or ignored suggestion has no consequence. `CONTINUE` (keep using the app) is always a valid,
non-penalized outcome, never framed as failure.

**PCA-WELL-003 (No second enforcement engine).** `GAME_RETURN_NUDGE` and all other triggers are
soft, dismissable, and non-blocking. They present as an ordinary card/notification the child can
ignore, snooze, or dismiss; they never prevent app usage, never resemble a system lock screen, and
never use full-screen intents disguised as system warnings.

**PCA-WELL-004 (Faith-positive is optional and never conditional).** `FAITH_POSITIVE` is one of
thirteen content categories, defaulting to the family's existing faith preference but always
independently toggleable and never a condition for unlocking, accessing, or being rewarded
anything (screen time, praise tiers, streaks). Disabling it must not disable or downgrade any
other capability.

**PCA-WELL-005 (Self-report only).** Child feedback (`HELPFUL` / `NOT_FOR_ME` / `REMIND_LATER` /
`DONE_SELF_REPORTED`) is entirely self-reported. There is no camera, microphone, location, or
sensor-based verification of whether a suggestion was actually done. `DONE_SELF_REPORTED` never
auto-grants screen time, bonus time, or unblocks anything — it is a private wellbeing signal only.

## Relationship to existing engines (no duplication)

| Existing engine | What PCA-WELL-1 reuses | What PCA-WELL-1 does NOT do |
|---|---|---|
| PCA-3 `ScreenTimeEngine`/`BreakShieldController` (doc 12) | Break-shield state (`ScreenTimeMode`), `MonotonicTimeSource` | Never mutates `ScreenTimeState`; break-shield delivery is display-only (one optional suggestion or `GIVE_ME_AN_IDEA`) |
| PCA-4 App Usage visibility (doc 15) | "high-engagement / qualifying app" foreground signal, via a narrow port (`EligibleAppSignalSource`) | Does not reimplement usage accounting |
| PCA-2 `PersistentStateStore` / `EncryptedSharedPreferencesStateStore` | Durable local storage for policy/rate-state/custom suggestions | Does not add a second storage mechanism |
| PCA-11 Family Envelope / FTS sync (doc 09, doc 11) | Transport contract for any parent-authored/child-feedback data that syncs; E2EE via the same envelope, no second transport | Does not read plaintext at any relay; does not invent a parallel sync channel |
| PCA-12 retention/Delete Now (doc 11) | Same retention model; local purge hook exposed for a Delete-Now orchestrator to call | No Android-side Delete-Now orchestrator exists yet in this baseline (see Coordinator queue) — `WellbeingDataEraser.purgeAll()` is provided and must be wired in when that orchestrator lands |

## Requirement IDs (traceability)

| ID | Requirement |
|---|---|
| PCA-WELL-001 | Non-enforcing nudge layer only; PCA-3 stays authoritative |
| PCA-WELL-002 | Child-dignity contract: no shame/fear/threat/manipulation/comparison |
| PCA-WELL-003 | No second enforcement engine; all delivery is soft/dismissable |
| PCA-WELL-004 | Faith-positive optional, independently toggleable, never a gate |
| PCA-WELL-005 | Feedback is self-report only, `DONE` never grants anything |
| PCA-WELL-006 | 13-category curated EN+AR content catalogue, stable `suggestionId` |
| PCA-WELL-007 | `WellbeingNudgePolicy` — parent-owned configuration surface, positive terminology only |
| PCA-WELL-008 | Anti-spam: `minimumInterval`, `maximumDailyNudges`, `sameSuggestionRepeatCooldown`, quiet hours |
| PCA-WELL-009 | Trigger set consumes existing PCA-3/PCA-4 signals only (no new screen-time engine) |
| PCA-WELL-010 | `GAME_RETURN_NUDGE` soft-nudge (CONTINUE / TRY_AN_ALTERNATIVE / REMIND_ME_LATER) |
| PCA-WELL-011 | Game-return durable state uses MONOTONIC time only, degrades safely across reboot |
| PCA-WELL-012 | Delivery abstraction incl. `LOCK_SCREEN_NOTIFICATION_BEST_EFFORT`; Android boundary = ordinary notifications only |
| PCA-WELL-013 | Lock-screen privacy: generic/redacted public copy, never leaks app/faith/family data on a secure lock screen |
| PCA-WELL-014 | Quiet/context suppression: emergency, active call, quiet hours, school-mode, navigation/safety, critical warning, degraded/error flow |
| PCA-WELL-015 | Deterministic local selection engine; no cloud AI; not optimized for engagement |
| PCA-WELL-016 | Variety/diversity engine across category + duration + suggestion history |
| PCA-WELL-017 | `NOT_FOR_ME` cooldown suppression; specific rejected suggestion never reported to parent |
| PCA-WELL-018 | Custom parent suggestions: length-bounded, sanitized, E2EE, local, category/language-tagged |
| PCA-WELL-019 | Local/E2EE data model; no activity history/screen content/keystrokes/camera/message data |
| PCA-WELL-020 | Retention + Delete Now purge hook (`WellbeingDataEraser`) |
| PCA-WELL-021 | Full EN+AR+RTL+accessibility using Android string-resource message architecture (no hardcoded UI strings) |
| PCA-WELL-022 | Daily positive mission (DONE/SKIP/NEW_IDEA), no punishment, no auto reward |
| PCA-WELL-023 | `GIVE_ME_AN_IDEA` child-facing offline feature |
| PCA-WELL-024 | Break-shield integration: at most one optional suggestion, never touches the timer |
| PCA-WELL-025 | Movement/reset content excludes calories/weight/punitive-exercise framing |
| PCA-WELL-026 | Safe-household-task rules: `requiresAdultSupervision` on anything hazardous |
| PCA-WELL-027 | Never logs/telemeters app names, faith preference, or family config in plaintext |

## Content categories (PCA-WELL-006)

`SKILLS_AND_LEARNING`, `READING`, `FAITH_POSITIVE`, `GRATITUDE`, `GOOD_DEED`, `FAMILY_HELP`,
`HOME_RESPONSIBILITY`, `CREATIVITY`, `MOVEMENT_RESET`, `REST_AND_RESET`, `OUTDOOR_OR_OFFSCREEN`,
`PLANNING_AND_ORGANIZATION`, `CHILD_SELECTED_FAVORITES`.

Each `WellbeingSuggestion` carries a stable `suggestionId`, a `messageId` (Android string-resource
name resolved at the UI layer — the domain layer stays platform-neutral and never hardcodes
display text), category, duration bucket (`SHORT_2_5_MIN` / `MEDIUM_5_15_MIN` / `LONG_15_30_MIN`),
`lockScreenSafe`, `requiresAdultSupervision`, `enabledByDefault`, and a content `version`. Content
lives in `WellbeingContentCatalogue.kt`; display copy lives in `res/values/strings.xml` (English)
and `res/values-ar/strings.xml` (Arabic, RTL via the existing Android resource-qualifier
mechanism — the same architecture doc 20 describes for the rest of the app).

## Android lock-screen boundary (PCA-WELL-012/013)

Only ordinary `NotificationCompat` notifications are used. There is no full-screen intent, no
overlay window, no Accessibility-Service-driven UI injection, and no `DevicePolicyManager` use in
this module. Lock-screen visibility is `BEST_EFFORT`: this module can only *ask* the OS to show a
notification; whether the OS actually renders it on a secure lock screen is outside this module's
control (manufacturer skins, notification-visibility settings, DND). When lock-screen delivery is
attempted, the notification's public/lock-screen-visible content is a fixed generic string
("PCA has an idea for you") that never includes the eligible app's name, category specifics, faith
preference, or any family-identifying detail; full content is only shown after unlock
(`NotificationCompat.VISIBILITY_PRIVATE` with a redacted public version).

## Game-return durable state (PCA-WELL-011)

`GameReturnState` persists only: `lastEligibleAppId` (a fixed non-reversible per-app symbolic
token, never the raw display name, for the rate-limit/dedup key), `lastEligibleExitMonotonicNanos`,
`lastScreenLockMonotonicNanos`, `lastUnlockMonotonicNanos`, `lastNudgeMonotonicNanos`,
`dailyNudgeCount` (paired with a monotonic day-boundary anchor, never wall-clock date), and
`recentSuggestionIds`. All comparisons use `MonotonicTimeSource`; wall-clock is never read for
elapsed-time math (same rule as doc 12). On reboot/process death, only this durable state is
restored — no elapsed time is fabricated across the boundary, and the daily counters use the same
conservative reset-on-uncertainty policy as PCA-3's cross-boot handling: a boot-generation gap
resets the day-window rather than assuming zero elapsed nudges were sent.

## iOS status

Platform-neutral contracts (`WellbeingSuggestion`, `WellbeingNudgePolicy`, `NudgeTriggerContext`,
`NudgeSelection`, `NudgeDeliveryResult`, `NudgeFeedback`, selection engine) are pure Kotlin with no
Android dependency, so they are portable to a future Kotlin Multiplatform iOS target. No PCA-15
iOS app exists in this worktree's baseline to integrate against; iOS-side delivery (UNUserNotification,
Screen Time API interplay) is deferred and documented as a requirement for whichever lane later
carries PCA-15 forward, not fabricated here.
