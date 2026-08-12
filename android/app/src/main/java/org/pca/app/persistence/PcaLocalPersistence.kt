package org.pca.app.persistence

import android.content.Context
import org.pca.app.persistence.crypto.AndroidKeystoreLocalRecordCipher
import org.pca.app.persistence.crypto.LocalRecordCipher
import org.pca.app.persistence.repository.BreakSessionRepository
import org.pca.app.persistence.repository.FamilyMemberRepository
import org.pca.app.persistence.repository.LocationPointRepository
import org.pca.app.persistence.repository.PolicyReceiptRepository
import org.pca.app.persistence.repository.PolicySnapshotRepository
import org.pca.app.persistence.repository.PrayerReminderEventRepository
import org.pca.app.persistence.repository.ProximityEventRepository
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.persistence.repository.WebVisitRepository
import org.pca.app.persistence.retention.DeleteNowCoordinator
import org.pca.app.persistence.retention.RetentionEngine
import org.pca.app.persistence.sync.SyncOutboxRepository
import org.pca.app.persistence.sync.SyncReceiptRepository

/**
 * Single production wiring point for [PcaLocalDatabase] and the repositories
 * built on top of it (PCA-LOCAL-DB-1 Section 4's "one canonical database").
 * Callers elsewhere in the app should depend on this rather than
 * constructing [PcaLocalDatabase] or [AndroidKeystoreLocalRecordCipher]
 * directly, so there is exactly one production instance of each.
 */
class PcaLocalPersistence private constructor(
    val database: PcaLocalDatabase,
    val cipher: LocalRecordCipher,
) {
    val familyMemberRepository = FamilyMemberRepository(database.familyMemberDao(), cipher)
    val webVisitRepository = WebVisitRepository(database.webVisitDao(), cipher)
    val locationPointRepository = LocationPointRepository(database.locationPointDao(), cipher)
    val usageSessionRepository = UsageSessionRepository(database.usageSessionDao(), cipher)
    val breakSessionRepository = BreakSessionRepository(database.breakSessionDao())
    val proximityEventRepository = ProximityEventRepository(database.proximityEventDao())
    val prayerReminderEventRepository = PrayerReminderEventRepository(database.prayerReminderEventDao())
    val policySnapshotRepository = PolicySnapshotRepository(database.policySnapshotDao(), cipher)
    val policyReceiptRepository = PolicyReceiptRepository(database.policyReceiptDao())
    val syncOutboxRepository = SyncOutboxRepository(database.syncOutboxDao(), cipher)
    val syncReceiptRepository = SyncReceiptRepository(database.syncReceiptDao())
    val retentionEngine = RetentionEngine(database)
    val deleteNowCoordinator = DeleteNowCoordinator(database)

    companion object {
        @Volatile private var instance: PcaLocalPersistence? = null

        fun getInstance(context: Context): PcaLocalPersistence =
            instance ?: synchronized(this) {
                instance ?: PcaLocalPersistence(
                    database = PcaLocalDatabase.build(context),
                    cipher = AndroidKeystoreLocalRecordCipher(),
                ).also { instance = it }
            }
    }
}
