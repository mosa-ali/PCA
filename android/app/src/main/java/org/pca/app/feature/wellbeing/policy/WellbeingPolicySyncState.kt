package org.pca.app.feature.wellbeing.policy

/**
 * Offline policy state machine (item 5). Network unavailable is never interpreted as "disable
 * wellbeing": the latest locally-*accepted* (and previously promoted) policy stays [active] and
 * keeps applying, even if the device has been offline since acceptance. If a newer revision has
 * been received (accepted by [ParentPolicyRevisionGuard]) but not yet promoted into effect, it
 * sits in [pending] -- the old [active] policy keeps governing every dispatch until an explicit
 * [promote] call, never a partial/speculative blend of old and new.
 *
 * [promote] is the ONLY way [pending] becomes [active], and it never touches
 * [org.pca.app.feature.wellbeing.model.NudgeRateState] or synthesizes/replays any
 * [org.pca.app.feature.wellbeing.model.NudgeSelection] -- promoting a policy changes what is
 * eligible for *future* trigger dispatches only. This is what makes "no missed-nudge backlog on
 * reconnect" (item 13) structurally true rather than something that needs its own suppression
 * logic: there is simply no code path in this module that enumerates "nudges that would have
 * fired" and replays them.
 */
data class WellbeingPolicySyncState(
    val active: ActivePolicy?,
    val pending: PendingPolicy? = null,
) {
    companion object {
        val EMPTY = WellbeingPolicySyncState(active = null, pending = null)
    }

    /** Promotes [pending] to [active] if present; a no-op (returns `this` unchanged) if there is
     * nothing pending. Never inspects or mutates rate state, never enumerates missed triggers. */
    fun promote(): WellbeingPolicySyncState {
        val next = pending ?: return this
        return WellbeingPolicySyncState(active = ActivePolicy(next.policy, next.revision), pending = null)
    }
}

data class ActivePolicy(val policy: ParentWellbeingPolicyV1, val revision: Int)

data class PendingPolicy(
    val policy: ParentWellbeingPolicyV1,
    val revision: Int,
    val receivedAtMonotonicNanos: Long,
)
