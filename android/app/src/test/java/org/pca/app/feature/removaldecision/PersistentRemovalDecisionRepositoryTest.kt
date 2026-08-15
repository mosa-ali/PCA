package org.pca.app.feature.removaldecision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class PersistentRemovalDecisionRepositoryTest {
    @Test
    fun `load returns null before anything is saved`() {
        val repo = PersistentRemovalDecisionRepository(InMemoryPersistentStateStore())
        assertNull(repo.load())
    }

    @Test
    fun `save then load round-trips a KEEP_ACTIVE record`() {
        val repo = PersistentRemovalDecisionRepository(InMemoryPersistentStateStore())
        val record = RemovalDecisionRecord(RemovalDecisionState.KEEP_ACTIVE, 123_456L)
        repo.save(record)
        assertEquals(record, repo.load())
    }

    @Test
    fun `save then load round-trips a TEMPORARILY_DISABLE record including its deadline`() {
        val repo = PersistentRemovalDecisionRepository(InMemoryPersistentStateStore())
        val record = RemovalDecisionRecord(RemovalDecisionState.TEMPORARILY_DISABLE, 100L, temporarilyDisabledUntilEpochMillis = 200L)
        repo.save(record)
        assertEquals(record, repo.load())
    }

    @Test
    fun `a second save overwrites the first`() {
        val store = InMemoryPersistentStateStore()
        val repo = PersistentRemovalDecisionRepository(store)
        repo.save(RemovalDecisionRecord(RemovalDecisionState.KEEP_ACTIVE, 1L))
        repo.save(RemovalDecisionRecord(RemovalDecisionState.ALLOW_REMOVAL, 2L))
        assertEquals(RemovalDecisionState.ALLOW_REMOVAL, repo.load()?.state)
    }
}
