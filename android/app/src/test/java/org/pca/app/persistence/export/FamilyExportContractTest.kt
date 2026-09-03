package org.pca.app.persistence.export

import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DeviceEntity
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberEntity
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.LocationPointEntity
import org.pca.app.persistence.entity.ParentActionAuditEntity
import org.pca.app.persistence.entity.ParentActionType
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.InstalledAppEventRepository
import org.pca.app.persistence.repository.UsageSessionRepository
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FamilyExportContractTest {
    private lateinit var database: PcaLocalDatabase
    private lateinit var cipher: LocalRecordCipher
    private lateinit var tempDirectory: File

    private val now = Instant.parse("2026-08-12T10:15:30Z")
    private val scope = FamilyExportRetentionScope(
        generalPolicy = RetentionPolicy.FOURTEEN_DAYS,
        locationPolicy = RetentionPolicy.LATEST_ONLY,
        zoneId = ZoneId.of("UTC"),
    )

    @Before
    fun setUp() {
        database = PersistenceTestSupport.inMemoryDb()
        cipher = PersistenceTestSupport.testCipher()
        tempDirectory = Files.createTempDirectory("pca-family-export-test").toFile()
        runBlocking {
            database.familyMemberDao().upsert(member("owner-a", "family-a", FamilyMemberRole.OWNER))
            database.familyMemberDao().upsert(member("viewer-a", "family-a", FamilyMemberRole.VIEWER))
            database.familyMemberDao().upsert(member("owner-b", "family-b", FamilyMemberRole.OWNER))
            database.deviceDao().upsert(device("device-a", "owner-a"))
            database.deviceDao().upsert(device("device-b", "owner-b"))
        }
    }

    @After
    fun tearDown() {
        database.close()
        tempDirectory.deleteRecursively()
    }

    @Test
    fun `room source is family scoped and excludes expired activity while retaining audit floor records`() = runTest {
        UsageSessionRepository(database.usageSessionDao(), cipher).record(
            id = "usage-recent",
            deviceId = "device-a",
            appOrCategoryToken = "games",
            startedAtEpochMillis = now.minusSeconds(60).toEpochMilli(),
            endedAtEpochMillis = now.toEpochMilli(),
            durationMillis = 60_000,
            sourceConfidence = SourceConfidence.PLATFORM_API,
        )
        UsageSessionRepository(database.usageSessionDao(), cipher).record(
            id = "usage-expired",
            deviceId = "device-a",
            appOrCategoryToken = "old-games",
            startedAtEpochMillis = now.minusSeconds(20L * 24 * 60 * 60).toEpochMilli(),
            endedAtEpochMillis = now.minusSeconds(20L * 24 * 60 * 60 - 60).toEpochMilli(),
            durationMillis = 60_000,
            sourceConfidence = SourceConfidence.PLATFORM_API,
        )
        database.parentActionAuditDao().upsert(
            ParentActionAuditEntity(
                "audit-recent", "owner-a", ParentActionType.POLICY_EDIT, "policy",
                now.minusSeconds(60).toEpochMilli(), null, null,
            ),
        )
        database.parentActionAuditDao().upsert(
            ParentActionAuditEntity(
                "audit-too-old", "owner-a", ParentActionType.POLICY_EDIT, "old-policy",
                now.minusSeconds(400L * 24 * 60 * 60).toEpochMilli(), null, null,
            ),
        )
        database.parentActionAuditDao().upsert(
            ParentActionAuditEntity(
                "audit-other-family", "owner-b", ParentActionType.POLICY_EDIT, "other-policy",
                now.minusSeconds(60).toEpochMilli(), null, null,
            ),
        )

        val locationFresh = cipher.encrypt("10.0")
        val locationFreshLongitude = cipher.encrypt("20.0")
        val locationOld = cipher.encrypt("11.0")
        val locationOldLongitude = cipher.encrypt("21.0")
        database.locationPointDao().upsert(
            LocationPointEntity(
                "location-fresh", "device-a", now.minusSeconds(60).toEpochMilli(),
                locationFresh.ciphertext.toB64(), locationFresh.iv.toB64(),
                locationFreshLongitude.ciphertext.toB64(), locationFreshLongitude.iv.toB64(),
                5f, "GPS", RetentionPolicy.FOURTEEN_DAYS,
            ),
        )
        database.locationPointDao().upsert(
            LocationPointEntity(
                "location-old", "device-a", now.minusSeconds(120).toEpochMilli(),
                locationOld.ciphertext.toB64(), locationOld.iv.toB64(),
                locationOldLongitude.ciphertext.toB64(), locationOldLongitude.iv.toB64(),
                5f, "GPS", RetentionPolicy.FOURTEEN_DAYS,
            ),
        )

        val records = LocalRoomFamilyExportDataSource(database, cipher).collect("family-a", scope, now)
        val ids = records.map { it.id }.toSet()
        assertTrue("recent family activity is exported", "usage-recent" in ids)
        assertFalse("expired activity is excluded", "usage-expired" in ids)
        assertTrue("recent family audit is exported", "audit-recent" in ids)
        assertFalse("audit floor excludes records older than its bounded floor", "audit-too-old" in ids)
        assertFalse("other family audit is excluded", "audit-other-family" in ids)
        assertTrue("latest location is retained", "location-fresh" in ids)
        assertFalse("CURRENT_LAST_ONLY does not export superseded points", "location-old" in ids)
    }

    /**
     * PPR1R-D037: installed-app records used to leave this device tagged `ROUTINE_ACTIVITY` --
     * doc 11 Section 3.1's explicit catch-all for "routine device activity not otherwise
     * itemized" -- even though `INSTALLED_APP_EVENT` is that entity's own itemized class. The
     * backend matches a parent's Section 6 "Delete now" request by (entityClass, id), so the only
     * name a parent has for these records matched nothing in an export, while the device-side
     * retention engine was already purging the same table.
     */
    @Test
    fun `installed app events export under the itemized INSTALLED_APP_EVENT class, decrypted, family scoped and retention bounded`() = runTest {
        val installedAppEventRepository = InstalledAppEventRepository(database.installedAppEventDao(), cipher)
        installedAppEventRepository.record(
            id = "install-recent",
            deviceId = "device-a",
            packageName = "com.example.game",
            appLabel = "Example Game",
            installedAtEpochMillis = now.minusSeconds(60).toEpochMilli(),
            observedAtEpochMillis = now.toEpochMilli(),
        )
        installedAppEventRepository.record(
            id = "install-expired",
            deviceId = "device-a",
            packageName = "com.example.old",
            appLabel = null,
            installedAtEpochMillis = now.minusSeconds(20L * 24 * 60 * 60).toEpochMilli(),
            observedAtEpochMillis = now.minusSeconds(20L * 24 * 60 * 60).toEpochMilli(),
        )
        installedAppEventRepository.record(
            id = "install-other-family",
            deviceId = "device-b",
            packageName = "com.example.other",
            appLabel = "Other App",
            installedAtEpochMillis = now.minusSeconds(60).toEpochMilli(),
            observedAtEpochMillis = now.toEpochMilli(),
        )

        val records = LocalRoomFamilyExportDataSource(database, cipher).collect("family-a", scope, now)

        val installed = records.filter { it.entityClass == "INSTALLED_APP_EVENT" }
        assertEquals("exactly the one in-scope installed-app record is addressable", 1, installed.size)
        val record = installed.single()
        assertEquals("install-recent", record.id)
        assertEquals("device-a", record.deviceId)
        assertEquals(now.minusSeconds(60).toEpochMilli(), record.eventTimestampEpochMillis)
        // Decrypted through the SAME LocalRecordCipher the repository owns -- this export path
        // never sees packageNameEnc/packageNameIv, and authors no crypto of its own.
        assertEquals("com.example.game", record.payload.getString("packageName"))
        assertEquals("Example Game", record.payload.getString("appLabel"))
        assertEquals(now.toEpochMilli(), record.payload.getLong("observedAtEpochMillis"))

        assertFalse(
            "an installed-app record must never hide inside the ROUTINE_ACTIVITY catch-all -- a Delete now " +
                "request naming INSTALLED_APP_EVENT would then match nothing",
            records.any { it.entityClass == "ROUTINE_ACTIVITY" },
        )
        val ids = records.map { it.id }.toSet()
        assertFalse("an installed-app record past the general cutoff is excluded", "install-expired" in ids)
        assertFalse("another family's installed-app record is excluded", "install-other-family" in ids)
    }

    @Test
    fun `owner step up and family binding are required before encryption or file creation`() = runTest {
        val encryptor = RecordingEncryptor()
        val service = service()

        val viewer = service.generateEncryptedExport(
            "family-a", "viewer-a", scope, now.toEpochMilli(), true, encryptor, fileStore(),
        )
        val noStepUp = service.generateEncryptedExport(
            "family-a", "owner-a", scope, now.toEpochMilli(), false, encryptor, fileStore(),
        )
        val wrongFamily = service.generateEncryptedExport(
            "family-a", "owner-b", scope, now.toEpochMilli(), true, encryptor, fileStore(),
        )

        assertEquals(FamilyExportAuthorization.Code.FORBIDDEN, (viewer as FamilyExportOutcome.Denied).code)
        assertEquals(FamilyExportAuthorization.Code.STEP_UP_REQUIRED, (noStepUp as FamilyExportOutcome.Denied).code)
        assertEquals(FamilyExportAuthorization.Code.FORBIDDEN, (wrongFamily as FamilyExportOutcome.Denied).code)
        assertTrue("denied requests never reach the encryptor", encryptor.calls.isEmpty())
        assertTrue("denied requests never create the app-managed file", tempDirectory.listFiles().orEmpty().none { it.extension == "pca-export" })
    }

    @Test
    fun `successful export writes only encrypted artifact and records export audit`() = runTest {
        UsageSessionRepository(database.usageSessionDao(), cipher).record(
            id = "usage-export",
            deviceId = "device-a",
            appOrCategoryToken = "games",
            startedAtEpochMillis = now.minusSeconds(60).toEpochMilli(),
            endedAtEpochMillis = now.toEpochMilli(),
            durationMillis = 60_000,
            sourceConfidence = SourceConfidence.PLATFORM_API,
        )
        val encryptor = RecordingEncryptor()
        val store = fileStore()
        val outcome = service().generateEncryptedExport(
            "family-a", "owner-a", scope, now.toEpochMilli(), true, encryptor, store,
        )

        val completed = outcome as FamilyExportOutcome.Completed
        assertEquals("family-a", encryptor.familyId)
        assertNotNull(encryptor.payload)
        assertTrue("plaintext is available only inside the encryptor boundary", encryptor.payload!!.toString(Charsets.UTF_8).contains("games"))
        assertTrue(completed.file.exists())
        val fileBytes = completed.file.readText()
        assertFalse("plaintext activity never reaches the file", fileBytes.contains("games"))
        assertTrue(fileBytes.contains("pca-family-encrypted-export-v1"))
        assertTrue(database.parentActionAuditDao().getForFamily("family-a").any { it.actionType == ParentActionType.EXPORT })
        assertTrue(store.delete(completed.exportId))
        assertFalse(completed.file.exists())
    }

    @Test
    fun `production crypto gate fails closed before file write`() = runTest {
        val store = fileStore()
        val outcome = service().generateEncryptedExport(
            "family-a", "owner-a", scope, now.toEpochMilli(), true,
            RejectingFamilyExportEncryptor(), store,
        )

        assertEquals(FamilyExportOutcome.Failed.Code.CRYPTO_UNAVAILABLE, (outcome as FamilyExportOutcome.Failed).code)
        assertTrue("crypto-gated export has no file", tempDirectory.listFiles().orEmpty().none { it.extension == "pca-export" })
        assertTrue("crypto-gated export has no staging residue", tempDirectory.listFiles().orEmpty().isEmpty())
    }

    @Test
    fun `malformed location scope fails closed before source collection or encryption`() = runTest {
        val encryptor = RecordingEncryptor()
        val outcome = service().generateEncryptedExport(
            "family-a",
            "owner-a",
            scope.copy(locationPolicy = RetentionPolicy.ONE_MONTH),
            now.toEpochMilli(),
            true,
            encryptor,
            fileStore(),
        )

        assertEquals(FamilyExportOutcome.Failed.Code.INVALID_REQUEST, (outcome as FamilyExportOutcome.Failed).code)
        assertTrue("invalid scope never reaches the encryptor", encryptor.calls.isEmpty())
        assertTrue("invalid scope never creates a file", tempDirectory.listFiles().orEmpty().isEmpty())
    }

    @Test
    fun `atomic file store rejects unsafe ids and removes app managed copies`() {
        val store = fileStore()
        val artifact = EncryptedFamilyExportArtifact(
            exportId = "export-1",
            manifestBytes = "manifest".toByteArray(),
            ciphertext = "ciphertext".toByteArray(),
            encryptionMetadata = "metadata".toByteArray(),
        )
        val file = store.write(artifact)
        assertTrue(file.exists())
        assertTrue(tempDirectory.listFiles().orEmpty().none { it.name.endsWith(".staging") })
        assertTrue(store.delete("export-1"))
        assertFalse(file.exists())
        assertFalse(store.delete("../outside"))
    }

    private fun service() = AuditRecordExportService(
        database = database,
        dataSource = LocalRoomFamilyExportDataSource(database, cipher),
        localCipher = cipher,
    )

    private fun fileStore() = AtomicEncryptedFamilyExportFileStore(tempDirectory)

    private fun member(id: String, familyId: String, role: FamilyMemberRole) = FamilyMemberEntity(
        memberId = id,
        familyId = familyId,
        role = role,
        displayNameEnc = "enc",
        displayNameIv = "iv",
        status = FamilyMemberStatus.ACTIVE,
        ageTier = "PARENT",
        updatedAtEpochMillis = now.toEpochMilli(),
    )

    private fun device(id: String, memberId: String) = DeviceEntity(
        deviceId = id,
        memberId = memberId,
        platform = DevicePlatform.ANDROID,
        platformVersion = "35",
        appVersion = "1",
        signingKeyId = "signing-$id",
        encryptionKeyId = "encryption-$id",
        trustSetEpoch = 1L,
        keyEpoch = 1L,
        trustState = DeviceTrustState.ACTIVE,
        enrollmentState = DeviceEnrollmentState.ACTIVE,
        lastSeenAtEpochMillis = now.toEpochMilli(),
        capabilityProfileJson = "{}",
    )

    private class RecordingEncryptor : FamilyExportEncryptor {
        var familyId: String? = null
        var payload: ByteArray? = null
        val calls = mutableListOf<String>()

        override suspend fun encrypt(
            familyId: String,
            manifestBytes: ByteArray,
            payloadBytes: ByteArray,
        ): EncryptedFamilyExportPayload {
            this.familyId = familyId
            payload = payloadBytes
            calls += familyId
            return EncryptedFamilyExportPayload("ciphertext-only".toByteArray(), "metadata".toByteArray())
        }
    }

    private fun ByteArray.toB64(): String = android.util.Base64.encodeToString(this, android.util.Base64.NO_WRAP)
}
