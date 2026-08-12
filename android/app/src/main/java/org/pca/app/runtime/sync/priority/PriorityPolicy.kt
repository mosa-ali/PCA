package org.pca.app.runtime.sync.priority

/**
 * Ported from backend/src/runtime-sync/priority.ts -- same tiers and
 * FamilyEnvelope.messageType mapping (doc 40 Section 5), derived only from
 * an already-accepted wire field. No new authority: this governs which
 * items get the bounded reconnect batch's limited slots first, nothing
 * about whether they are ultimately accepted.
 */
enum class PriorityTier { TRUST_SECURITY, POLICY, DECISION, APPLICATION_RECEIPT, CRITICAL_STATE, ACTIVITY_SUMMARY }

private val TIER_RANK: Map<PriorityTier, Int> = PriorityTier.entries.withIndex().associate { (index, tier) -> tier to index }

private val MESSAGE_TYPE_TIER: Map<String, PriorityTier> = mapOf(
    "KEY_ROTATION" to PriorityTier.TRUST_SECURITY,
    "DEVICE_REVOKE" to PriorityTier.TRUST_SECURITY,
    "TAMPER_ALERT" to PriorityTier.TRUST_SECURITY,
    "FTS_UPDATE" to PriorityTier.TRUST_SECURITY,
    "RECOVERY_TRANSACTION" to PriorityTier.TRUST_SECURITY,
    "SIGNED_ROLLBACK" to PriorityTier.TRUST_SECURITY,
    "POLICY_UPDATE" to PriorityTier.POLICY,
    "RETENTION_DELETION_INSTRUCTION" to PriorityTier.POLICY,
    "CHILD_REQUEST" to PriorityTier.DECISION,
    "PARENT_DECISION" to PriorityTier.DECISION,
    "POLICY_RECEIPT" to PriorityTier.APPLICATION_RECEIPT,
    "RETENTION_RECEIPT" to PriorityTier.APPLICATION_RECEIPT,
    "LOCATION_RESPONSE" to PriorityTier.CRITICAL_STATE,
    "STATUS_SNAPSHOT" to PriorityTier.CRITICAL_STATE,
    "ACTIVITY_SUMMARY" to PriorityTier.ACTIVITY_SUMMARY,
)

private val DEFAULT_TIER = PriorityTier.ACTIVITY_SUMMARY

fun priorityTierForMessageType(messageType: String): PriorityTier = MESSAGE_TYPE_TIER[messageType] ?: DEFAULT_TIER

fun priorityRank(messageType: String): Int = TIER_RANK.getValue(priorityTierForMessageType(messageType))

interface Prioritizable {
    val messageType: String
    val enqueuedAtEpochMillis: Long
}

/** Stable sort: highest-priority tier first, ties broken by enqueue order (earliest first). */
fun <T : Prioritizable> sortByPriority(items: List<T>): List<T> =
    items.sortedWith(compareBy({ priorityRank(it.messageType) }, { it.enqueuedAtEpochMillis }))
