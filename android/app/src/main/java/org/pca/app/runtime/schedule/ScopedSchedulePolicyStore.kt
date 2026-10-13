package org.pca.app.runtime.schedule

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import org.pca.app.foundation.PersistentStateStore

/** Local storage identity for one accepted policy namespace. */
data class SchedulePolicyStorageScope(
    val familyId: String,
    val childProfileId: String,
    val recipientDeviceId: String?,
)

/**
 * Namespaces durable schedule snapshots by the currently enrolled local family/profile/device.
 * The underlying [PersistentSchedulePolicyStore] then keeps its revision stream monotonic within
 * that one recipient scope, without an old family's policy blocking a newly enrolled family.
 *
 * Legacy global state is copied into a scoped namespace only when the policy itself proves the
 * same family/profile and the current scope has no device component that the legacy bytes could
 * not have bound. The legacy bytes are retained after migration for recovery and diagnosis.
 */
class ScopedSchedulePolicyStore(
    private val store: PersistentStateStore,
    private val currentScopeProvider: () -> SchedulePolicyStorageScope?,
    private val scopeKeyPrefix: String = SCOPED_KEY_PREFIX,
    private val legacyKey: String = LEGACY_KEY,
) : SchedulePolicyStore {
    private data class ScopeIdentity(
        val familyId: String,
        val childProfileId: String,
        val recipientDeviceId: String?,
    )

    private val scopedStores = mutableMapOf<ScopeIdentity, PersistentSchedulePolicyStore>()
    private val legacyStore = PersistentSchedulePolicyStore(store, legacyKey)
    private val lock = store.coordinationLock
    private val lastReadScopeKey = ThreadLocal<String?>()

    /**
     * Runtime validation follows [read] synchronously. Confirm both observed the same full local
     * identity, including recipient device, so a device transition between those steps cannot
     * validate one device's snapshot against another device's family/profile/epoch tuple.
     */
    internal fun lastReadMatchesScope(scope: SchedulePolicyStorageScope): Boolean =
        isValidScope(scope) && lastReadScopeKey.get() == scopedStorageKey(identityOf(scope))

    override fun save(snapshot: SchedulePolicySnapshot) {
        val scope = requireCurrentScope()
        requireSnapshotMatchesScope(snapshot, scope)
        synchronized(lock) {
            val scoped = storeFor(scope)
            if (scoped.read() == SchedulePolicyStoreRead.Absent) {
                when (val legacy = legacyStore.read()) {
                    SchedulePolicyStoreRead.Absent -> Unit
                    SchedulePolicyStoreRead.Corrupt -> error("Cannot replace corrupt legacy schedule policy state")
                    is SchedulePolicyStoreRead.Present -> {
                        if (legacySnapshotMatchesScope(legacy.snapshot, scope)) {
                            scoped.save(legacy.snapshot)
                        }
                    }
                }
            }
            check(currentIdentityOrNull() == identityOf(scope)) {
                "Schedule policy scope changed during persistence"
            }
            scoped.save(snapshot)
        }
    }

    override fun load(): SchedulePolicySnapshot? = when (val result = read()) {
        SchedulePolicyStoreRead.Absent, SchedulePolicyStoreRead.Corrupt -> null
        is SchedulePolicyStoreRead.Present -> result.snapshot
    }

    override fun read(): SchedulePolicyStoreRead {
        val scope = try {
            currentScopeProvider()
        } catch (cancelled: CancellationException) {
            lastReadScopeKey.remove()
            throw cancelled
        } catch (_: Exception) {
            lastReadScopeKey.remove()
            return SchedulePolicyStoreRead.Corrupt
        } ?: run {
            lastReadScopeKey.remove()
            return SchedulePolicyStoreRead.Absent
        }
        if (!isValidScope(scope)) {
            lastReadScopeKey.remove()
            return SchedulePolicyStoreRead.Corrupt
        }
        val identity = identityOf(scope)
        lastReadScopeKey.set(scopedStorageKey(identity))

        return synchronized(lock) {
            val scoped = storeFor(identity)
            when (val current = scoped.read()) {
                SchedulePolicyStoreRead.Corrupt -> current
                is SchedulePolicyStoreRead.Present -> current
                SchedulePolicyStoreRead.Absent -> migrateLegacyIfExactlyScoped(scope, scoped)
            }
        }
    }

    private fun migrateLegacyIfExactlyScoped(
        scope: SchedulePolicyStorageScope,
        scoped: PersistentSchedulePolicyStore,
    ): SchedulePolicyStoreRead = when (val legacy = legacyStore.read()) {
        SchedulePolicyStoreRead.Absent -> SchedulePolicyStoreRead.Absent
        SchedulePolicyStoreRead.Corrupt -> SchedulePolicyStoreRead.Corrupt
        is SchedulePolicyStoreRead.Present -> {
            if (!legacySnapshotMatchesScope(legacy.snapshot, scope)) {
                SchedulePolicyStoreRead.Absent
            } else {
                try {
                    scoped.save(legacy.snapshot)
                    if (currentIdentityOrNull() != identityOf(scope)) SchedulePolicyStoreRead.Corrupt
                    else scoped.read()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    SchedulePolicyStoreRead.Corrupt
                }
            }
        }
    }

    private fun storeFor(scope: SchedulePolicyStorageScope): PersistentSchedulePolicyStore =
        storeFor(identityOf(scope))

    private fun storeFor(identity: ScopeIdentity): PersistentSchedulePolicyStore {
        return scopedStores.getOrPut(identity) {
            PersistentSchedulePolicyStore(store, scopedStorageKey(identity))
        }
    }

    private fun scopedStorageKey(identity: ScopeIdentity): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(SCOPE_HASH_DOMAIN)
        listOf(identity.familyId, identity.childProfileId, identity.recipientDeviceId).forEach { part ->
            if (part == null) {
                digest.update(ByteBuffer.allocate(Int.SIZE_BYTES).putInt(-1).array())
            } else {
                val bytes = part.toByteArray(Charsets.UTF_8)
                digest.update(ByteBuffer.allocate(Int.SIZE_BYTES).putInt(bytes.size).array())
                digest.update(bytes)
            }
        }
        val hex = buildString(SHA256_BYTES * 2) {
            digest.digest().forEach { byte ->
                val value = byte.toInt() and 0xff
                append(HEX[value ushr 4])
                append(HEX[value and 0x0f])
            }
        }
        return "$scopeKeyPrefix:$hex"
    }

    private fun currentIdentityOrNull(): ScopeIdentity? = try {
        currentScopeProvider()?.takeIf(::isValidScope)?.let(::identityOf)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        null
    }

    private fun requireCurrentScope(): SchedulePolicyStorageScope {
        val scope = currentScopeProvider()
            ?: error("Active schedule policy scope is unavailable")
        require(isValidScope(scope)) { "Active schedule policy scope is invalid" }
        return scope
    }

    private fun requireSnapshotMatchesScope(snapshot: SchedulePolicySnapshot, scope: SchedulePolicyStorageScope) {
        val policies = listOfNotNull(snapshot.candidatePolicy, snapshot.lastKnownGoodPolicy)
        require(policies.all { it.familyId == scope.familyId && it.childProfileId == scope.childProfileId }) {
            "Schedule snapshot does not match the active family/profile scope"
        }
    }

    private fun legacySnapshotMatchesScope(snapshot: SchedulePolicySnapshot, scope: SchedulePolicyStorageScope): Boolean {
        // Legacy policy bytes carry family/profile but no recipient-device binding. Do not silently
        // adopt those bytes into a device-scoped namespace where exact scope equality is unknown.
        if (scope.recipientDeviceId != null) return false
        val policies = listOfNotNull(snapshot.candidatePolicy, snapshot.lastKnownGoodPolicy)
        return policies.isNotEmpty() && policies.all {
            it.familyId == scope.familyId && it.childProfileId == scope.childProfileId
        }
    }

    private fun isValidScope(scope: SchedulePolicyStorageScope): Boolean =
        scope.familyId.isNotBlank() && scope.childProfileId.isNotBlank() &&
            (scope.recipientDeviceId == null || scope.recipientDeviceId.isNotBlank())

    private fun identityOf(scope: SchedulePolicyStorageScope) =
        ScopeIdentity(scope.familyId, scope.childProfileId, scope.recipientDeviceId)

    private companion object {
        const val SCOPED_KEY_PREFIX = "schedule_policy_scope_v1"
        const val LEGACY_KEY = "schedule_policy_snapshot_v1"
        const val SHA256_BYTES = 32
        const val HEX = "0123456789abcdef"
        val SCOPE_HASH_DOMAIN = "pca-schedule-policy-storage-scope-v1\u0000".toByteArray(Charsets.UTF_8)
    }
}
