package org.pca.app.runtime.schedule

import java.time.Instant

/**
 * Durable snapshot of everything [SchedulePolicyValidator] needs to reproduce the same
 * [ScheduleRuntimeState] decision after a process restart or full device reboot while offline --
 * the port Agent 12 (local persistence) must satisfy for mission section 12's "policy accepted ->
 * Internet lost -> process/device restart -> policy reloaded from local persistence -> same
 * schedule decision still produced."
 *
 * Every field here is exactly what [PolicyAcceptanceInput] needs except the point-in-time
 * `nowUtc`/`connectivity` inputs, which the caller supplies fresh at evaluation time -- this
 * snapshot itself carries no derived/cached *decision*, only the durable facts a decision is
 * computed from, so a stale cached decision can never be replayed after the facts that produced
 * it (e.g. the device epoch) have changed.
 */
data class SchedulePolicySnapshot(
    val candidatePolicy: SchedulePolicyV1?,
    val lastKnownGoodPolicy: SchedulePolicyV1?,
    val lastPolicySyncAtUtc: Instant?,
    val deviceTrustSetEpoch: Int,
    val deviceKeyEpoch: Int,
)

interface SchedulePolicyStore {
    fun save(snapshot: SchedulePolicySnapshot)

    /** Compatibility convenience; use [read] at any policy-enforcement boundary. */
    fun load(): SchedulePolicySnapshot?

    /** Distinguishes a first-run empty store from a present but unreadable snapshot. */
    fun read(): SchedulePolicyStoreRead = load()?.let { SchedulePolicyStoreRead.Present(it) }
        ?: SchedulePolicyStoreRead.Absent
}

/** Integrity-aware result for a persisted schedule snapshot. Corrupt bytes remain in storage. */
sealed interface SchedulePolicyStoreRead {
    data object Absent : SchedulePolicyStoreRead
    data object Corrupt : SchedulePolicyStoreRead
    data class Present(val snapshot: SchedulePolicySnapshot) : SchedulePolicyStoreRead
}

/** In-memory reference implementation, useful for tests and as a default before a durable
 * (e.g. encrypted-DataStore-backed, see the `persistence` package) implementation is wired in
 * by Agent 12. Deliberately does NOT persist across process death -- a real implementation must,
 * per mission section 12. */
class InMemorySchedulePolicyStore : SchedulePolicyStore {
    private var current: SchedulePolicySnapshot? = null

    override fun save(snapshot: SchedulePolicySnapshot) {
        current = snapshot
    }

    override fun load(): SchedulePolicySnapshot? = current
}
