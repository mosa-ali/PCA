package org.pca.app.runtime.schedule

import java.time.Instant

/**
 * See `contracts/schedule-runtime/SchedulePolicyV1.md` "Policy-acceptance state machine" for the
 * full contract and rationale. New for this mission -- no pre-existing TS production
 * counterpart; kept in lock-step with the TS-side reference
 * (`backend/test/runtime-schedule-conformance/policyAcceptanceReference.mjs`) purely via the
 * shared vectors in `contracts/schedule-runtime/vectors/policy-acceptance-v1.json`.
 */
enum class ScheduleRuntimeState { CURRENT, STALE_REMOTE, INVALID, EPOCH_STALE, NO_ACCEPTED_POLICY }

data class PolicyAcceptanceResult(
    val state: ScheduleRuntimeState,
    /** The policy [ScheduleEvaluator] should actually be fed for this tick. Null only when
     * nothing has ever been validly accepted (behaviorally equivalent, at the evaluator, to an
     * empty policy -- see the doc's NO_ACCEPTED_POLICY case). Never null merely because the
     * *candidate* is currently invalid/stale/epoch-stale if a fallback exists -- see the doc's
     * fail-safe rule. */
    val effectivePolicy: SchedulePolicyV1?,
)

data class PolicyAcceptanceInput(
    /** The most recently locally-persisted policy record, which may itself be expired,
     * structurally invalid, or epoch-stale. */
    val candidatePolicy: SchedulePolicyV1?,
    /** The last policy that was itself confirmed CURRENT at some point -- the fail-safe fallback.
     * May be identical to [candidatePolicy], or null if nothing has ever validated. Owned/
     * maintained by the persistence layer (Agent 12, [SchedulePolicyStore]). */
    val lastKnownGoodPolicy: SchedulePolicyV1?,
    val nowUtc: Instant,
    val deviceTrustSetEpoch: Int,
    val deviceKeyEpoch: Int,
    val connectivity: Connectivity,
    val lastPolicySyncAtUtc: Instant?,
    val remoteStalenessThresholdMillis: Long = DEFAULT_REMOTE_STALENESS_THRESHOLD_MILLIS,
) {
    companion object {
        const val DEFAULT_REMOTE_STALENESS_THRESHOLD_MILLIS: Long = 259_200_000L // 72 hours
    }
}

object SchedulePolicyValidator {

    fun evaluate(input: PolicyAcceptanceInput): PolicyAcceptanceResult {
        val candidate = input.candidatePolicy
            ?: return PolicyAcceptanceResult(ScheduleRuntimeState.NO_ACCEPTED_POLICY, null)

        if (!isStructurallyValid(candidate)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, input.lastKnownGoodPolicy)
        }

        if (isExpired(candidate, input.nowUtc)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, input.lastKnownGoodPolicy)
        }

        if (isEpochBehind(candidate, input.deviceTrustSetEpoch, input.deviceKeyEpoch)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.EPOCH_STALE, input.lastKnownGoodPolicy ?: candidate)
        }

        if (input.connectivity == Connectivity.OFFLINE) {
            val staleByThreshold = input.lastPolicySyncAtUtc == null ||
                java.time.Duration.between(input.lastPolicySyncAtUtc, input.nowUtc).toMillis() > input.remoteStalenessThresholdMillis
            if (staleByThreshold) {
                return PolicyAcceptanceResult(ScheduleRuntimeState.STALE_REMOTE, candidate)
            }
        }

        return PolicyAcceptanceResult(ScheduleRuntimeState.CURRENT, candidate)
    }

    private fun isStructurallyValid(policy: SchedulePolicyV1): Boolean {
        if (policy.policyRevision <= 0) return false
        return policy.windows.all { validateScheduleWindow(it).isEmpty() }
    }

    private fun isExpired(policy: SchedulePolicyV1, nowUtc: Instant): Boolean {
        val expiresAt = policy.expiresAt ?: return false
        return !nowUtc.isBefore(expiresAt)
    }

    private fun isEpochBehind(policy: SchedulePolicyV1, deviceTrustSetEpoch: Int, deviceKeyEpoch: Int): Boolean =
        policy.trustSetEpoch < deviceTrustSetEpoch || policy.keyEpoch < deviceKeyEpoch

    /** Local defense-in-depth revision-monotonicity check; see SchedulePolicyV1.md "Revision
     * acceptance". The primary authority for monotonic version enforcement in transit remains
     * the Family Envelope's DataVersionLedger (doc 22 POLICY_UPDATE) -- this is a same-semantics
     * local safety net for this domain's own persisted record, not a competing authority. */
    fun isAcceptableRevision(candidateRevision: Int, previouslyAcceptedRevision: Int?): Boolean =
        previouslyAcceptedRevision == null || candidateRevision > previouslyAcceptedRevision
}
