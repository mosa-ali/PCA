package org.pca.app.runtime.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class PersistentSchedulePolicyStoreDurabilityTest {
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
