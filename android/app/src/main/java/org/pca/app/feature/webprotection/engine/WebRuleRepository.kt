package org.pca.app.feature.webprotection.engine

import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.feature.webprotection.policy.WebRule
import org.pca.app.feature.webprotection.policy.WebRuleListType
import org.pca.app.feature.webprotection.policy.WebRuleSource
import org.pca.app.foundation.PersistentStateStore

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
 * evaluates against -- the runtime seam this lane owns; it does not itself
 * implement the parent-authored delivery/sync transport (that is the
 * existing [org.pca.app.persistence.repository.PolicySnapshotRepository] /
 * runtime-sync machinery elsewhere in this codebase). A Coordinator should
 * wire an eventual "web rules" policy-snapshot payload to call
 * [replaceAll]/[put] here rather than inventing a parallel policy authority
 * (see [org.pca.app.runtime.graph.PcaAppGraph] finding in the final report).
 */
class PersistentWebRuleRepository(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : WebRuleRepository {
    private val delegate = InMemoryWebRuleRepository()

    init {
        load()
    }

    override fun put(rule: WebRule) {
        delegate.put(rule)
        persist()
    }

    override fun remove(familyId: OpaqueFamilyId?, domain: CanonicalDomain, listType: WebRuleListType) {
        delegate.remove(familyId, domain, listType)
        persist()
    }

    override fun findMatching(familyId: OpaqueFamilyId, domain: CanonicalDomain): List<WebRule> =
        delegate.findMatching(familyId, domain)

    /** Whole-set replace for an accepted parent/security-feed rule delivery -- never a partial merge, so a removed parent rule cannot linger. */
    fun replaceAll(newRules: List<WebRule>) {
        delegate.replaceAll(newRules)
        persist()
    }

    fun snapshot(): List<WebRule> = delegate.snapshot()

    private fun persist() {
        val array = JSONArray()
        for (rule in delegate.snapshot()) {
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
        store.putString(key, array.toString())
    }

    /** Never throws on corrupt/unparseable stored data -- degrades to an empty rule set (same fail-safe-decode contract as every other store in this codebase), which is the SAFE direction: an empty rule set still falls through to the deterministic default-allow, it never fabricates a block OR silently widens access. */
    private fun load() {
        val raw = store.getString(key) ?: return
        val loaded = try {
            val array = JSONArray(raw)
            (0 until array.length()).map { i ->
                val obj = array.getJSONObject(i)
                WebRule(
                    domain = obj.getString("domain"),
                    listType = WebRuleListType.valueOf(obj.getString("listType")),
                    source = WebRuleSource.valueOf(obj.getString("source")),
                    familyId = if (obj.isNull("familyId")) null else obj.getString("familyId"),
                    createdAtEpochMillis = obj.getLong("createdAtEpochMillis"),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
        delegate.replaceAll(loaded)
    }

    private companion object {
        const val KEY = "webprotection_rules_v1"
    }
}
