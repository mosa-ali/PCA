package org.pca.app.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InMemoryRecoveryEnvelopeStoreTest {
    private fun sampleEnvelope() = RecoveryEnvelope(
        familyId = "family-1",
        envelopeId = "envelope-1",
        createdAtEpochMillis = 1_700_000_000_000L,
        trustSetEpoch = 1,
        keyEpoch = 1,
        ciphertextBase64 = "b3BhcXVlLWJ5dGVz",
    )

    @Test
    fun `current is null before anything is saved`() {
        val store = InMemoryRecoveryEnvelopeStore()
        assertNull(store.current())
    }

    @Test
    fun `save then current round-trips`() {
        val store = InMemoryRecoveryEnvelopeStore()
        store.save(sampleEnvelope())
        assertEquals(sampleEnvelope(), store.current())
    }

    @Test
    fun `save overwrites any previously saved envelope -- only the latest is retained`() {
        val store = InMemoryRecoveryEnvelopeStore()
        store.save(sampleEnvelope())
        val rotated = sampleEnvelope().copy(envelopeId = "envelope-2", keyEpoch = 2)
        store.save(rotated)
        assertEquals(rotated, store.current())
    }

    @Test
    fun `clear removes the saved envelope`() {
        val store = InMemoryRecoveryEnvelopeStore()
        store.save(sampleEnvelope())
        store.clear()
        assertNull(store.current())
    }
}
