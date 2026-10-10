package org.pca.app.feature.webprotection.engine

import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.feature.webprotection.policy.canonicalizeDomain
import org.pca.app.foundation.PersistentStateStore
import java.util.Collections
import java.util.IdentityHashMap

/**
 * On-device persistence port for parent-authored allow/deny entries and the
 * signed security-feed denylist -- mirrors
 * `backend/src/web/WebRuleStore.ts`'s `WebRuleRepository` contract exactly,
 * so [org.pca.app.feature.webprotection.engine.WebFilterEngine] can run the
 * identical lookup/precedence logic entirely offline (doc 14's "local
 * deterministic rules must continue to work with zero network dependency").
 * `familyId = null` selects the security feed; a family-scoped write must
 * never be able to touch it.
 */
interface WebRuleRepository {
    fun put(rule: WebRule)
    fun remove(familyId: OpaqueFamilyId?, domain: CanonicalDomain, listType: WebRuleListType)
    /** Every rule matching this domain, across the family's own rules AND the global security feed -- the full candidate set [org.pca.app.feature.webprotection.policy.resolveWebRuleSource] ranks. */
    fun findMatching(familyId: OpaqueFamilyId, domain: CanonicalDomain): List<WebRule>
}

/** Thread-safe in-memory reference implementation -- mirrors the backend's `InMemoryWebRuleRepository`, used as the process-lifetime working set beneath [PersistentWebRuleRepository]. */
class InMemoryWebRuleRepository : WebRuleRepository {
    private val rules = LinkedHashMap<String, WebRule>()
    private val lock = Any()

    private fun key(familyId: OpaqueFamilyId?, domain: CanonicalDomain, listType: WebRuleListType): String =
        "${familyId ?: "*"} $domain $listType"

    override fun put(rule: WebRule) {
        synchronized(lock) { rules[key(rule.familyId, rule.domain, rule.listType)] = rule }
    }

    override fun remove(familyId: OpaqueFamilyId?, domain: CanonicalDomain, listType: WebRuleListType) {
        synchronized(lock) { rules.remove(key(familyId, domain, listType)) }
    }

    override fun findMatching(familyId: OpaqueFamilyId, domain: CanonicalDomain): List<WebRule> =
        synchronized(lock) {
            rules.values.filter { it.domain == domain && (it.familyId == null || it.familyId == familyId) }
        }

    fun snapshot(): List<WebRule> = synchronized(lock) { rules.values.toList() }

    fun replaceAll(newRules: List<WebRule>) {
        synchronized(lock) {
            rules.clear()
            for (rule in newRules) rules[key(rule.familyId, rule.domain, rule.listType)] = rule
        }
    }
}

/**
 * doc 21's explicit tri-state so a caller can distinguish "genuinely no
 * policy has ever been accepted yet" from "storage read corruption -- last
 * known good rules are still active" from ordinary "a valid policy (possibly
 * intentionally empty) is active." Never collapsed to a boolean -- an empty
 * [PersistentWebRuleRepository.snapshot] means something different in each
 * of the three states, and [org.pca.app.feature.webprotection.identity]
 * callers must react to [CORRUPT_USING_LKG] (e.g. Safe Limited Mode, doc 14)
 * rather than silently treating it as an accepted empty policy.
 */
enum class WebRulePolicyState { VALID, CORRUPT_USING_LKG, NO_POLICY_YET }

/** Outcome of an attempted whole-scope rule replacement (doc 21). A rejection never mutates the store -- the existing last-known-good rules for that scope remain active untouched. */
sealed class WebRuleReplaceResult {
    data class Applied(val ruleCount: Int) : WebRuleReplaceResult()
    data class RejectedStaleRevision(val activeRevisionOrVersion: String) : WebRuleReplaceResult()
    object RejectedInvalidDomain : WebRuleReplaceResult()
    object RejectedSourceMismatch : WebRuleReplaceResult()
}

/**
 * Durable on-device rule store, backed by the same [PersistentStateStore]
 * port every other PCA-2 capability adapter uses (doc 35: "does not add a
 * second storage mechanism") -- follows
 * `feature/wellbeing/policy/ParentPolicyStateStore`'s convention of a thin
 * JSON-encoded store over that port rather than a new Room table, since a
 * domain-only allow/deny rule list is small, whole-replace-on-sync state,
 * not an append-only log (unlike [org.pca.app.persistence.repository.WebVisitRepository],
 * which records individual navigation decisions and DOES use Room).
 *
 * This is the real, persisted local rule set the on-device [WebFilterEngine]
 * evaluates against. It tracks TWO INDEPENDENT scopes with their own
 * last-known-good revision/version counters, deliberately never sharing one
 * counter (doc 23/27): [replaceParentRules] (family-authored allow/deny,
 * revision is a monotonic integer) and [replaceSecurityFeedRules] (the
 * global signed-package denylist, version is the package's dotted-triple
 * string) -- a stale/rejected delivery on one scope can never affect the
 * other scope's active rules, and a family-scoped write can never touch the
 * `familyId = null` security feed (doc 27).
 *
 * See [org.pca.app.feature.webprotection.ingress.WebRulePolicyConsumer] and
 * [org.pca.app.feature.webprotection.securityfeed.SignedRulePackageConsumer]
 * for the two callers that own actually deciding whether a delivered payload
 * is trustworthy before calling into either replace method here -- this
 * class only owns storage/LKG-durability semantics, never transport trust
 * decisions.
 */
class PersistentWebRuleRepository(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : WebRuleRepository {
    private val delegate = InMemoryWebRuleRepository()
    private val coordinationLock = store.coordinationLock
    private val pendingWriteKey = key + "_pending_write"
    private var stateValue: WebRulePolicyState = WebRulePolicyState.NO_POLICY_YET
    private var parentRulesRevisionValue: Long? = null
    private var securityFeedVersionValue: String? = null

    /** doc 21's tri-state for the whole store (both scopes combined) -- [WebRulePolicyState.CORRUPT_USING_LKG] whenever EITHER scope's stored envelope could not be decoded, since the two scopes share one physical [store] entry. */
    val state: WebRulePolicyState
        get() = synchronized(coordinationLock) {
            load()
            stateValue
        }

    /** Null until at least one family-authored delivery has ever been accepted -- distinct from revision `0`, which would be a legitimate first accepted revision. */
    val parentRulesRevision: Long?
        get() = synchronized(coordinationLock) { load(); parentRulesRevisionValue }

    /** Null until at least one signed security-feed package has ever been accepted. */
    val securityFeedVersion: String?
        get() = synchronized(coordinationLock) { load(); securityFeedVersionValue }

    init {
        synchronized(coordinationLock) { load() }
    }

    /** Ad-hoc single-rule write (used by direct callers/tests, e.g. an approved [org.pca.app.feature.webprotection.safebrowser.ParentUnblockRequestService] request writing back one allow rule) -- does not participate in the whole-scope revision/LKG gate below, and always marks the store [WebRulePolicyState.VALID] since it is, by construction, never a corrupt/unparsed payload. */
    override fun put(rule: WebRule) {
        require(validStoredRule(rule)) { "Invalid web rule semantics" }
        synchronized(coordinationLock) {
            refreshBeforeMutation()
            val rules = delegate.snapshot().filterNot {
                it.familyId == rule.familyId && it.domain == rule.domain && it.listType == rule.listType
            } + rule
            commit(rules, parentRulesRevisionValue, securityFeedVersionValue)
        }
    }

    override fun remove(familyId: OpaqueFamilyId?, domain: CanonicalDomain, listType: WebRuleListType) {
        synchronized(coordinationLock) {
            refreshBeforeMutation()
            val rules = delegate.snapshot().filterNot {
                it.familyId == familyId && it.domain == domain && it.listType == listType
            }
            commit(rules, parentRulesRevisionValue, securityFeedVersionValue)
        }
    }

    override fun findMatching(familyId: OpaqueFamilyId, domain: CanonicalDomain): List<WebRule> =
        synchronized(coordinationLock) {
            load()
            delegate.findMatching(familyId, domain)
        }

    fun snapshot(): List<WebRule> = synchronized(coordinationLock) {
        load()
        delegate.snapshot()
    }

    /**
     * doc 21/24: whole-scope replace of this device's own family-authored
     * PARENT_ALLOWLIST/PARENT_DENYLIST rules only -- the security feed
     * (`familyId = null`) is never touched here. [revision] must be strictly
     * greater than [parentRulesRevision] (or this is the first-ever accepted
     * delivery) -- an equal-or-lower revision is rejected as stale/rollback
     * WITHOUT mutating anything, so the previous LKG parent rules remain
     * active. A legitimately signed, explicitly empty [newRules] list IS
     * accepted (doc 22) -- "zero rules" and "rejected" are different things,
     * distinguished by the return type, never conflated.
     */
    fun replaceParentRules(familyId: OpaqueFamilyId, newRules: List<WebRule>, revision: Long): WebRuleReplaceResult {
        require(revision >= 0) { "Parent rule revision must be nonnegative" }
        if (familyId.isBlank()) return WebRuleReplaceResult.RejectedSourceMismatch
        val candidateRules = newRules.toList()
        for (rule in candidateRules) {
            if (rule.familyId != familyId) return WebRuleReplaceResult.RejectedSourceMismatch
            if (rule.source != WebRuleSource.PARENT_ALLOWLIST && rule.source != WebRuleSource.PARENT_DENYLIST) {
                return WebRuleReplaceResult.RejectedSourceMismatch
            }
            if ((rule.source == WebRuleSource.PARENT_ALLOWLIST && rule.listType != WebRuleListType.ALLOW) ||
                (rule.source == WebRuleSource.PARENT_DENYLIST && rule.listType != WebRuleListType.DENY)
            ) {
                return WebRuleReplaceResult.RejectedSourceMismatch
            }
            if (canonicalizeDomain(rule.domain) != rule.domain) return WebRuleReplaceResult.RejectedInvalidDomain
        }
        return synchronized(coordinationLock) {
            refreshBeforeMutation()
            val currentRevision = parentRulesRevisionValue
            if (currentRevision != null && revision <= currentRevision) {
                return@synchronized WebRuleReplaceResult.RejectedStaleRevision(currentRevision.toString())
            }

            val otherScopeRules = delegate.snapshot().filterNot { it.familyId == familyId }
            commit(otherScopeRules + candidateRules, revision, securityFeedVersionValue)
            WebRuleReplaceResult.Applied(candidateRules.size)
        }
    }

    /**
     * doc 21/28: whole-scope replace of the global `familyId = null`
     * SECURITY_DENYLIST feed only -- never touches any family's parent
     * rules. [packageVersion] must compare strictly greater than
     * [securityFeedVersion] (dotted-triple numeric compare, falling back to
     * lexicographic for non-numeric version strings, mirroring
     * `SignedRulePackageConsumer.ts`'s `comparePackageVersions`) or this is
     * the first-ever accepted package.
     */
    fun replaceSecurityFeedRules(newRules: List<WebRule>, packageVersion: String): WebRuleReplaceResult {
        require(packageVersion.isNotEmpty() && packageVersion.length <= 32) {
            "Security feed version must be nonempty and at most 32 characters"
        }
        val candidateRules = newRules.toList()
        for (rule in candidateRules) {
            if (rule.familyId != null) return WebRuleReplaceResult.RejectedSourceMismatch
            if (rule.source != WebRuleSource.SECURITY_DENYLIST || rule.listType != WebRuleListType.DENY) return WebRuleReplaceResult.RejectedSourceMismatch
            if (canonicalizeDomain(rule.domain) != rule.domain) return WebRuleReplaceResult.RejectedInvalidDomain
        }
        return synchronized(coordinationLock) {
            refreshBeforeMutation()
            val currentVersion = securityFeedVersionValue
            if (currentVersion != null && comparePackageVersions(packageVersion, currentVersion) <= 0) {
                return@synchronized WebRuleReplaceResult.RejectedStaleRevision(currentVersion)
            }

            val otherScopeRules = delegate.snapshot().filterNot { it.familyId == null }
            commit(otherScopeRules + candidateRules, parentRulesRevisionValue, packageVersion)
            WebRuleReplaceResult.Applied(candidateRules.size)
        }
    }

    /**
     * Persist a complete candidate snapshot before exposing it to readers.
     * [PersistentStateStore.putString] may be asynchronous, so flush and
     * readback are part of the commit boundary. Candidate-write failure restores
     * the prior bytes before marker removal. Once candidate durability is confirmed,
     * marker-removal failure keeps those verified bytes and poisons this process;
     * rollback is unsafe after the marker may already have been removed durably.
     */
    private fun commit(
        rules: List<WebRule>,
        parentRulesRevision: Long?,
        securityFeedVersion: String?,
    ) {
        check(!isPersistenceUncertain()) { "Web rule storage durability is uncertain" }
        val previous = store.getString(key)
        val encoded = serialize(rules, parentRulesRevision, securityFeedVersion)
        // The marker must be durable before candidate bytes can reach storage.
        // Any process restart with the marker present refuses reads and writes.
        try {
            store.putString(pendingWriteKey, "pending")
            store.flush()
            check(store.getString(pendingWriteKey) == "pending") { "Web rule marker readback failed" }
        } catch (failure: Exception) {
            // No candidate write has occurred. A confirmed marker removal is safe.
            try { clearPendingWriteMarker() } catch (cleanupFailure: Exception) {
                markPersistenceUncertain()
                stateValue = WebRulePolicyState.CORRUPT_USING_LKG
                failure.addSuppressed(cleanupFailure)
            }
            throw failure
        }
        try {
            store.putString(key, encoded)
            store.flush()
            check(store.getString(key) == encoded) { "Web rule snapshot readback failed" }
        } catch (failure: Exception) {
            try {
                restore(previous)
                clearPendingWriteMarker()
            } catch (rollbackFailure: Exception) {
                // Never clear the marker after an unconfirmed rollback.
                markPersistenceUncertain()
                stateValue = WebRulePolicyState.CORRUPT_USING_LKG
                failure.addSuppressed(rollbackFailure)
            }
            throw failure
        }
        try {
            clearPendingWriteMarker()
        } catch (failure: Exception) {
            // Candidate bytes are already durably verified. Do not roll them back
            // after marker removal may have reached disk: that could create an
            // unmarked uncertain snapshot. This process retains its prior LKG.
            markPersistenceUncertain()
            stateValue = WebRulePolicyState.CORRUPT_USING_LKG
            throw failure
        }

        delegate.replaceAll(rules)
        parentRulesRevisionValue = parentRulesRevision
        securityFeedVersionValue = securityFeedVersion
        stateValue = WebRulePolicyState.VALID
    }

    private fun serialize(
        rules: List<WebRule>,
        parentRulesRevision: Long?,
        securityFeedVersion: String?,
    ): String {
        val array = JSONArray()
        for (rule in rules) {
            array.put(
                JSONObject().apply {
                    put("domain", rule.domain)
                    put("listType", rule.listType.name)
                    put("source", rule.source.name)
                    put("familyId", rule.familyId)
                    put("createdAtEpochMillis", rule.createdAtEpochMillis)
                },
            )
        }
        val envelope = JSONObject().apply {
            put("rules", array)
            put("parentRulesRevision", parentRulesRevision)
            put("securityFeedVersion", securityFeedVersion)
        }
        return envelope.toString()
    }

    private fun clearPendingWriteMarker() {
        store.remove(pendingWriteKey)
        store.flush()
        check(store.getString(pendingWriteKey) == null) { "Web rule marker removal readback failed" }
    }

    private fun restore(raw: String?) {
        if (raw == null) store.remove(key) else store.putString(key, raw)
        store.flush()
        check(store.getString(key) == raw) { "Web rule rollback readback failed" }
    }

    /** Refresh under the shared store lock so two repository wrappers cannot overwrite each other's stale snapshots. */
    private fun refreshBeforeMutation() {
        check(!isPersistenceUncertain()) { "Web rule storage durability is uncertain" }
        load()
        check(stateValue != WebRulePolicyState.CORRUPT_USING_LKG) {
            "Web rule storage is corrupt; refusing mutation"
        }
    }

    /**
     * doc 20/21's hardening: unlike the prior implementation, a corrupt/
     * unparseable stored envelope NEVER silently becomes an empty-but-VALID
     * policy -- it is reported as [WebRulePolicyState.CORRUPT_USING_LKG] so
     * callers can honestly degrade (doc 14 Safe Limited Mode) instead of
     * treating "could not decode" as equivalent to "parent explicitly
     * accepted zero rules." A missing key (nothing ever written) is the
     * separate, unambiguous [WebRulePolicyState.NO_POLICY_YET] case.
     */
    private fun load() {
        if (isPersistenceUncertain()) {
            stateValue = WebRulePolicyState.CORRUPT_USING_LKG
            return
        }
        val raw = try {
            if (store.getString(pendingWriteKey) != null) {
                stateValue = WebRulePolicyState.CORRUPT_USING_LKG
                return
            }
            store.getString(key)
        } catch (_: Exception) {
            stateValue = WebRulePolicyState.CORRUPT_USING_LKG
            return
        }
        if (raw == null) {
            delegate.replaceAll(emptyList())
            parentRulesRevisionValue = null
            securityFeedVersionValue = null
            stateValue = WebRulePolicyState.NO_POLICY_YET
            return
        }
        try {
            val envelope = JSONObject(raw)
            val array = envelope.getJSONArray("rules")
            val loaded = (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                fun text(field: String): String = obj.get(field) as? String ?: error("Invalid rule field")
                WebRule(
                    domain = text("domain"),
                    listType = WebRuleListType.valueOf(text("listType")),
                    source = WebRuleSource.valueOf(text("source")),
                    familyId = if (obj.isNull("familyId")) null else text("familyId"),
                    createdAtEpochMillis = obj.getLong("createdAtEpochMillis"),
                )
            }
            require(loaded.all(::validStoredRule))
            val parentRulesRevision = when (val rawRevision = if (envelope.isNull("parentRulesRevision")) null else envelope.get("parentRulesRevision")) {
                null, JSONObject.NULL -> null
                is Number -> rawRevision.toLong().takeIf { rawRevision.toString() == it.toString() }
                    ?: error("Invalid parent revision value")
                else -> error("Invalid parent revision type")
            }
            require(parentRulesRevision == null || parentRulesRevision >= 0L)
            val securityFeedVersion = when (val rawVersion = if (envelope.isNull("securityFeedVersion")) null else envelope.get("securityFeedVersion")) {
                null, JSONObject.NULL -> null
                is String -> rawVersion.takeIf { it.isNotEmpty() && it.length <= 32 }
                    ?: error("Invalid security feed version")
                else -> error("Invalid security feed version type")
            }
            delegate.replaceAll(loaded)
            parentRulesRevisionValue = parentRulesRevision
            securityFeedVersionValue = securityFeedVersion
            stateValue = WebRulePolicyState.VALID
        } catch (_: Exception) {
            // Keep this repository's last-known-good memory and revision fields intact. On first
            // load that memory is empty, which remains explicitly distinguishable from VALID.
            // A later mutation refuses to replace a corrupt persisted envelope.
            stateValue = WebRulePolicyState.CORRUPT_USING_LKG
        }
    }

    private fun validStoredRule(rule: WebRule): Boolean {
        if (canonicalizeDomain(rule.domain) != rule.domain) return false
        return when (rule.source) {
            WebRuleSource.SECURITY_DENYLIST -> rule.familyId == null && rule.listType == WebRuleListType.DENY
            WebRuleSource.PARENT_ALLOWLIST -> !rule.familyId.isNullOrBlank() && rule.listType == WebRuleListType.ALLOW
            WebRuleSource.PARENT_DENYLIST -> !rule.familyId.isNullOrBlank() && rule.listType == WebRuleListType.DENY
            else -> false
        }
    }

    private fun isPersistenceUncertain(): Boolean = synchronized(uncertainStores) {
        uncertainStores.contains(coordinationLock)
    }

    private fun markPersistenceUncertain() {
        synchronized(uncertainStores) { uncertainStores.add(coordinationLock) }
    }

    private companion object {
        const val KEY = "webprotection_rules_v1"
        val uncertainStores: MutableSet<Any> = Collections.newSetFromMap(IdentityHashMap<Any, Boolean>())
    }
}

/** Numeric dotted-triple comparison, mirroring `SignedRulePackageConsumer.ts`'s `comparePackageVersions` exactly so Android and backend never disagree about which of two package versions is newer. Falls back to lexicographic only for non-dotted-triple version strings. */
fun comparePackageVersions(a: String, b: String): Int {
    // Backend versions accept JavaScript safe integers (up to 2^53 - 1),
    // which fit in Long but not Int. Keep Android's numeric ordering aligned.
    val aParts = a.split(".").mapNotNull { it.toLongOrNull() }
    val bParts = b.split(".").mapNotNull { it.toLongOrNull() }
    val aNumeric = aParts.size == 3 && a.split(".").size == 3
    val bNumeric = bParts.size == 3 && b.split(".").size == 3
    if (aNumeric && bNumeric) {
        for (i in 0 until 3) {
            val componentComparison = aParts[i].compareTo(bParts[i])
            if (componentComparison != 0) return componentComparison
        }
        return 0
    }
    return a.compareTo(b)
}
