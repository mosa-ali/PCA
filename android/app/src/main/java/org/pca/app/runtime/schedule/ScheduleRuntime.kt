package org.pca.app.runtime.schedule

import java.time.Instant
import org.pca.app.runtime.EpochBounds

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
    /** Production supplies the current ACTIVE local enrollment scope. Null means no such scope. */
    private val currentPolicyScopeProvider: (() -> SchedulePolicyRuntimeScope?)? = null,
    /** Persisted high-water mark from the rollback monitor; a read failure disables policy use. */
    private val trustedTimeFloorProvider: () -> Instant? = { null },
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
        val trustedNow = trustedNowOrNull(nowUtc) ?: return untrustedTimeResult()
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
        val acceptance = acceptanceFor(snapshot, trustedNow, connectivity)

        val evaluationInput = acceptance.effectivePolicy?.toEvaluationInput(
            nowUtc = trustedNow,
            appToken = appToken,
            enforcementCapability = enforcementCapability,
            connectivity = connectivity,
            lastPolicySyncAtUtc = snapshot?.lastPolicySyncAtUtc,
            communicationSurfaces = communicationSurfacesProvider(),
        ) ?: emptyEvaluationInput(trustedNow, appToken, enforcementCapability, connectivity, snapshot?.lastPolicySyncAtUtc)

        return Result(acceptance.state, ScheduleEvaluator.evaluate(evaluationInput), acceptance.effectivePolicy)
    }

    /** WELL-3 closure support (mission section 15): whether a BEDTIME window is active right
     * now, for a future `WellbeingScheduleContextSource.isPcaBedtimeActive`. Deliberately
     * app-token-independent (checks any ALL-scoped active BEDTIME window) and deliberately kept
     * separate from Break Shield, which is a different feature entirely
     * (`feature/screentime/engine/ScreenTimeEngine.kt`'s `BREAK_SHIELD` mode). */
    fun isPcaBedtimeActive(nowUtc: Instant): Boolean {
        val trustedNow = trustedNowOrNull(nowUtc) ?: return true
        val read = store.read()
        if (read == SchedulePolicyStoreRead.Corrupt) return true
        val snapshot = (read as? SchedulePolicyStoreRead.Present)?.snapshot ?: return false
        val policy = currentEffectivePolicy(snapshot, trustedNow) ?: return false
        return policy.effectiveWindows().any {
            it.kind == ScheduleWindowKind.BEDTIME && it.appScope is AppScope.All && isWindowActive(it, trustedNow)
        }
    }

    /** WELL-3 closure support: whether the device is currently in a schedule-driven "quiet"
     * context -- bedtime or school mode active for all apps -- for a future
     * `WellbeingScheduleContextSource.isScheduledQuietContext`. */
    fun isScheduledQuietContext(nowUtc: Instant): Boolean {
        val trustedNow = trustedNowOrNull(nowUtc) ?: return true
        val read = store.read()
        if (read == SchedulePolicyStoreRead.Corrupt) return true
        val snapshot = (read as? SchedulePolicyStoreRead.Present)?.snapshot ?: return false
        val policy = currentEffectivePolicy(snapshot, trustedNow) ?: return false
        return policy.effectiveWindows().any {
            (it.kind == ScheduleWindowKind.BEDTIME || it.kind == ScheduleWindowKind.SCHOOL_MODE) &&
                it.appScope is AppScope.All &&
                isWindowActive(it, trustedNow)
        }
    }

    /** A failed trusted-floor read cannot fall back to a possibly rolled-back system clock. */
    private fun trustedNowOrNull(nowUtc: Instant): Instant? = try {
        maxOf(nowUtc, trustedTimeFloorProvider() ?: nowUtc)
    } catch (_: Exception) {
        null
    }

    private fun untrustedTimeResult() = Result(
        ScheduleRuntimeState.INVALID,
        ScheduleDecision(
            decision = ScheduleDecisionKind.ENFORCEMENT_UNAVAILABLE,
            reason = "Trusted policy time is unavailable; enforcement cannot be determined.",
        ),
        effectivePolicy = null,
    )

    private fun currentEffectivePolicy(snapshot: SchedulePolicySnapshot, nowUtc: Instant): SchedulePolicyV1? {
        // Connectivity only distinguishes CURRENT vs. STALE_REMOTE here, both of which resolve
        // to the same effectivePolicy (the candidate) -- see SchedulePolicyValidator.evaluate.
        return acceptanceFor(snapshot, nowUtc, Connectivity.OFFLINE).effectivePolicy
    }

    private fun acceptanceFor(snapshot: SchedulePolicySnapshot?, nowUtc: Instant, connectivity: Connectivity): PolicyAcceptanceResult {
        val scope = currentPolicyScopeProvider?.let { provider ->
            val current = try {
                provider()
            } catch (_: Exception) {
                null
            } ?: return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, null)

            // An ACTIVE enrollment must have a concrete identity and established positive epoch
            // floors. Validate the live state before combining it with snapshot floors, so an
            // invalid FamilyStateStore value can never be hidden by maxOf(snapshot, scope).
            if (current.familyId.isBlank() || current.childProfileId.isBlank() ||
                current.trustSetEpoch < 1 || !EpochBounds.isValid(current.trustSetEpoch) ||
                current.keyEpoch < 1 || !EpochBounds.isValid(current.keyEpoch)
            ) {
                return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, null)
            }
            current
        }
        return SchedulePolicyValidator.evaluate(
            PolicyAcceptanceInput(
                candidatePolicy = snapshot?.candidatePolicy,
                lastKnownGoodPolicy = snapshot?.lastKnownGoodPolicy,
                nowUtc = nowUtc,
                deviceTrustSetEpoch = maxOf(snapshot?.deviceTrustSetEpoch ?: 0, scope?.trustSetEpoch ?: 0),
                deviceKeyEpoch = maxOf(snapshot?.deviceKeyEpoch ?: 0, scope?.keyEpoch ?: 0),
                connectivity = connectivity,
                lastPolicySyncAtUtc = snapshot?.lastPolicySyncAtUtc,
                expectedFamilyId = scope?.familyId,
                expectedChildProfileId = scope?.childProfileId,
            ),
        )
    }

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
