package org.pca.app.feature.removaldecision

/**
 * Gap items 4/7 (PCA-FR-084): the local, PIN-gated decision states a parent
 * (never the child, never the OS) applies to a pending request to
 * disable/remove protection on this device. This is the real, in-scope,
 * uninstall-independent mechanism the audit called for -- it gives
 * "protection cannot just be turned off" genuine teeth on THIS device
 * without requiring Device Owner/Device Admin enrollment (out of this
 * lane's scope, see [org.pca.app.platform.ProtectedModeProvisioningGate]).
 *
 * Deliberately a 4-way sealed-off enum, not a boolean "approved" flag, so
 * "temporarily disabled until a deadline" and "permanently allowed to be
 * removed" can never be collapsed into one undifferentiated state (same
 * reasoning [org.pca.app.platform.ManagedDeviceAuthority]'s doc comment
 * gives for its own 3-way enum).
 */
enum class RemovalDecisionState {
    /** A removal/disable request is pending a parent's PIN- or biometric-gated decision. The only state from which a decision (KEEP_ACTIVE/TEMPORARILY_DISABLE/ALLOW_REMOVAL) may be applied. */
    PARENT_APPROVAL_REQUIRED,

    /** The parent reviewed the request and decided protection stays fully active -- resolves the pending request without weakening protection at all. */
    KEEP_ACTIVE,

    /** The parent authorized a bounded, time-limited pause of protection (see [RemovalDecisionRecord.temporarilyDisabledUntilEpochMillis]). Reverts to [KEEP_ACTIVE] automatically once the window elapses -- it is never a silent, indefinite disable. */
    TEMPORARILY_DISABLE,

    /** The parent authorized this device to be removed from parental protection entirely. Terminal: once decided, a fresh removal cycle (if the app is ever reinstalled/re-enrolled) starts its own new state, not a transition out of this one. Every entry into this state is audited -- see [RemovalDecisionAuditRecorder]. */
    ALLOW_REMOVAL,
}

/**
 * Durable record of the current decision plus enough bookkeeping to make
 * transitions and expiry checks decidable without any other external
 * state. Wall-clock ([org.pca.app.foundation.WallClockTimeSource]) rather
 * than monotonic time, deliberately: these are real calendar deadlines a
 * parent may reasonably see displayed ("disabled until 6:00 PM today"),
 * not elapsed-duration math -- see [org.pca.app.foundation.WallClockTimeSource]'s
 * own doc comment for that distinction.
 */
data class RemovalDecisionRecord(
    val state: RemovalDecisionState,
    val decidedAtEpochMillis: Long,
    val temporarilyDisabledUntilEpochMillis: Long? = null,
) {
    init {
        require(
            (state == RemovalDecisionState.TEMPORARILY_DISABLE) == (temporarilyDisabledUntilEpochMillis != null),
        ) {
            "temporarilyDisabledUntilEpochMillis must be set if and only if state is TEMPORARILY_DISABLE"
        }
    }

    companion object {
        /** The state every device starts in before any removal/disable request has ever been made: protection fully active, nothing pending. */
        fun initial(nowEpochMillis: Long): RemovalDecisionRecord =
            RemovalDecisionRecord(state = RemovalDecisionState.KEEP_ACTIVE, decidedAtEpochMillis = nowEpochMillis)
    }
}
