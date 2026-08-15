package org.pca.app.feature.removaldecision

import org.pca.app.persistence.repository.TamperEventRepository

/**
 * Gap items 4/8 (PCA-FR-144/145): "platform-authority release on removal"
 * has no Device Owner mode to actually relinquish yet (correctly gated,
 * see [org.pca.app.platform.ProtectedModeProvisioningGate] --
 * PENDING_OWNER_DECISION), so there is no DevicePolicyManager call this
 * lane can make. What IS in scope and genuinely missing: an audit record
 * of the local decision that authorized removal in the first place. This
 * class writes that record via the existing, already-live
 * [TamperEventRepository] (PCA-FR-085) -- reused as-is, not modified --
 * rather than inventing a new table/DAO for a single audited event kind.
 * `tamper_events` is the right table for this: doc 10/11's retention
 * carve-out (12 months or the family activity window, whichever is
 * LONGER, never subject to the short-activity cutoff) is exactly the
 * retention posture an "authorization to remove protection from this
 * device" record needs, and [TamperEventRepository.record]'s upsert-by-id
 * contract means re-recording the same decision id is idempotent, not a
 * duplicate.
 */
class RemovalDecisionAuditRecorder(
    private val tamperEventRepository: TamperEventRepository,
) {
    companion object {
        const val CONDITION_TYPE_ALLOW_REMOVAL = "PROTECTION_REMOVAL_ALLOWED"
    }

    /**
     * Records that this device's local removal/disable decision subsystem
     * transitioned to [RemovalDecisionState.ALLOW_REMOVAL]. Callers must
     * only call this immediately after
     * [RemovalDecisionStateMachine.decideAllowRemoval] succeeds -- this
     * class does not itself validate the state transition, it only writes
     * the audit trail for one that already happened.
     */
    suspend fun recordAllowRemoval(deviceId: String, decidedAtEpochMillis: Long) {
        tamperEventRepository.record(
            id = "removal-decision-allow-$deviceId-$decidedAtEpochMillis",
            deviceId = deviceId,
            conditionType = CONDITION_TYPE_ALLOW_REMOVAL,
            detectedAtEpochMillis = decidedAtEpochMillis,
        )
    }
}
