package org.pca.app.persistence

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.entity.DeviceKeyMetadataEntity
import org.pca.app.persistence.entity.DeviceKeyState
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.persistence.entity.ProximityBucket
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.entity.SyncOutboxState
import org.pca.app.persistence.repository.BreakSessionRepository
import org.pca.app.persistence.repository.LocationPointRepository
import org.pca.app.persistence.repository.PolicyReceiptRepository
import org.pca.app.persistence.repository.PrayerReminderEventRepository
import org.pca.app.persistence.repository.ProximityEventRepository
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.persistence.sync.EnqueueOutcome
import org.pca.app.persistence.sync.OutboxPriority
import org.pca.app.persistence.sync.OutboxQueueBounds
import org.pca.app.persistence.sync.ReceiptOutcome
import org.pca.app.persistence.sync.SyncOutboxRepository
import org.pca.app.persistence.sync.SyncReceiptRepository
import org.robolectric.RobolectricTestRunner

/**
 * PCA-RUNTIME-PERSIST-1 correction round Finding A: real file-backed
 * close/reopen durability proof (not [PersistenceTestSupport.inMemoryDb])
 * for every production repository added by this lane, plus the
 * pre-existing repositories/DAOs the correction brief flagged for review.
 * Each test opens one instance, writes, CLOSES it (simulating process
 * death -- no reference survives), opens a second, independent instance
 * against the same on-disk file, and reads. The DB file is deleted before
 * and after each test.
 *
 * [LocalRecordCipher] instances are created once per test and reused
 * across both simulated "app instances" -- in production this is Android
 * Keystore key material, which survives a process restart by construction
 * (PCA-RUNTIME-PERSIST-1 Section 0); a fresh [org.pca.app.persistence.crypto.InMemoryLocalRecordCipher]
 * per instance would not simulate that and would make every encrypted
 * round-trip fail for the wrong reason.
 */
@RunWith(RobolectricTestRunner::class)
class RepositoryFileBackedDurabilityTest {

    private suspend fun <T> withReopen(
        dbFileName: String,
        write: suspend (PcaLocalDatabase) -> Unit,
        read: suspend (PcaLocalDatabase) -> T,
    ): T {
        PersistenceTestSupport.context().deleteDatabase(dbFileName)
        val first = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            write(first)
        } finally {
            first.close()
        }
        val second = PersistenceTestSupport.fileBackedDb(dbFileName)
        return try {
            read(second)
        } finally {
            second.close()
            PersistenceTestSupport.context().deleteDatabase(dbFileName)
        }
    }

    // ---- Section 5: Usage ----

    @Test
    fun `usage session -- scope, time boundaries, and encrypted app token all survive a reopen, no duplicate row`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()

        val (rawTokenEnc, decrypted) = withReopen(
            "durability_usage.db",
            write = { db ->
                UsageSessionRepository(db.usageSessionDao(), cipher).record(
                    id = "session-1", deviceId = "device-1", appOrCategoryToken = "com.example.social",
                    startedAtEpochMillis = 5000L, endedAtEpochMillis = 5600L, durationMillis = 600L,
                    sourceConfidence = SourceConfidence.PLATFORM_API,
                )
            },
            read = { db ->
                val raw = db.usageSessionDao().getForDevice("device-1")
                val decoded = UsageSessionRepository(db.usageSessionDao(), cipher).getForDevice("device-1")
                raw.single().appOrCategoryTokenEnc to decoded.single()
            },
        )

        assertNotEquals("com.example.social", rawTokenEnc) // ciphertext persisted, not plaintext
        assertEquals("device-1", decrypted.deviceId)
        assertEquals("com.example.social", decrypted.appOrCategoryToken) // decrypts back after reopen
        assertEquals(5000L, decrypted.startedAtEpochMillis)
        assertEquals(5600L, decrypted.endedAtEpochMillis)
        assertEquals(600L, decrypted.durationMillis)
    }

    // ---- Section 6: Proximity ----

    @Test
    fun `proximity event -- coarse bucket survives a reopen, no image or numeric-distance field exists to lose`() = runTest {
        val result = withReopen(
            "durability_proximity.db",
            write = { db ->
                ProximityEventRepository(db.proximityEventDao())
                    .record("prox-1", "device-1", 7000L, ProximityBucket.NEAR, "notified")
            },
            read = { db -> ProximityEventRepository(db.proximityEventDao()).getForDevice("device-1").single() },
        )

        assertEquals(ProximityBucket.NEAR, result.distanceBucket)
        assertEquals("notified", result.action)
        assertEquals(7000L, result.timestampEpochMillis)
    }

    // ---- Section 7: Prayer ----

    @Test
    fun `prayer reminder event survives a reopen with the same delivery state`() = runTest {
        val result = withReopen(
            "durability_prayer.db",
            write = { db ->
                PrayerReminderEventRepository(db.prayerReminderEventDao())
                    .record("prayer-1", "device-1", "asr", 8000L, PrayerDeliveryState.DELIVERED)
            },
            read = { db -> PrayerReminderEventRepository(db.prayerReminderEventDao()).getForDevice("device-1").single() },
        )

        assertEquals("asr", result.prayerKey)
        assertEquals(PrayerDeliveryState.DELIVERED, result.deliveryState)
        assertEquals(8000L, result.scheduledAtEpochMillis)
    }

    // ---- Section 8: Break ----

    @Test
    fun `break session -- started then completed metadata survives a reopen as one row`() = runTest {
        val result = withReopen(
            "durability_break.db",
            write = { db ->
                val repo = BreakSessionRepository(db.breakSessionDao())
                repo.record("break-1", "device-1", "continuous_use", 3_600_000L, 9000L, null, null, null)
                repo.record("break-1", "device-1", "continuous_use", 3_600_000L, 9000L, 9500L, "completed", 2)
            },
            read = { db -> BreakSessionRepository(db.breakSessionDao()).getForDevice("device-1") },
        )

        assertEquals(1, result.size) // reopen must not resurrect or duplicate the pre-completion row
        val session = result.single()
        assertEquals(9500L, session.breakEndEpochMillis)
        assertEquals("completed", session.completionReason)
        assertEquals(2, session.optionalCounterTotal)
    }

    // ---- Section 9: Policy receipts ----

    @Test
    fun `policy receipt -- revision, epochs, and result metadata survive a reopen`() = runTest {
        val result = withReopen(
            "durability_policy_receipt.db",
            write = { db ->
                PolicyReceiptRepository(db.policyReceiptDao())
                    .record("receipt-1", "device-1", "policy-1", policyVersion = 3L, verifiedAtEpochMillis = 1000L, appliedAtEpochMillis = 1500L, signedByKeyId = "sk-1")
            },
            read = { db -> PolicyReceiptRepository(db.policyReceiptDao()).getForDeviceAndVersion("device-1", 3L) },
        )

        assertEquals("policy-1", result?.policyId)
        assertEquals(3L, result?.policyVersion)
        assertEquals(1000L, result?.verifiedAtEpochMillis)
        assertEquals(1500L, result?.appliedAtEpochMillis)
        assertEquals("sk-1", result?.signedByKeyId)
    }

    // ---- Section 10: Outbox (priority, coalesceKey, retry, expiry, sequence, state) ----

    @Test
    fun `outbox -- priority, coalesceKey, retry metadata, sequence, and expiry all survive a reopen`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()
        val dbFileName = "durability_outbox.db"
        PersistenceTestSupport.context().deleteDatabase(dbFileName)

        val first = PersistenceTestSupport.fileBackedDb(dbFileName)
        val outboxFirst = SyncOutboxRepository(first.syncOutboxDao(), cipher)
        val outcome = outboxFirst.enqueue(
            "msg-1", "family-1", "device-1", "e2ee-envelope-bytes", sequence = 7L,
            expiresAtEpochMillis = 999_999L, createdAtEpochMillis = 1000L,
            priority = OutboxPriority.SECURITY_TRUST, coalesceKey = "coalesce-key-1",
        )
        outboxFirst.markFailedForRetry("msg-1", nextRetryAtEpochMillis = 5000L)
        first.close()

        assertEquals(EnqueueOutcome.ENQUEUED, outcome)

        val second = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            val raw = second.syncOutboxDao().getById("msg-1")!!
            assertEquals(OutboxPriority.SECURITY_TRUST.rank, raw.priority)
            assertEquals("coalesce-key-1", raw.coalesceKey)
            assertEquals(1, raw.retryCount)
            assertEquals(5000L, raw.nextRetryAtEpochMillis)
            assertEquals(7L, raw.sequence)
            assertEquals(999_999L, raw.expiresAtEpochMillis)
            assertEquals(SyncOutboxState.PENDING, raw.state)

            val outboxSecond = SyncOutboxRepository(second.syncOutboxDao(), cipher)
            val ready = outboxSecond.getReadyForDelivery(nowEpochMillis = 5000L)
            assertEquals("e2ee-envelope-bytes", ready.single().second) // ciphertext decrypts after reopen
        } finally {
            second.close()
            PersistenceTestSupport.context().deleteDatabase(dbFileName)
        }
    }

    // ---- Section 11: queue pressure durability -- eviction must not be undone by a reopen ----

    @Test
    fun `outbox -- an evicted message stays evicted after a reopen, no resurrection`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()
        val dbFileName = "durability_outbox_eviction.db"
        PersistenceTestSupport.context().deleteDatabase(dbFileName)

        val first = PersistenceTestSupport.fileBackedDb(dbFileName)
        val bounded = SyncOutboxRepository(
            first.syncOutboxDao(), cipher,
            OutboxQueueBounds(maxTotalRecords = 1, maxTotalBytes = Long.MAX_VALUE, maxPerFamily = 1),
        )
        bounded.enqueue("msg-low", "family-1", "device-1", "e1", 1L, 999_999L, 1000L, priority = OutboxPriority.ACTIVITY_SUMMARY)
        bounded.enqueue("msg-high", "family-1", "device-1", "e2", 2L, 999_999L, 1000L, priority = OutboxPriority.SECURITY_TRUST) // evicts msg-low
        first.close()

        val second = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            assertNull("evicted message must not reappear after reopen", second.syncOutboxDao().getById("msg-low"))
            assertTrue(second.syncOutboxDao().getById("msg-high") != null)
            assertEquals(1, second.syncOutboxDao().countByState(SyncOutboxState.PENDING))
        } finally {
            second.close()
            PersistenceTestSupport.context().deleteDatabase(dbFileName)
        }
    }

    @Test
    fun `outbox -- an expired-and-swept message stays gone after a reopen, no resurrection`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()
        val dbFileName = "durability_outbox_expiry.db"
        PersistenceTestSupport.context().deleteDatabase(dbFileName)

        val first = PersistenceTestSupport.fileBackedDb(dbFileName)
        val repo = SyncOutboxRepository(first.syncOutboxDao(), cipher)
        repo.enqueue("msg-expired", "family-1", "device-1", "e1", 1L, expiresAtEpochMillis = 500L, createdAtEpochMillis = 0L)
        repo.enqueue("msg-fresh", "family-1", "device-1", "e2", 2L, expiresAtEpochMillis = 999_999L, createdAtEpochMillis = 0L)
        repo.deleteExpired(nowEpochMillis = 1000L)
        first.close()

        val second = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            assertNull(second.syncOutboxDao().getById("msg-expired"))
            assertTrue(second.syncOutboxDao().getById("msg-fresh") != null)
        } finally {
            second.close()
            PersistenceTestSupport.context().deleteDatabase(dbFileName)
        }
    }

    // ---- Review item: LocationPointRepository (no prior file-backed test existed) ----

    @Test
    fun `location point latitude and longitude decrypt correctly after a reopen`() = runTest {
        val cipher = PersistenceTestSupport.testCipher()

        val (rawEnc, decrypted) = withReopen(
            "durability_location.db",
            write = { db ->
                LocationPointRepository(db.locationPointDao(), cipher).record(
                    deviceId = "device-1", timestampEpochMillis = 1000L, latitude = 24.7136, longitude = 46.6753,
                    accuracyMeters = 5f, source = "GPS", retentionPolicy = RetentionPolicy.ONE_MONTH, id = "point-1",
                )
            },
            read = { db ->
                val raw = db.locationPointDao().getForDevice("device-1").single()
                val decoded = LocationPointRepository(db.locationPointDao(), cipher).getForDevice("device-1").single()
                raw.latitudeEnc to decoded
            },
        )

        assertFalse(rawEnc.contains("24.7136")) // ciphertext persisted
        assertEquals(24.7136, decrypted.latitude, 0.0001)
        assertEquals(46.6753, decrypted.longitude, 0.0001)
    }

    // ---- Review item: SyncReceiptRepository ----

    @Test
    fun `sync receipt -- sequence, keyEpoch, and application state survive a reopen`() = runTest {
        val dbFileName = "durability_sync_receipt.db"
        PersistenceTestSupport.context().deleteDatabase(dbFileName)

        val first = PersistenceTestSupport.fileBackedDb(dbFileName)
        val outcome = SyncReceiptRepository(first.syncReceiptDao())
            .apply("receipt-1", "family-1", "device-2", sequence = 4L, keyEpoch = 2L, currentKeyEpoch = 2L, receivedAtEpochMillis = 1000L)
        first.close()

        assertEquals(ReceiptOutcome.APPLIED, outcome)

        val second = PersistenceTestSupport.fileBackedDb(dbFileName)
        try {
            val raw = second.syncReceiptDao().getById("receipt-1")!!
            assertEquals(4L, raw.sequence)
            assertEquals(2L, raw.keyEpoch)
            assertEquals(org.pca.app.persistence.entity.SyncReceiptApplicationState.APPLIED, raw.applicationState)

            // idempotency must hold across the reopen too: replaying the same receipt after restart is still a no-op.
            val replay = SyncReceiptRepository(second.syncReceiptDao())
                .apply("receipt-1", "family-1", "device-2", sequence = 4L, keyEpoch = 2L, currentKeyEpoch = 2L, receivedAtEpochMillis = 2000L)
            assertEquals(ReceiptOutcome.DUPLICATE_IGNORED, replay)
        } finally {
            second.close()
            PersistenceTestSupport.context().deleteDatabase(dbFileName)
        }
    }

    // ---- Review item: DeviceKeyMetadataDao (no repository wrapper exists -- tested at the DAO boundary it is accessed through) ----

    @Test
    fun `device key metadata survives a reopen, never holds a private key field`() = runTest {
        val result = withReopen(
            "durability_device_key.db",
            write = { db ->
                db.deviceKeyMetadataDao().upsert(
                    DeviceKeyMetadataEntity("pubkey-1", "device-1", DeviceKeyState.ACTIVE, 1000L),
                )
            },
            read = { db -> db.deviceKeyMetadataDao().getForDevice("device-1").single() },
        )

        assertEquals("pubkey-1", result.publicKeyId)
        assertEquals(DeviceKeyState.ACTIVE, result.keyState)
        assertEquals(1000L, result.establishedAtEpochMillis)
    }

    // ---- Review item: RetentionDeletionReceiptDao -- ALREADY COVERED, not duplicated here.
    // See ProcessRestartDurabilityTest."retention deletion receipts survive a reopen".
}
