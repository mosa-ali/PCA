package org.pca.app.feature.webprotection.vpn

import org.pca.app.feature.webprotection.policy.SafeSearchMode
import org.pca.app.foundation.PersistentStateStore
import java.util.Collections
import java.util.IdentityHashMap

class CorruptVpnSafeSearchPolicyException : IllegalStateException("SafeSearch policy storage is unreadable")

/**
 * Family-wide SafeSearch mode applied AT THE VPN DNS LAYER ONLY (doc 14 layers 1/2) -- distinct
 * from the per-navigation `SafeSearchDirective` [org.pca.app.feature.webprotection.safebrowser.SafeBrowserNavigationPolicy]
 * already accepts per call. There is no production caller anywhere in this codebase yet that
 * delivers a real parent-authored family policy of ANY kind without the separate
 * `PRODUCTION_CRYPTO_SUITE` human security review clearing (see e.g.
 * [org.pca.app.feature.webprotection.ingress.WebRulePolicyConsumer]'s own doc comment) -- following
 * that exact same honesty discipline, this store defaults to [SafeSearchMode.OFF] only when no mode
 * was ever saved, so [WebProtectionVpnService] never fabricates SafeSearch enforcement nobody
 * actually configured. A malformed value is an integrity error rather than an implicit OFF; the
 * DNS request path drops that request instead of claiming successful filtering. Updates flush and
 * read back before returning. This remains a thin single-value store over the same
 * [PersistentStateStore] port every other small state store in this lane uses (doc 35: never a
 * second storage mechanism).
 */
class VpnSafeSearchPolicyStore(private val store: PersistentStateStore, private val key: String = KEY) {
    private val coordinationLock = store.coordinationLock

    fun currentMode(): SafeSearchMode = synchronized(coordinationLock) {
        check(!isPersistenceUncertain()) { "SafeSearch policy durability is uncertain" }
        val raw = readRawOrAbsent() ?: return@synchronized SafeSearchMode.OFF
        raw.toModeOrNull() ?: throw CorruptVpnSafeSearchPolicyException()
    }

    fun setMode(mode: SafeSearchMode) {
        synchronized(coordinationLock) {
            check(!isPersistenceUncertain()) { "SafeSearch policy durability is uncertain" }
            val previous = readRawOrAbsent()
            if (previous != null && previous.toModeOrNull() == null) {
                throw CorruptVpnSafeSearchPolicyException()
            }
            try {
                store.putString(key, mode.name)
                store.flush()
                check(store.getString(key) == mode.name) { "SafeSearch policy readback failed" }
            } catch (failure: Exception) {
                try {
                    restore(previous)
                } catch (rollbackFailure: Exception) {
                    markPersistenceUncertain()
                    failure.addSuppressed(rollbackFailure)
                }
                throw failure
            }
        }
    }

    private fun restore(raw: String?) {
        if (raw == null) store.remove(key) else store.putString(key, raw)
        store.flush()
        check(store.getString(key) == raw) { "SafeSearch policy rollback readback failed" }
    }

    /** Null means a genuinely absent key; an unreadable present key is never implicit OFF. */
    private fun readRawOrAbsent(): String? {
        val raw = try {
            store.getString(key)
        } catch (_: Exception) {
            throw CorruptVpnSafeSearchPolicyException()
        }
        if (raw != null) return raw
        val present = try {
            store.contains(key)
        } catch (_: Exception) {
            throw CorruptVpnSafeSearchPolicyException()
        }
        if (present) throw CorruptVpnSafeSearchPolicyException()
        return null
    }

    private fun String.toModeOrNull(): SafeSearchMode? =
        runCatching { SafeSearchMode.valueOf(this) }.getOrNull()

    private fun isPersistenceUncertain(): Boolean = synchronized(uncertainLocks) {
        coordinationLock in uncertainLocks
    }

    private fun markPersistenceUncertain() {
        synchronized(uncertainLocks) { uncertainLocks.add(coordinationLock) }
    }

    private companion object {
        const val KEY = "webprotection_vpn_safesearch_mode_v1"
        val uncertainLocks: MutableSet<Any> = Collections.newSetFromMap(IdentityHashMap<Any, Boolean>())
    }
}
