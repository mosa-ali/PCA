package org.pca.app.runtime.tamper

import java.util.UUID
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.repository.TamperEventRepository
import org.pca.app.platform.TrackedUsageAccessState
import org.pca.app.platform.UsageAccessStateTracker

/**
 * PCA-FR-085 + PCA-FR-081: the one real, documented-API-only tamper-signal producer this lane
 * adds. Detects the app's OWN usage-access permission being revoked -- a fully transparent,
 * disclosed signal any parental-control app legitimately needs (the app cannot do its job without
 * that permission), never a covert/undocumented detection mechanism (Section 16 of the mission
 * brief's safety boundary). Built entirely on [UsageAccessStateTracker], which already exists and
 * already does the hard evidence-backed-history work (REVOKED vs. DENIED vs. DEGRADED) -- this
 * class only decides WHAT TO DO with that state: write a [org.pca.app.persistence.entity.TamperEventEntity]
 * row and surface a local notification, PCA-4/PCA-9's decision layers this class explicitly does
 * not encroach on (no PIN/approval/removal-decision UI is built here -- WRITER64's territory).
 *
 * Transition-debounced: [checkAndHandle] only acts the FIRST time it observes a given
 * [TrackedUsageAccessState] change (never re-fires every poll while the state stays the same), so
 * a REVOKED state discovered by a 5-minute in-process poll and then re-confirmed by the 15-minute
 * `WorkManager` safety net does not spam a tamper row / notification every single cycle.
 *
 * [notifyParent] is injected as a plain function rather than depending on
 * [org.pca.app.platform.UsageAccessAlertNotificationDelivery] directly, matching this codebase's
 * existing pattern for [org.pca.app.runtime.wellbeing.WellbeingRuntimeCoordinator]'s `deliver`
 * callback -- keeps this class trivially unit-testable without an Android notification stack.
 *
 * Local-device-only: this writes to the on-device Room database and posts a same-device
 * notification. Propagating a [org.pca.app.persistence.entity.TamperEventEntity] onward to the
 * parent's own device/app requires the crypto-gated sync outbox (`PRODUCTION_CRYPTO_SUITE` review,
 * see [org.pca.app.runtime.graph.PcaAppGraph]'s own `familySyncRuntimePort` doc comment) -- that
 * remains an external, not-yet-activated boundary this lane does not cross; retention/outbox
 * convergence on THIS side of that boundary is exercised as thoroughly as possible short of it
 * (see `RetentionEngineTest`/`DeleteNowCoordinatorTest`).
 */
class UsageAccessDegradationMonitor(
    private val tracker: UsageAccessStateTracker,
    private val deviceIdProvider: () -> String?,
    private val wallClockTimeSource: WallClockTimeSource,
    private val tamperEventRepository: TamperEventRepository,
    private val notifyParent: (TrackedUsageAccessState) -> Boolean,
) {
    @Volatile
    private var lastObservedState: TrackedUsageAccessState? = null

    /**
     * Re-evaluates live state via [tracker] and acts only on a genuine transition INTO REVOKED or
     * DEGRADED (never on every call, never on a transition between two non-alerting states). Safe
     * to call from both the in-process poll loop and the `WorkManager` safety-net job -- state is
     * held on this single monitor instance (constructed once in
     * [org.pca.app.runtime.graph.PcaAppGraph], never per-call), so both callers see and update the
     * same debounce state rather than each re-notifying independently.
     */
    suspend fun checkAndHandle() {
        val state = tracker.currentState()
        val previous = lastObservedState
        lastObservedState = state
        if (previous == state) return
        if (previous == null) return // first-ever observation is a baseline, not a transition.

        when (state) {
            TrackedUsageAccessState.REVOKED -> {
                val deviceId = deviceIdProvider()
                if (deviceId != null) {
                    val now = wallClockTimeSource.currentTimeMillis()
                    tamperEventRepository.record(
                        id = UUID.nameUUIDFromBytes("$deviceId|USAGE_ACCESS_REVOKED|$now".toByteArray(Charsets.UTF_8)).toString(),
                        deviceId = deviceId,
                        conditionType = CONDITION_USAGE_ACCESS_REVOKED,
                        detectedAtEpochMillis = now,
                    )
                }
                notifyParent(state)
            }
            TrackedUsageAccessState.DEGRADED -> notifyParent(state)
            else -> Unit
        }
    }

    companion object {
        const val CONDITION_USAGE_ACCESS_REVOKED = "USAGE_ACCESS_REVOKED"
    }
}
