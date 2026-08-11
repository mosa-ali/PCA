package org.pca.app.feature.screentime.persistence

import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * Narrow persistence port for single-use parent-authorization replay protection
 * (`ParentAuthorization.auditId`). A parent-signed authorization is a bounded, one-time grant —
 * once it has been successfully applied, the same id must never authorize a second action, even
 * across a process restart or reboot, so this cannot be an in-memory-only guard.
 *
 * The single [claimAuthorization] operation is deliberately atomic ("check-and-set" as one
 * step), not a separate `isUsed` check followed by a separate `markUsed` write: a
 * check-then-write pair leaves a race window in which two concurrent callers can both observe
 * "not yet used" and both proceed, defeating single-use semantics. A durable implementation
 * (e.g. a SQL `INSERT ... ON CONFLICT DO NOTHING` / a keyed compare-and-swap in the coordinator's
 * eventual backing store) must preserve that same atomicity — first successful claimant wins,
 * every other claimant for the same id, concurrent or not, gets `false` forever after.
 *
 * The in-memory implementation below is a reference/default suitable for tests and for local
 * development before a durable backing store exists; the coordinator is expected to bind a
 * durable implementation (e.g. backed by the same local persistence used for
 * [ScreenTimeSnapshotStore], or a server-verified receipt) during integration.
 */
interface UsedAuthorizationStore {
    /**
     * Atomically attempts to claim [auditId] for one-time use.
     *
     * @return `true` if this call is the one that claimed it (the first successful claimant);
     * `false` if it was already claimed — by this call or any other, concurrent or prior. A
     * `false` result is permanent: [auditId] never becomes claimable again.
     */
    fun claimAuthorization(auditId: String): Boolean
}

/**
 * Backed by a [ConcurrentHashMap]-derived set, whose `add` is itself a single atomic
 * compare-and-set (`putIfAbsent` under the hood) — exactly the primitive [claimAuthorization]
 * needs, with no separate check-then-write race window.
 */
class InMemoryUsedAuthorizationStore : UsedAuthorizationStore {
    private val claimedAuditIds: MutableSet<String> = Collections.newSetFromMap(ConcurrentHashMap())

    override fun claimAuthorization(auditId: String): Boolean = claimedAuditIds.add(auditId)
}
