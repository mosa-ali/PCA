package org.pca.app.runtime.background

import org.pca.app.platform.PowerSaveModeSource

/**
 * PCA-NFR-034 ("Battery Budget"): the one canonical, machine-checkable resource-budget policy
 * every recurring/background mechanism in this app should conform to or reference -- the
 * repo-wide EVENT_DRIVEN_BATTERY_BUDGET standing decision made concrete as code, not just a doc.
 * Companion to [PcaBackgroundWorkConstraints] (which owns the `WorkManager`-specific
 * `Constraints`/`BackoffCriteria` wiring for PCA-NFR-033): this object owns the cross-cutting
 * assertions that apply beyond `WorkManager` alone, so a non-`WorkManager` caller -- or a test --
 * can assert against the SAME numbers real schedulers are built from, rather than a second,
 * independently-guessed magic literal that could silently drift out of sync.
 *
 * Two things this app's background mechanisms should conform to, both enforced here:
 *  1. [MIN_PERIODIC_INTERVAL_MINUTES] / [meetsPlatformMinimumInterval] -- `WorkManager`'s own
 *     documented, enforced floor for `PeriodicWorkRequest`
 *     ([androidx.work.PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS]). A periodic job scheduled
 *     below this is either silently coerced up by the OS or is a bug -- see
 *     [WorkManagerBackgroundExecutionScheduler.PERIOD_MINUTES], which is defined IN TERMS OF
 *     [MIN_PERIODIC_INTERVAL_MINUTES] rather than repeating the literal `15`, so the two can never
 *     drift apart.
 *  2. [shouldRunNonCriticalWork] -- the one shared "should non-safety-critical background work run
 *     right now" decision, backed by the documented [PowerSaveModeSource] (`PowerManager.isPowerSaveMode`)
 *     signal. Bounded retry backoff for non-`WorkManager` retries (e.g.
 *     [org.pca.app.runtime.sync.ReconnectSyncOrchestrator]'s outbox drain) is the separate,
 *     already-existing, already-tested [org.pca.app.runtime.sync.backoff.computeBackoff]
 *     policy (`MAX_RETRY_COUNT`/`BACKOFF_CAP_MILLIS`/`BACKOFF_BASE_MILLIS`) -- not duplicated here.
 *
 * NEVER a battery-PERCENTAGE claim (no "saves N% battery" anywhere in this object or its callers)
 * -- only machine-checkable behavioral bounds (interval floors, event-driven-vs-polling,
 * battery-saver responsiveness), per this app's standing "no fabricated battery claims" rule.
 *
 * [shouldRunNonCriticalWork] must NEVER gate this app's safety-critical protection paths --
 * schedule/active-restriction enforcement ([org.pca.app.runtime.PcaRuntime]'s tick loop) and the
 * protection/tamper-degradation monitors
 * ([org.pca.app.runtime.tamper.UsageAccessDegradationMonitor] and its siblings, called
 * unconditionally from [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle])
 * both call this device honestly regardless of what this policy reports, by design -- see
 * [BatteryBudgetedCycleRunner]'s own doc comment for where that unconditional/gated split is
 * actually wired.
 */
object PcaBatteryBudgetPolicy {
    /** `WorkManager`'s own documented, enforced floor for `PeriodicWorkRequest` (15 minutes). */
    const val MIN_PERIODIC_INTERVAL_MINUTES: Long = 15L

    /** True when [intervalMinutes] is at or above the platform's supported periodic-work floor. */
    fun meetsPlatformMinimumInterval(intervalMinutes: Long): Boolean =
        intervalMinutes >= MIN_PERIODIC_INTERVAL_MINUTES

    /**
     * True unless the OS currently reports Battery Saver / power-save mode active. Callers use
     * this to decide whether to run NON-safety-critical background work this cycle (usage/location
     * collection, prayer-location staleness notification, geofence evaluation, notification
     * sweeps, wellbeing checks) -- never to gate safety-critical protection (see this object's own
     * class doc).
     */
    fun shouldRunNonCriticalWork(powerSaveModeSource: PowerSaveModeSource): Boolean =
        !powerSaveModeSource.isPowerSaveMode()
}
