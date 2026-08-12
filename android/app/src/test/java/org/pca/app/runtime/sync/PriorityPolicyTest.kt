package org.pca.app.runtime.sync

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.runtime.sync.priority.Prioritizable
import org.pca.app.runtime.sync.priority.priorityTierForMessageType
import org.pca.app.runtime.sync.priority.sortByPriority

private data class Item(override val messageType: String, override val enqueuedAtEpochMillis: Long) : Prioritizable

class PriorityPolicyTest {
    @Test
    fun `trust-security sorts before policy, decision, receipt, critical-state, and activity-summary`() {
        val items = listOf(
            Item("ACTIVITY_SUMMARY", 1),
            Item("POLICY_UPDATE", 2),
            Item("KEY_ROTATION", 3),
            Item("CHILD_REQUEST", 4),
            Item("POLICY_RECEIPT", 5),
            Item("STATUS_SNAPSHOT", 6),
        )
        val sorted = sortByPriority(items).map { it.messageType }
        assertEquals(listOf("KEY_ROTATION", "POLICY_UPDATE", "CHILD_REQUEST", "POLICY_RECEIPT", "STATUS_SNAPSHOT", "ACTIVITY_SUMMARY"), sorted)
    }

    @Test
    fun `ties within a tier break by enqueue order, earliest first`() {
        val items = listOf(Item("ACTIVITY_SUMMARY", 200), Item("ACTIVITY_SUMMARY", 100))
        assertEquals(listOf(100L, 200L), sortByPriority(items).map { it.enqueuedAtEpochMillis })
    }

    @Test
    fun `an unrecognised message type defaults to the lowest tier`() {
        assertEquals(org.pca.app.runtime.sync.priority.PriorityTier.ACTIVITY_SUMMARY, priorityTierForMessageType("SOME_UNKNOWN_TYPE"))
    }
}
