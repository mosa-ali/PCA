package org.pca.app.feature.screentime.persistence

/**
 * Narrow persistence port for single-use parent-authorization replay protection
 * (`ParentAuthorization.auditId`). A parent-signed authorization is a bounded, one-time grant —
 * once it has been successfully applied, the same id must never authorize a second action, even
 * across a process restart or reboot, so this cannot be an in-memory-only guard.
 *
 * The in-memory implementation below is a reference/default suitable for tests and for local
 * development before a durable backing store exists; the coordinator is expected to bind a
 * durable implementation (e.g. backed by the same local persistence used for
 * [ScreenTimeSnapshotStore], or a server-verified receipt) during integration.
 */
interface UsedAuthorizationStore {
    fun isUsed(auditId: String): Boolean
    fun markUsed(auditId: String)
}

class InMemoryUsedAuthorizationStore : UsedAuthorizationStore {
    private val usedAuditIds = mutableSetOf<String>()

    override fun isUsed(auditId: String): Boolean = auditId in usedAuditIds

    override fun markUsed(auditId: String) {
        usedAuditIds += auditId
    }
}
