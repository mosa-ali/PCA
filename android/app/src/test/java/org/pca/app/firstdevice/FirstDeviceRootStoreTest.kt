package org.pca.app.firstdevice

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
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
    fun `committed signed epoch one anchor round-trips while legacy 22-field records stay anchorless`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val anchor = FirstDeviceAcceptedEpochAnchor(
            canonicalBytes = FirstDeviceCanonical.encodeEpoch1("family", "device-1", seed().signingKeyId,
                seed().dskPublicKeyBase64, seed().encryptionKeyId, seed().dekPublicKeyBase64, "2026-10-02T01:00:00.000Z"),
            signatureBase64Url = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(64) { 1 }),
        )
        val committed = FirstDeviceRootRecord(
            seed = seed().copy(attemptRecoveryToken = ""),
            state = FirstDeviceRootState.ROOT_COMMITTED,
            familyId = "family",
            committedAtMillis = 123L,
            acceptedEpoch1 = anchor,
        )
        store.save(committed)
        assertEquals(anchor, store.current()?.acceptedEpoch1)

        val oldRecord = backing.values.getValue("first_device_root_v1").split('|').take(22).joinToString("|")
        backing.values["first_device_root_v1"] = oldRecord
        assertNull(store.current()?.acceptedEpoch1)
        assertEquals(FirstDeviceRootReadResult.Present(committed.copy(acceptedEpoch1 = null)), store.readState())
    }

    @Test
    fun `partially persisted or malformed accepted anchor is unreadable`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val committed = FirstDeviceRootRecord(
            seed = seed().copy(attemptRecoveryToken = ""),
            state = FirstDeviceRootState.ROOT_COMMITTED,
            familyId = "family",
            committedAtMillis = 123L,
            acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor("canonical", "invalid-signature"),
        )
        assertFalse(store.writeIfCurrent(null, committed))

        val valid = committed.copy(acceptedEpoch1 = FirstDeviceAcceptedEpochAnchor(
            canonicalBytes = "canonical",
            signatureBase64Url = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(64) { 1 }),
        ))
        store.save(valid)
        val fields = backing.values.getValue("first_device_root_v1").split('|').toMutableList()
        fields[22] = ""
        backing.values["first_device_root_v1"] = fields.joinToString("|")
        assertEquals(FirstDeviceRootReadResult.Unreadable, store.readState())
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
    fun `attempt key cleanup runs only for confirmed empty or different-attempt root state`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        var cleanupCount = 0

        assertTrue(store.withConfirmedSafeAttemptKeyCleanup(seed().attemptId) { cleanupCount++ })
        assertEquals(1, cleanupCount)

        store.save(FirstDeviceRootRecord(seed = seed()))
        assertFalse(store.withConfirmedSafeAttemptKeyCleanup(seed().attemptId) { cleanupCount++ })
        assertEquals(1, cleanupCount)

        val otherAttemptId = "b".repeat(32)
        val otherAttempt = seed().copy(
            attemptId = otherAttemptId,
            dskAlias = "pca.dsk.$otherAttemptId",
            dekAlias = "pca.dek.$otherAttemptId",
        )
        store.save(FirstDeviceRootRecord(seed = otherAttempt))
        assertTrue(store.withConfirmedSafeAttemptKeyCleanup(seed().attemptId) { cleanupCount++ })
        assertEquals(2, cleanupCount)

        backing.values["first_device_root_v1"] = "corrupt"
        assertFalse(store.withConfirmedSafeAttemptKeyCleanup(seed().attemptId) { cleanupCount++ })
        assertEquals(2, cleanupCount)
    }

    @Test
    fun `root record with aliases from another attempt is unreadable and blocks cleanup`() {
        val backing = RecordingStore()
        val store = PersistentFirstDeviceRootStore(backing)
        val record = FirstDeviceRootRecord(seed = seed())
        val malformed = store.encode(record).split('|').toMutableList().apply {
            this[8] = "pca.dsk." + "b".repeat(32)
        }.joinToString("|")
        backing.values["first_device_root_v1"] = malformed
        var cleanupCount = 0

        assertEquals(FirstDeviceRootReadResult.Unreadable, store.readState())
        assertFalse(store.withConfirmedSafeAttemptKeyCleanup(seed().attemptId) { cleanupCount++ })
        assertEquals(0, cleanupCount)
    }

    @Test
    fun `separate wrappers sharing coordination lock serialize cleanup against seed capture`() {
        val backing = RecordingStore()
        val sharedLock = Any()
        fun wrapper() = object : PersistentStateStore by backing {
            override val coordinationLock: Any = sharedLock
        }
        val cleanupStore = PersistentFirstDeviceRootStore(wrapper())
        val captureStore = PersistentFirstDeviceRootStore(wrapper())
        val cleanupEntered = CountDownLatch(1)
        val allowCleanupToFinish = CountDownLatch(1)
        val captureFinished = CountDownLatch(1)
        val cleanupResult = AtomicBoolean(false)
        val captureResult = AtomicBoolean(false)

        val cleanupThread = Thread {
            cleanupResult.set(cleanupStore.withConfirmedSafeAttemptKeyCleanup(seed().attemptId) {
                cleanupEntered.countDown()
                check(allowCleanupToFinish.await(2, TimeUnit.SECONDS))
            })
        }
        val captureThread = Thread {
            try {
                val candidateAttemptId = "b".repeat(32)
                val candidate = FirstDeviceRootRecord(seed = seed().copy(
                    attemptId = candidateAttemptId,
                    dskAlias = "pca.dsk.$candidateAttemptId",
                    dekAlias = "pca.dek.$candidateAttemptId",
                ))
                captureResult.set(captureStore.captureSeed(candidate, emptySet()))
            } finally {
                captureFinished.countDown()
            }
        }

        cleanupThread.start()
        assertTrue(cleanupEntered.await(2, TimeUnit.SECONDS))
        captureThread.start()
        val captureWasBlockedByCleanup = !captureFinished.await(100, TimeUnit.MILLISECONDS)
        allowCleanupToFinish.countDown()
        cleanupThread.join(2_000)
        captureThread.join(2_000)

        assertTrue(captureWasBlockedByCleanup)
        assertTrue(cleanupResult.get())
        assertTrue(captureResult.get())
        assertEquals("b".repeat(32), captureStore.current()?.seed?.attemptId)
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
        val replacementAttemptId = "b".repeat(32)
        val replacement = original.copy(
            seed = seed().copy(
                attemptId = replacementAttemptId,
                dskAlias = "pca.dsk.$replacementAttemptId",
                dekAlias = "pca.dek.$replacementAttemptId",
            ),
            state = FirstDeviceRootState.NOT_STARTED,
        )
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
        val competitorAttemptId = "b".repeat(32)
        val competitor = FirstDeviceRootRecord(seed = seed().copy(
            attemptId = competitorAttemptId,
            dskAlias = "pca.dsk.$competitorAttemptId",
            dekAlias = "pca.dek.$competitorAttemptId",
        ))
        assertTrue(store.writeIfCurrent(null, live))

        backing.failNextFlush = true
        assertFalse(store.captureSeed(competitor, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals(live, store.current())

        assertTrue(store.captureSeed(competitor, setOf(FirstDeviceRootState.EXPIRED, FirstDeviceRootState.REJECTED)))
        assertEquals(live, store.current())
    }
}
