package org.pca.app.runtime.schedule

import java.time.Instant

/**
 * The single entry point PCA enforcement (screentime/accessibility blocking) and future WELL-1/
 * WELL-3 wellbeing code (mission section 15) should call into -- never [ScheduleEvaluator] or
 * [SchedulePolicyValidator] directly, so there is exactly one place that composes "which policy
 * is trusted right now" with "what does that policy decide right now."
 *
 * Fully offline-safe: reads only [store] (already-synced/cached on-device state) and the
 * [nowUtc]/[connectivity]/[enforcementCapability] passed in by the caller, so it never itself
 * performs I/O beyond the injected [SchedulePolicyStore].
 */
class ScheduleRuntime(
    private val store: SchedulePolicyStore,
    private val communicationSurfacesProvider: () -> CommunicationSafetySurfaceTokens = { CommunicationSafetySurfaceTokens() },
) {

    /** The full decision, including which [ScheduleRuntimeState] the underlying policy was in
     * (for honest parent-facing/UI freshness reporting) alongside the enforcement [ScheduleDecision]. */
    data class Result(
        val runtimeState: ScheduleRuntimeState,
        val decision: ScheduleDecision,
        /** The policy selected by the acceptance gate, if one is safe to evaluate. */
        val effectivePolicy: SchedulePolicyV1?,
    )

    fun evaluate(
        nowUtc: Instant,
        appToken: OpaqueAppToken,
        enforcementCapability: EnforcementCapabilityState,
        connectivity: Connectivity,
    ): Result {
        val stored = store.read()
        if (stored == SchedulePolicyStoreRead.Corrupt) {
            return Result(
                ScheduleRuntimeState.CORRUPT_LOCAL_STATE,
                ScheduleDecision(
                    decision = ScheduleDecisionKind.ENFORCEMENT_UNAVAILABLE,
                    reason = "Persisted schedule policy is unreadable; enforcement cannot be determined.",
                ),
                effectivePolicy = null,
            )
        }
        val snapshot = (stored as? SchedulePolicyStoreRead.Present)?.snapshot
        val acceptance = acceptanceFor(snapshot, nowUtc, connectivity)

        val evaluationInput = acceptance.effectivePolicy?.toEvaluationInput(
            nowUtc = nowUtc,
            appToken = appToken,
            enforcementCapability = enforcementCapability,
            connectivity = connectivity,
            lastPolicySyncAtUtc = snapshot?.lastPolicySyncAtUtc,
            communicationSurfaces = communicationSurfacesProvider(),
        ) ?: emptyEvaluationInput(nowUtc, appToken, enforcementCapability, connectivity, snapshot?.lastPolicySyncAtUtc)

        return Result(acceptance.state, ScheduleEvaluator.evaluate(evaluationInput), acceptance.effectivePolicy)
    }

    /** WELL-3 closure support (mission section 15): whether a BEDTIME window is active right
     * now, for a future `WellbeingScheduleContextSource.isPcaBedtimeActive`. Deliberately
     * app-token-independent (checks any ALL-scoped active BEDTIME window) and deliberately kept
     * separate from Break Shield, which is a different feature entirely
     * (`feature/screentime/engine/ScreenTimeEngine.kt`'s `BREAK_SHIELD` mode). */
    fun isPcaBedtimeActive(nowUtc: Instant): Boolean {
        val read = store.read()
        if (read == SchedulePolicyStoreRead.Corrupt) return true
        val snapshot = (read as? SchedulePolicyStoreRead.Present)?.snapshot ?: return false
        val policy = currentEffectivePolicy(snapshot, nowUtc) ?: return false
        return policy.effectiveWindows().any {
            it.kind == ScheduleWindowKind.BEDTIME && it.appScope is AppScope.All && isWindowActive(it, nowUtc)
        }
    }

    /** WELL-3 closure support: whether the device is currently in a schedule-driven "quiet"
     * context -- bedtime or school mode active for all apps -- for a future
     * `WellbeingScheduleContextSource.isScheduledQuietContext`. */
    fun isScheduledQuietContext(nowUtc: Instant): Boolean {
        val read = store.read()
        if (read == SchedulePolicyStoreRead.Corrupt) return true
        val snapshot = (read as? SchedulePolicyStoreRead.Present)?.snapshot ?: return false
        val policy = currentEffectivePolicy(snapshot, nowUtc) ?: return false
        return policy.effectiveWindows().any {
            (it.kind == ScheduleWindowKind.BEDTIME || it.kind == ScheduleWindowKind.SCHOOL_MODE) &&
                it.appScope is AppScope.All &&
                isWindowActive(it, nowUtc)
        }
    }

    private fun currentEffectivePolicy(snapshot: SchedulePolicySnapshot, nowUtc: Instant): SchedulePolicyV1? {
        // Connectivity only distinguishes CURRENT vs. STALE_REMOTE here, both of which resolve
        // to the same effectivePolicy (the candidate) -- see SchedulePolicyValidator.evaluate.
        return acceptanceFor(snapshot, nowUtc, Connectivity.OFFLINE).effectivePolicy
    }

    private fun acceptanceFor(snapshot: SchedulePolicySnapshot?, nowUtc: Instant, connectivity: Connectivity): PolicyAcceptanceResult =
        SchedulePolicyValidator.evaluate(
            PolicyAcceptanceInput(
                candidatePolicy = snapshot?.candidatePolicy,
                lastKnownGoodPolicy = snapshot?.lastKnownGoodPolicy,
                nowUtc = nowUtc,
                deviceTrustSetEpoch = snapshot?.deviceTrustSetEpoch ?: 0,
                deviceKeyEpoch = snapshot?.deviceKeyEpoch ?: 0,
                connectivity = connectivity,
                lastPolicySyncAtUtc = snapshot?.lastPolicySyncAtUtc,
            ),
        )

    private fun emptyEvaluationInput(
        nowUtc: Instant,
        appToken: OpaqueAppToken,
        enforcementCapability: EnforcementCapabilityState,
        connectivity: Connectivity,
        lastPolicySyncAtUtc: Instant?,
    ): ScheduleEvaluationInput = ScheduleEvaluationInput(
        nowUtc = nowUtc,
        timezone = "UTC",
        appToken = appToken,
        windows = emptyList(),
        bonusGrants = emptyList(),
        exceptions = emptyList(),
        dailyLimit = null,
        enforcementCapability = enforcementCapability,
        connectivity = connectivity,
        lastPolicySyncAtUtc = lastPolicySyncAtUtc,
        communicationSurfaces = communicationSurfacesProvider(),
    )
}
