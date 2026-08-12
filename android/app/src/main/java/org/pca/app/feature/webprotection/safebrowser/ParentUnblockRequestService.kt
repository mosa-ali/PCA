package org.pca.app.feature.webprotection.safebrowser

import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.feature.webprotection.policy.CanonicalDomain
import org.pca.app.feature.webprotection.policy.OpaqueFamilyId
import org.pca.app.foundation.PersistentStateStore

enum class ParentUnblockRequestStatus { PENDING, APPROVED_TEMPORARY, APPROVED_PERMANENT, DENIED }

/**
 * doc 14: "the parent receives a minimally descriptive request and can allow
 * a site temporarily or permanently." Mirrors backend
 * `ParentUnblockRequest` -- always traces back to the specific
 * [BlockDecisionState] the child was shown, never a bare domain string.
 */
data class ParentUnblockRequest(
    val id: UnblockRequestId,
    val blockDecisionId: BlockDecisionId,
    val familyId: OpaqueFamilyId,
    val profileId: OpaqueProfileId,
    val domain: CanonicalDomain,
    val status: ParentUnblockRequestStatus,
    val requestedAtEpochMillis: Long,
    val decidedAtEpochMillis: Long?,
    val temporaryApprovalExpiresAtEpochMillis: Long?,
)

private val LEGAL_TRANSITIONS: Map<ParentUnblockRequestStatus, Set<ParentUnblockRequestStatus>> = mapOf(
    ParentUnblockRequestStatus.PENDING to setOf(
        ParentUnblockRequestStatus.APPROVED_TEMPORARY,
        ParentUnblockRequestStatus.APPROVED_PERMANENT,
        ParentUnblockRequestStatus.DENIED,
    ),
    ParentUnblockRequestStatus.APPROVED_TEMPORARY to emptySet(),
    ParentUnblockRequestStatus.APPROVED_PERMANENT to emptySet(),
    ParentUnblockRequestStatus.DENIED to emptySet(),
)

fun isLegalUnblockRequestTransition(from: ParentUnblockRequestStatus, to: ParentUnblockRequestStatus): Boolean =
    LEGAL_TRANSITIONS.getValue(from).contains(to)

sealed class UnblockRequestError(message: String) : Exception(message) {
    object DecisionNotRequestable : UnblockRequestError("This block decision is not eligible for a parent review request.")
    object RequestNotFound : UnblockRequestError("The unblock request does not exist.")
    object AlreadyPending : UnblockRequestError("A pending request already exists for this block decision.")
    object IllegalTransition : UnblockRequestError("This request has already been decided.")
    object InvalidDuration : UnblockRequestError("Temporary approval duration must be a positive number of milliseconds.")
}

/**
 * Local persistence port, JSON-encoded over the same [PersistentStateStore]
 * every other small state store in this codebase uses -- device-local per
 * doc 14/15's retention rules (never centralizes readable browsing history
 * server-side).
 */
interface ParentUnblockRequestRepository {
    fun put(request: ParentUnblockRequest)
    fun get(id: UnblockRequestId): ParentUnblockRequest?
    fun findPendingForDecision(blockDecisionId: BlockDecisionId): ParentUnblockRequest?
}

class PersistentParentUnblockRequestRepository(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : ParentUnblockRequestRepository {
    private val requests = mutableMapOf<UnblockRequestId, ParentUnblockRequest>()

    init { load() }

    override fun put(request: ParentUnblockRequest) {
        requests[request.id] = request
        persist()
    }

    override fun get(id: UnblockRequestId): ParentUnblockRequest? = requests[id]

    override fun findPendingForDecision(blockDecisionId: BlockDecisionId): ParentUnblockRequest? =
        requests.values.firstOrNull { it.blockDecisionId == blockDecisionId && it.status == ParentUnblockRequestStatus.PENDING }

    private fun persist() {
        val array = JSONArray()
        for (r in requests.values) {
            array.put(
                JSONObject().apply {
                    put("id", r.id)
                    put("blockDecisionId", r.blockDecisionId)
                    put("familyId", r.familyId)
                    put("profileId", r.profileId)
                    put("domain", r.domain)
                    put("status", r.status.name)
                    put("requestedAtEpochMillis", r.requestedAtEpochMillis)
                    put("decidedAtEpochMillis", r.decidedAtEpochMillis)
                    put("temporaryApprovalExpiresAtEpochMillis", r.temporaryApprovalExpiresAtEpochMillis)
                },
            )
        }
        store.putString(key, array.toString())
    }

    private fun load() {
        val raw = store.getString(key) ?: return
        try {
            val array = JSONArray(raw)
            for (i in 0 until array.length()) {
                val o = array.getJSONObject(i)
                val request = ParentUnblockRequest(
                    id = o.getString("id"),
                    blockDecisionId = o.getString("blockDecisionId"),
                    familyId = o.getString("familyId"),
                    profileId = o.getString("profileId"),
                    domain = o.getString("domain"),
                    status = ParentUnblockRequestStatus.valueOf(o.getString("status")),
                    requestedAtEpochMillis = o.getLong("requestedAtEpochMillis"),
                    decidedAtEpochMillis = if (o.isNull("decidedAtEpochMillis")) null else o.getLong("decidedAtEpochMillis"),
                    temporaryApprovalExpiresAtEpochMillis = if (o.isNull("temporaryApprovalExpiresAtEpochMillis")) null else o.getLong("temporaryApprovalExpiresAtEpochMillis"),
                )
                requests[request.id] = request
            }
        } catch (_: Exception) {
            requests.clear() // fail-safe decode: an empty request set, never a corrupted/half-applied one
        }
    }

    private companion object {
        const val KEY = "webprotection_unblock_requests_v1"
    }
}

/**
 * doc 14: child request -> parent decision -> allow temporarily/permanently
 * or deny. Mirrors backend `ParentUnblockRequestService` exactly. Never
 * re-evaluates or overrides [org.pca.app.feature.webprotection.engine.WebFilterEngine]
 * itself -- an APPROVED_* request is a signal a caller acts on (e.g. writing
 * a PARENT_ALLOWLIST rule via [org.pca.app.feature.webprotection.engine.WebRuleRepository]);
 * this class owns the request/decision workflow state only.
 */
class ParentUnblockRequestService(
    private val requests: ParentUnblockRequestRepository,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val idGenerator: () -> String = { UUID.randomUUID().toString() },
) {
    fun submit(blockDecision: BlockDecisionState): ParentUnblockRequest {
        if (!blockDecision.requestable) throw UnblockRequestError.DecisionNotRequestable
        if (requests.findPendingForDecision(blockDecision.id) != null) throw UnblockRequestError.AlreadyPending

        val request = ParentUnblockRequest(
            id = idGenerator(),
            blockDecisionId = blockDecision.id,
            familyId = blockDecision.familyId,
            profileId = blockDecision.profileId,
            domain = blockDecision.domain,
            status = ParentUnblockRequestStatus.PENDING,
            requestedAtEpochMillis = now(),
            decidedAtEpochMillis = null,
            temporaryApprovalExpiresAtEpochMillis = null,
        )
        requests.put(request)
        return request
    }

    private fun transition(
        requestId: UnblockRequestId,
        to: ParentUnblockRequestStatus,
        temporaryApprovalDurationMs: Long? = null,
    ): ParentUnblockRequest {
        val request = requests.get(requestId) ?: throw UnblockRequestError.RequestNotFound
        if (!isLegalUnblockRequestTransition(request.status, to)) throw UnblockRequestError.IllegalTransition

        var expiresAt: Long? = null
        if (to == ParentUnblockRequestStatus.APPROVED_TEMPORARY) {
            if (temporaryApprovalDurationMs == null || temporaryApprovalDurationMs <= 0) throw UnblockRequestError.InvalidDuration
            expiresAt = now() + temporaryApprovalDurationMs
        }

        val decided = request.copy(status = to, decidedAtEpochMillis = now(), temporaryApprovalExpiresAtEpochMillis = expiresAt)
        requests.put(decided)
        return decided
    }

    fun approveTemporary(requestId: UnblockRequestId, durationMs: Long): ParentUnblockRequest =
        transition(requestId, ParentUnblockRequestStatus.APPROVED_TEMPORARY, durationMs)

    fun approvePermanent(requestId: UnblockRequestId): ParentUnblockRequest =
        transition(requestId, ParentUnblockRequestStatus.APPROVED_PERMANENT)

    fun deny(requestId: UnblockRequestId): ParentUnblockRequest =
        transition(requestId, ParentUnblockRequestStatus.DENIED)
}
