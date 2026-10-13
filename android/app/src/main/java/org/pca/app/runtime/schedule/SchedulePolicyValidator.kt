package org.pca.app.runtime.schedule

import org.pca.app.runtime.EpochBounds
import java.time.Instant

/**
 * See `contracts/schedule-runtime/SchedulePolicyV1.md` "Policy-acceptance state machine" for the
 * full contract and rationale. New for this mission -- no pre-existing TS production
 * counterpart; kept in lock-step with the TS-side reference
 * (`backend/test/runtime-schedule-conformance/policyAcceptanceReference.mjs`) purely via the
 * shared vectors in `contracts/schedule-runtime/vectors/policy-acceptance-v1.json`.
 */
enum class ScheduleRuntimeState { CURRENT, STALE_REMOTE, INVALID, EPOCH_STALE, NO_ACCEPTED_POLICY, CORRUPT_LOCAL_STATE }

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
    /** Null together means legacy callers did not supply runtime identity. Production binds both. */
    val expectedFamilyId: String? = null,
    val expectedChildProfileId: String? = null,
) {
    companion object {
        const val DEFAULT_REMOTE_STALENESS_THRESHOLD_MILLIS: Long = 259_200_000L // 72 hours
    }
}

object SchedulePolicyValidator {

    fun evaluate(input: PolicyAcceptanceInput): PolicyAcceptanceResult {
        // A corrupt or out-of-domain persisted floor cannot authorize policy application,
        // including through a previously accepted fallback.
        if (!EpochBounds.isValid(input.deviceTrustSetEpoch) || !EpochBounds.isValid(input.deviceKeyEpoch)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, null)
        }
        if (!isScopeInputValid(input)) return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, null)

        val safeFallback = input.lastKnownGoodPolicy?.takeIf { policy ->
            hasValidEpochs(policy) &&
                isStructurallyValid(policy) &&
                matchesExpectedScope(policy, input) &&
                !input.nowUtc.isBefore(policy.effectiveFrom) &&
                !isExpired(policy, input.nowUtc) &&
                !isEpochBehind(policy, input.deviceTrustSetEpoch, input.deviceKeyEpoch)
        }

        val candidate = input.candidatePolicy
        if (candidate == null) {
            val lastKnownGood = input.lastKnownGoodPolicy
                ?: return PolicyAcceptanceResult(ScheduleRuntimeState.NO_ACCEPTED_POLICY, null)

            if (!hasValidEpochs(lastKnownGood) || !isStructurallyValid(lastKnownGood) ||
                !matchesExpectedScope(lastKnownGood, input) || isExpired(lastKnownGood, input.nowUtc)) {
                return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, null)
            }
            if (input.nowUtc.isBefore(lastKnownGood.effectiveFrom)) {
                return PolicyAcceptanceResult(ScheduleRuntimeState.NO_ACCEPTED_POLICY, null)
            }
            if (isEpochBehind(lastKnownGood, input.deviceTrustSetEpoch, input.deviceKeyEpoch)) {
                return PolicyAcceptanceResult(ScheduleRuntimeState.EPOCH_STALE, null)
            }

            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, safeFallback)
        }

        if (!hasValidEpochs(candidate) || !isStructurallyValid(candidate)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, safeFallback)
        }

        if (!matchesExpectedScope(candidate, input)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, safeFallback)
        }

        if (isExpired(candidate, input.nowUtc)) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.INVALID, safeFallback)
        }

        if (isEpochBehind(candidate, input.deviceTrustSetEpoch, input.deviceKeyEpoch)) {
            // A last-known-good snapshot may be applied only when it is itself structurally
            // valid, unexpired, epoch-valid, and current with respect to both device floors.
            // If no such fallback exists, retain the structurally valid candidate for honest
            // diagnostics; the production port applies this retained candidate, but reports
            // EPOCH_STALE + null effectivePolicy as unavailable when no eligible policy exists.
            return PolicyAcceptanceResult(ScheduleRuntimeState.EPOCH_STALE, safeFallback ?: candidate)
        }

        // A future revision may already be durably received, but it cannot replace the active
        // policy before its signed effectiveFrom instant. Keep the eligible current LKG active;
        // without one, report no currently enforceable policy so the production port does not
        // apply the scheduled revision early or silently turn it into an allow-all decision.
        if (input.nowUtc.isBefore(candidate.effectiveFrom)) {
            val currentPolicy = safeFallback
                ?: return PolicyAcceptanceResult(ScheduleRuntimeState.NO_ACCEPTED_POLICY, null)
            return PolicyAcceptanceResult(remoteFreshnessState(input), currentPolicy)
        }

        if (remoteFreshnessState(input) == ScheduleRuntimeState.STALE_REMOTE) {
            return PolicyAcceptanceResult(ScheduleRuntimeState.STALE_REMOTE, candidate)
        }

        return PolicyAcceptanceResult(ScheduleRuntimeState.CURRENT, candidate)
    }

    private fun remoteFreshnessState(input: PolicyAcceptanceInput): ScheduleRuntimeState {
        if (input.connectivity != Connectivity.OFFLINE) return ScheduleRuntimeState.CURRENT
        val lastSync = input.lastPolicySyncAtUtc
        val staleByThreshold = lastSync == null ||
            java.time.Duration.between(lastSync, input.nowUtc)
                .compareTo(java.time.Duration.ofMillis(input.remoteStalenessThresholdMillis)) > 0
        return if (staleByThreshold) ScheduleRuntimeState.STALE_REMOTE else ScheduleRuntimeState.CURRENT
    }

    private fun isStructurallyValid(policy: SchedulePolicyV1): Boolean {
        if (policy.version != "1") return false
        if (policy.policyRevision <= 0) return false
        if (!isRecognizedTimezone(policy.timezone)) return false
        if (validateScheduleWindows(policy.windows).isNotEmpty()) return false
        if (policy.bonusGrants.any { validateBonusGrant(it).isNotEmpty() }) return false
        if (policy.parentExceptions.any { validateParentException(it).isNotEmpty() }) return false
        return policy.dailyLimits.all { validateDailyAppLimit(it).isEmpty() }
    }

    private fun hasValidEpochs(policy: SchedulePolicyV1): Boolean =
        EpochBounds.isValid(policy.trustSetEpoch) && EpochBounds.isValid(policy.keyEpoch)

    private fun isScopeInputValid(input: PolicyAcceptanceInput): Boolean {
        val familyId = input.expectedFamilyId
        val childProfileId = input.expectedChildProfileId
        return if (familyId == null && childProfileId == null) true
        else !familyId.isNullOrBlank() && !childProfileId.isNullOrBlank()
    }

    private fun matchesExpectedScope(policy: SchedulePolicyV1, input: PolicyAcceptanceInput): Boolean {
        val familyId = input.expectedFamilyId ?: return input.expectedChildProfileId == null
        val childProfileId = input.expectedChildProfileId ?: return false
        return policy.familyId == familyId && policy.childProfileId == childProfileId
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
