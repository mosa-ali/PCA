package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class ParentPolicyStateStoreTest {

    private fun sampleMessage() = SdkCustomWellbeingMessage(
        messageId = "msg-1",
        enabled = true,
        category = SdkWellbeingCategory.FAMILY_HELP,
        languageTexts = mapOf(
            "en" to SdkLanguageText("Help set the table", "Ask if you can help before dinner."),
            "ar" to SdkLanguageText("ساعد في ترتيب الطاولة", "اسأل إن كان بإمكانك المساعدة قبل العشاء."),
        ),
        schedule = SdkScheduleWindow(daysOfWeek = setOf("SAT", "SUN"), timeWindows = listOf(SdkTimeWindow(1020, 1200))),
        delivery = SdkDeliveryPolicy(
            triggers = setOf(SdkWellbeingTrigger.BREAK_STARTED, SdkWellbeingTrigger.CHILD_REQUESTED_IDEA),
            minimumIntervalMinutes = 10,
            maximumPerDay = 4,
            repeatCooldownMinutes = 30,
            lockScreenAllowed = false,
            requiresAdultSupervision = false,
        ),
        target = SdkTargetScope(SdkTargetMode.ONE_CHILD, listOf("child-1")),
    )

    private fun samplePolicy() = ParentWellbeingPolicyV1(
        policyId = "family-1",
        policyRevision = 3,
        familyScopeRef = "scope-1",
        targets = SdkTargetScope(SdkTargetMode.ALL_CHILDREN),
        enabled = true,
        selectedCuratedSuggestionIds = listOf(SdkCuratedSuggestionSelection("well.reading.1", false)),
        customMessages = listOf(sampleMessage()),
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
    )

    @Test
    fun `snapshot round-trips through JSON exactly`() {
        val backing = InMemoryPersistentStateStore()
        val store = ParentPolicyStateStore(backing)

        val snapshot = ParentPolicyStateStore.Snapshot(
            syncState = WellbeingPolicySyncState(
                active = ActivePolicy(samplePolicy(), 3),
                pending = PendingPolicy(samplePolicy().copy(policyRevision = 4), 4, receivedAtMonotonicNanos = 555L),
            ),
            revisionGuard = RevisionGuardState(currentRevision = 3, appliedOperationIds = setOf("op-1", "op-2")),
        )
        store.save(snapshot)

        assertEquals(snapshot, store.load())
    }

    @Test
    fun `a fresh store instance over the same backing survives simulated process death`() {
        val backing = InMemoryPersistentStateStore()
        val writer = ParentPolicyStateStore(backing)
        val snapshot = ParentPolicyStateStore.Snapshot(
            syncState = WellbeingPolicySyncState(active = ActivePolicy(samplePolicy(), 3)),
            revisionGuard = RevisionGuardState(currentRevision = 3),
        )
        writer.save(snapshot)

        // A brand new store object over the same PersistentStateStore backing simulates the app
        // process dying and restarting -- nothing here is held only in memory.
        val reader = ParentPolicyStateStore(backing)
        assertEquals(3, reader.load().syncState.active?.revision)
        assertEquals(samplePolicy(), reader.load().syncState.active?.policy)
    }

    @Test
    fun `no data saved yet returns the empty snapshot, never an error`() {
        val store = ParentPolicyStateStore(InMemoryPersistentStateStore())
        assertEquals(ParentPolicyStateStore.Snapshot.EMPTY, store.load())
    }

    @Test
    fun `corrupt stored data degrades to empty snapshot rather than crashing`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("wellbeing_parent_policy_sync_v1", "{ not valid json at all")
        val store = ParentPolicyStateStore(backing)
        assertEquals(ParentPolicyStateStore.Snapshot.EMPTY, store.load())
    }

    @Test
    fun `clear removes the snapshot`() {
        val backing = InMemoryPersistentStateStore()
        val store = ParentPolicyStateStore(backing)
        store.save(ParentPolicyStateStore.Snapshot(WellbeingPolicySyncState(ActivePolicy(samplePolicy(), 3)), RevisionGuardState(3)))
        store.clear()
        assertEquals(ParentPolicyStateStore.Snapshot.EMPTY, store.load())
    }
}
