package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import java.time.Instant

class PersistentSchedulePolicyStoreDurabilityTest {
    private fun policy(revision: Int, policyId: String = "policy-1", timezone: String = "UTC") = SchedulePolicyV1(
        policyId = policyId,
        policyRevision = revision,
        familyId = "family-1",
        childProfileId = "child-1",
        timezone = timezone,
        windows = emptyList(),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = Instant.parse("2026-10-05T00:00:00Z"),
        effectiveFrom = Instant.parse("2026-10-05T00:00:00Z"),
    )

    private fun policySnapshot(
        policy: SchedulePolicyV1,
        syncAt: Instant = Instant.parse("2026-10-05T01:00:00Z"),
    ) = SchedulePolicySnapshot(
        candidatePolicy = policy,
        lastKnownGoodPolicy = policy,
        lastPolicySyncAtUtc = syncAt,
        deviceTrustSetEpoch = policy.trustSetEpoch,
        deviceKeyEpoch = policy.keyEpoch,
    )

    private fun snapshot(epoch: Int) = SchedulePolicySnapshot(
        candidatePolicy = null,
        lastKnownGoodPolicy = null,
        lastPolicySyncAtUtc = null,
        deviceTrustSetEpoch = epoch,
        deviceKeyEpoch = 1,
    )

    @Test
    fun `save flushes snapshot and restart loads only the committed slot`() {
        val disk = DiskBackedPersistentStateStore()
        val accepted = snapshot(epoch = 3)

        PersistentSchedulePolicyStore(disk).save(accepted)

        val restarted = PersistentSchedulePolicyStore(disk.afterProcessDeath())
        assertEquals(SchedulePolicyStoreRead.Present(accepted), restarted.read())
    }

    @Test
    fun `higher policy revision is durably accepted and survives restart`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(policySnapshot(policy(revision = 4)))
        val accepted = policySnapshot(
            policy(revision = 5, timezone = "Asia/Riyadh"),
            syncAt = Instant.parse("2026-10-05T02:00:00Z"),
        )

        store.save(accepted)

        assertEquals(SchedulePolicyStoreRead.Present(accepted), store.read())
        assertEquals(SchedulePolicyStoreRead.Present(accepted), PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `exact same revision replay is idempotent and does not advance durable generation`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        val accepted = policySnapshot(policy(revision = 4))
        store.save(accepted)
        val pointerBeforeReplay = disk.durableSnapshot()["schedule_policy_snapshot_v1.active_generation"]

        store.save(accepted.copy())

        assertEquals(pointerBeforeReplay, disk.durableSnapshot()["schedule_policy_snapshot_v1.active_generation"])
        assertEquals(SchedulePolicyStoreRead.Present(accepted), store.read())
        assertEquals(SchedulePolicyStoreRead.Present(accepted), PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `literal retry remains idempotent when only the last known good policy is present`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        val accepted = SchedulePolicySnapshot(
            candidatePolicy = null,
            lastKnownGoodPolicy = policy(revision = 4),
            lastPolicySyncAtUtc = Instant.parse("2026-10-05T01:00:00Z"),
            deviceTrustSetEpoch = 1,
            deviceKeyEpoch = 1,
        )
        store.save(accepted)
        val pointerBeforeReplay = disk.durableSnapshot()["schedule_policy_snapshot_v1.active_generation"]

        store.save(accepted)

        assertEquals(pointerBeforeReplay, disk.durableSnapshot()["schedule_policy_snapshot_v1.active_generation"])
        assertEquals(SchedulePolicyStoreRead.Present(accepted), PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `same revision cannot refresh sync time or replace persisted policy bytes or identity`() {
        val original = policySnapshot(policy(revision = 4))
        val attempts = listOf(
            original.copy(lastPolicySyncAtUtc = Instant.parse("2026-10-05T02:00:00Z")),
            policySnapshot(policy(revision = 4, timezone = "Asia/Riyadh")),
            policySnapshot(policy(revision = 4, policyId = "policy-2")),
        )

        attempts.forEach { attempted ->
            val disk = DiskBackedPersistentStateStore()
            val store = PersistentSchedulePolicyStore(disk)
            store.save(original)
            val pointerBeforeAttempt = disk.durableSnapshot()["schedule_policy_snapshot_v1.active_generation"]

            assertSaveFails { store.save(attempted) }

            assertEquals(SchedulePolicyStoreRead.Present(original), store.read())
            assertEquals(SchedulePolicyStoreRead.Present(original), PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
            assertEquals(pointerBeforeAttempt, disk.durableSnapshot()["schedule_policy_snapshot_v1.active_generation"])
        }
    }

    @Test
    fun `lower policy revision and device floors are rejected without replacing persisted state`() {
        val original = policySnapshot(policy(revision = 4))
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(original)

        assertSaveFails {
            store.save(policySnapshot(policy(revision = 3, timezone = "Asia/Riyadh")))
        }
        assertSaveFails {
            store.save(original.copy(deviceTrustSetEpoch = 0))
        }
        assertSaveFails {
            store.save(original.copy(deviceKeyEpoch = 0))
        }

        assertEquals(SchedulePolicyStoreRead.Present(original), store.read())
        assertEquals(SchedulePolicyStoreRead.Present(original), PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `stable policy identity cannot be replaced even with a higher revision`() {
        val original = policySnapshot(policy(revision = 4))
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(original)

        assertSaveFails {
            store.save(policySnapshot(policy(revision = 5, policyId = "policy-2")))
        }

        assertEquals(SchedulePolicyStoreRead.Present(original), store.read())
        assertEquals(SchedulePolicyStoreRead.Present(original), PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `corrupt active policy bytes cannot be overwritten by a later save`() {
        val accepted = policySnapshot(policy(revision = 4))
        val originalDisk = DiskBackedPersistentStateStore().also { PersistentSchedulePolicyStore(it).save(accepted) }
        val damagedState = originalDisk.durableSnapshot().toMutableMap().apply {
            put("schedule_policy_snapshot_v1.slot.0.snapshot", "{}")
        }
        val damagedDisk = DiskBackedPersistentStateStore(damagedState)
        val damagedStore = PersistentSchedulePolicyStore(damagedDisk)

        assertSame(SchedulePolicyStoreRead.Corrupt, damagedStore.read())
        assertSaveFails { damagedStore.save(policySnapshot(policy(revision = 5))) }

        assertEquals("{}", damagedDisk.durableSnapshot()["schedule_policy_snapshot_v1.slot.0.snapshot"])
        assertSame(SchedulePolicyStoreRead.Corrupt, damagedStore.read())
        assertSame(SchedulePolicyStoreRead.Corrupt, PersistentSchedulePolicyStore(damagedDisk.afterProcessDeath()).read())
    }

    @Test
    fun `failed staging flush leaves prior active snapshot intact across restart`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(snapshot(epoch = 1))
        disk.failFlushNumbers = setOf(disk.flushCount + 1)

        assertSaveFails { store.save(snapshot(epoch = 2)) }

        val expected = SchedulePolicyStoreRead.Present(snapshot(epoch = 1))
        assertEquals(expected, store.read())
        assertEquals(expected, PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `failed active pointer flush restores previous state and reports the write failure`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(snapshot(epoch = 1))
        disk.failFlushNumbers = setOf(disk.flushCount + 3)

        assertSaveFails { store.save(snapshot(epoch = 2)) }

        val expected = SchedulePolicyStoreRead.Present(snapshot(epoch = 1))
        assertEquals(expected, store.read())
        assertEquals(expected, PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `failed format marker flush restores the legacy state`() {
        val disk = DiskBackedPersistentStateStore(
            mapOf(
                "schedule_policy_snapshot_v1" to SchedulePolicyJson
                    .encodeSnapshot(snapshot(epoch = 1)).toString(),
            ),
        )
        val store = PersistentSchedulePolicyStore(disk)
        disk.failFlushNumbers = setOf(disk.flushCount + 2)

        assertSaveFails { store.save(snapshot(epoch = 2)) }

        val expected = SchedulePolicyStoreRead.Present(snapshot(epoch = 1))
        assertEquals(expected, store.read())
        assertEquals(expected, PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
        assertEquals(false, disk.durableSnapshot().containsKey("schedule_policy_snapshot_v1.slot.0.snapshot"))
        assertEquals(false, disk.durableSnapshot().containsKey("schedule_policy_snapshot_v1.slot.0.generation"))
    }

    @Test
    fun `active pointer readback mismatch restores the previous committed slot`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(snapshot(epoch = 1))
        disk.corruptReadAfterSuccessfulReadsForKey =
            "schedule_policy_snapshot_v1.active_generation" to 2

        assertSaveFails { store.save(snapshot(epoch = 2)) }

        val expected = SchedulePolicyStoreRead.Present(snapshot(epoch = 1))
        assertEquals(expected, store.read())
        assertEquals(expected, PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `staged snapshot readback mismatch never changes active state`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(snapshot(epoch = 1))
        disk.corruptNextReadForKey = "schedule_policy_snapshot_v1.slot.1.snapshot"

        assertSaveFails { store.save(snapshot(epoch = 2)) }

        val expected = SchedulePolicyStoreRead.Present(snapshot(epoch = 1))
        assertEquals(expected, store.read())
        assertEquals(expected, PersistentSchedulePolicyStore(disk.afterProcessDeath()).read())
    }

    @Test
    fun `failed pointer rollback fails closed in memory while restart retains durable state`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(snapshot(epoch = 1))
        disk.failFlushNumbers = setOf(disk.flushCount + 3, disk.flushCount + 4)

        assertSaveFails { store.save(snapshot(epoch = 2)) }

        assertSame(SchedulePolicyStoreRead.Corrupt, store.read())
        assertEquals(
            SchedulePolicyStoreRead.Present(snapshot(epoch = 1)),
            PersistentSchedulePolicyStore(disk.afterProcessDeath()).read(),
        )
    }

    @Test
    fun `committed slot format with missing pointer does not fall back to the legacy snapshot`() {
        val disk = DiskBackedPersistentStateStore(
            mapOf(
                "schedule_policy_snapshot_v1" to SchedulePolicyJson
                    .encodeSnapshot(snapshot(epoch = 1)).toString(),
                "schedule_policy_snapshot_v1.format" to "slots-v1",
            ),
        )

        assertSame(SchedulePolicyStoreRead.Corrupt, PersistentSchedulePolicyStore(disk).read())
    }

    @Test
    fun `active pointer with missing format marker fails closed`() {
        val disk = DiskBackedPersistentStateStore()
        PersistentSchedulePolicyStore(disk).save(snapshot(epoch = 1))
        val damagedDisk = disk.durableSnapshot().toMutableMap().apply {
            remove("schedule_policy_snapshot_v1.format")
        }

        assertSame(
            SchedulePolicyStoreRead.Corrupt,
            PersistentSchedulePolicyStore(DiskBackedPersistentStateStore(damagedDisk)).read(),
        )
    }

    @Test
    fun `lost slot metadata with retained legacy and slot evidence fails closed`() {
        val disk = DiskBackedPersistentStateStore(
            mapOf(
                "schedule_policy_snapshot_v1" to SchedulePolicyJson
                    .encodeSnapshot(snapshot(epoch = 1)).toString(),
                "schedule_policy_snapshot_v1.slot.1.snapshot" to SchedulePolicyJson
                    .encodeSnapshot(snapshot(epoch = 2)).toString(),
                "schedule_policy_snapshot_v1.slot.1.generation" to "2",
            ),
        )

        assertSame(SchedulePolicyStoreRead.Corrupt, PersistentSchedulePolicyStore(disk).read())
    }

    @Test
    fun `corrupt active slot does not fall back to the older valid slot`() {
        val disk = DiskBackedPersistentStateStore()
        val store = PersistentSchedulePolicyStore(disk)
        store.save(snapshot(epoch = 1))
        store.save(snapshot(epoch = 2))
        val damagedDisk = disk.durableSnapshot().toMutableMap().apply {
            put("schedule_policy_snapshot_v1.slot.1.snapshot", "{}")
        }

        assertSame(
            SchedulePolicyStoreRead.Corrupt,
            PersistentSchedulePolicyStore(DiskBackedPersistentStateStore(damagedDisk)).read(),
        )
    }

    @Test
    fun `active generation mismatch and storage read exceptions are corrupt`() {
        val disk = DiskBackedPersistentStateStore()
        PersistentSchedulePolicyStore(disk).save(snapshot(epoch = 1))
        val mismatchedGeneration = disk.durableSnapshot().toMutableMap().apply {
            put("schedule_policy_snapshot_v1.slot.0.generation", "2")
        }
        assertSame(
            SchedulePolicyStoreRead.Corrupt,
            PersistentSchedulePolicyStore(DiskBackedPersistentStateStore(mismatchedGeneration)).read(),
        )

        disk.failNextReadForKey = "schedule_policy_snapshot_v1.active_generation"
        assertSame(SchedulePolicyStoreRead.Corrupt, PersistentSchedulePolicyStore(disk).read())
    }

    private fun assertSaveFails(block: () -> Unit) {
        try {
            block()
        } catch (_: IllegalStateException) {
            return
        }
        throw AssertionError("Expected schedule snapshot save to fail")
    }
}
