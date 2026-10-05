package org.pca.app.firstdevice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.PersistentStateStore

/** Wave 6C: root-store durability + fail-safe decoding tests. */
class FirstDeviceRootStoreTest {

    private class RecordingStore : PersistentStateStore {
        val values = mutableMapOf<String, String>()
        var flushCount = 0
        var failNextFlush = false
        var failReads = false
        override fun getString(key: String): String? {
            if (failReads) throw IllegalStateException("injected read failure")
            return values[key]
        }
        override fun putString(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
        override fun contains(key: String): Boolean = values.containsKey(key)
        override fun clear() { values.clear() }
        override fun flush() {
            flushCount++
            if (failNextFlush) {
                failNextFlush = false
                throw IllegalStateException("injected durable commit failure")
            }
        }
    }

    private fun seed() = FirstDeviceCeremonySeed(
        attemptId = "a".repeat(32),
        attemptRecoveryToken = "r".repeat(43),
        serverBaseUrl = "https://example.test",
        deviceId = "device-1",
        signingKeyId = "55555555-5555-4555-8555-555555555555",
        encryptionKeyId = "66666666-6666-4666-8666-666666666666",
        dskPublicKeyBase64 = "dsk-pub",
        dekPublicKeyBase64 = "dek-pub",
        dskAlias = "pca.dsk." + "a".repeat(32),
        dekAlias = "pca.dek." + "a".repeat(32),
    )

    @Test
    fun `full record round-trips through the persistent store, including the submission payload`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val record = FirstDeviceRootRecord(
            seed = seed(),
            state = FirstDeviceRootState.SUBMITTING,
            ceremonyId = "ceremony-1",
            challengeId = "challenge-1",
            nonce = "n".repeat(43),
            expiresAt = "2026-10-02T01:00:00.000Z",
            familyId = "family-1",
            submission = FirstDeviceSubmissionPayload("proof", "psig", "epoch", "esig", "{\"v\":1}"),
        )
        store.save(record)
        assertEquals(record, store.current())
    }

    @Test
    fun `null ceremony fields round-trip as null and flush reaches the backing store`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        store.save(FirstDeviceRootRecord(seed = seed()))
        val loaded = store.current()!!
        assertEquals(FirstDeviceRootState.NOT_STARTED, loaded.state)
        assertNull(loaded.ceremonyId)
        assertNull(loaded.submission)
        assertNull(loaded.committedAtMillis)
        store.flush()
        assertEquals(1, backing.flushCount)
    }

    @Test
    fun `malformed, truncated, or legacy records decode to null -- never a fabricated state`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        store.save(FirstDeviceRootRecord(seed = seed()))
        val good = backing.values.values.single()
        backing.values["first_device_root_v1"] = good + "|extra"
        assertNull(store.current())
        backing.values["first_device_root_v1"] = good.substring(0, good.length / 2)
        assertNull(store.current())
        backing.values["first_device_root_v1"] = good.replace("NOT_STARTED", "NOT_A_REAL_STATE")
        assertNull(store.current())
        backing.values["first_device_root_v1"] = "|".repeat(21)
        assertNull(store.current())
    }

    @Test
    fun `clear removes exactly the ceremony key`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        backing.putString("unrelated_key", "keep-me")
        store.save(FirstDeviceRootRecord(seed = seed()))
        store.clear()
        assertNull(store.current())
        assertEquals("keep-me", backing.getString("unrelated_key"))
    }

    @Test
    fun `in-memory store is a faithful reference implementation`() {
        val store = InMemoryFirstDeviceRootStore()
        assertNull(store.current())
        val record = FirstDeviceRootRecord(seed = seed(), state = FirstDeviceRootState.APPROVED)
        store.save(record)
        assertEquals(record, store.current())
        store.flush()
        store.clear()
        assertNull(store.current())
    }

    @Test
    fun `separator safety - every encoded field is separator-free by construction`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        store.save(FirstDeviceRootRecord(seed = seed()))
        assertNotNull(store.current())
        assertTrue(!seed().attemptId.contains('|'))
    }

    @Test
    fun `same-attempt seed capture preserves the complete progressed record`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val progressed = FirstDeviceRootRecord(
            seed = seed(),
            state = FirstDeviceRootState.SUBMITTING,
            ceremonyId = "ceremony-1",
            challengeId = "challenge-1",
            nonce = "n".repeat(43),
            expiresAt = "2026-10-02T01:00:00.000Z",
            familyId = "family-1",
            submission = FirstDeviceSubmissionPayload("proof", "ps", "epoch", "es", "evidence"),
        )
        store.save(progressed)

        assertTrue(store.captureSeed(FirstDeviceRootRecord(seed = seed()), setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))

        assertEquals(progressed, store.current())
    }

    @Test
    fun `conditional root write rejects a stale coordinator snapshot`() {
        val store = PersistentFirstDeviceRootStore(RecordingStore())
        val original = FirstDeviceRootRecord(seed = seed(), state = FirstDeviceRootState.EXPIRED)
        val replacement = original.copy(seed = seed().copy(attemptId = "b".repeat(32)), state = FirstDeviceRootState.NOT_STARTED)
        assertTrue(store.writeIfCurrent(null, original))
        assertTrue(store.captureSeed(replacement, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))

        assertFalse(store.writeIfCurrent(original, original.copy(state = FirstDeviceRootState.AWAITING_APPROVAL)))
        assertEquals(replacement, store.current())
    }

    @Test
    fun `failed durable flush is surfaced by conditional root write`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        backing.failNextFlush = true

        assertFalse(store.writeIfCurrent(null, FirstDeviceRootRecord(seed = seed())))
        backing.failNextFlush = true
        assertFalse(store.confirmDurable(store.current()!!))
    }

    @Test
    fun `conditional write and seed capture fail closed on corrupt stored record`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        backing.values["first_device_root_v1"] = "not-a-root-record"
        val candidate = FirstDeviceRootRecord(seed = seed())

        assertNull(store.current())
        assertFalse(store.writeIfCurrent(null, candidate))
        assertFalse(store.captureSeed(candidate, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals("not-a-root-record", backing.values["first_device_root_v1"])
        assertEquals(FirstDeviceRootReadResult.Unreadable, store.readState())
    }

    @Test
    fun `conditional write and seed capture fail closed when backing read fails`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val candidate = FirstDeviceRootRecord(seed = seed())
        backing.failReads = true

        assertNull(store.current())
        assertFalse(store.writeIfCurrent(null, candidate))
        assertFalse(store.captureSeed(candidate, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertTrue(backing.values.isEmpty())
        assertEquals(FirstDeviceRootReadResult.Unreadable, store.readState())
    }

    @Test
    fun `same-attempt recapture re-confirms durability without losing progressed fields`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val progressed = FirstDeviceRootRecord(
            seed = seed(),
            state = FirstDeviceRootState.SUBMITTING,
            ceremonyId = "ceremony-1",
            submission = FirstDeviceSubmissionPayload("proof", "ps", "epoch", "es", "evidence"),
        )
        assertTrue(store.writeIfCurrent(null, progressed))
        val candidate = FirstDeviceRootRecord(seed = seed())

        backing.failNextFlush = true
        assertFalse(store.captureSeed(candidate, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals(progressed, store.current())

        assertTrue(store.captureSeed(candidate, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals(progressed, store.current())
    }

    @Test
    fun `competing capture confirms retained nonterminal record durability`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val live = FirstDeviceRootRecord(seed = seed(), state = FirstDeviceRootState.AWAITING_APPROVAL, ceremonyId = "live-ceremony")
        val competitor = FirstDeviceRootRecord(seed = seed().copy(attemptId = "b".repeat(32)))
        assertTrue(store.writeIfCurrent(null, live))

        backing.failNextFlush = true
        assertFalse(store.captureSeed(competitor, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals(live, store.current())

        assertTrue(store.captureSeed(competitor, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals(live, store.current())
    }
}
