# Coordinator Integration Queue

Not part of the controlled architecture set (00–34) or its manifest. This is a working list of
cross-feature wiring deliberately deferred out of an individual lane's worktree because it needs to
observe or call into another lane's live state (usage tracking, break/schedule engine, sync
transport, delete orchestration, etc.). Each item below compiles and is fully unit-testable against
its narrow port/interface without the real wiring; a Coordinator (or the lane that owns the other
side of the seam) is expected to supply the concrete adapter when that lane is ready.

## PCA-WELL-1 (Positive Habits, Productive Alternatives & Healthy Digital Balance — doc 35)

| Port / hook | Package | Why deferred | Current stand-in |
|---|---|---|---|
| `EligibleAppSignalSource` | `org.pca.app.feature.wellbeing.ports` | Needs PCA-4 app-usage visibility (doc 15) | No default implementation shipped; caller must inject one |
| `SuppressionContextSource` | `org.pca.app.feature.wellbeing.ports` | Needs live emergency/call/nav/school-mode/critical-warning/degraded-flow signals from elsewhere in the app | No default implementation shipped; caller must inject one |
| `BreakStateSource` | `org.pca.app.feature.wellbeing.ports` | Needs PCA-3's live `ScreenTimeEngine`/break-shield state (doc 12), read-only | No default implementation shipped; caller must inject one |
| `WellbeingScheduleContextSource` | `org.pca.app.feature.wellbeing.ports` | Needs PCA-3/PCA-4's real bedtime/schedule calculation (doc 12/15); WELL-1 must not reimplement that calculation itself (WELL-3 correction) | `NoOpWellbeingScheduleContextSource` — always reports "not active"; PCA-bedtime suppression (`NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME`) is a real, tested code path in `NudgeSelectionEngine`, but is inert until this adapter is wired to PCA-3's live state |
| Delete-Now orchestrator hook | `WellbeingDataEraser.purgeAll()` | No Android-side Delete-Now orchestrator exists yet in this baseline (doc 11) | Purge method exists and is unit-tested standalone; not yet called from any orchestrator |
| Family Envelope / FTS sync for policy + custom suggestions | `WellbeingPolicyStore`, `CustomSuggestionStore` | Cross-device sync rides the existing Family Envelope/FTS transport (doc 09, doc 11), not a new one | Local-only persistence (`PersistentStateStore`) today; no transport wiring |

None of the above affects WELL-1's core safety properties (rate limiting, quiet-hours precedence,
adult-supervision delivery gate, eligible-app filtering, dignity-contract content, self-report-only
feedback) — those are enforced entirely within this module's own tested code and do not depend on
any item in this table. This table only tracks *additional* signal fidelity (real bedtime state,
real app-usage visibility, etc.) that requires reaching into another lane.
