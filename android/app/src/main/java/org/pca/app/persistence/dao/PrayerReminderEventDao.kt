package org.pca.app.persistence.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import org.pca.app.persistence.entity.PrayerReminderEventEntity

@Dao
interface PrayerReminderEventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: PrayerReminderEventEntity)

    @Query("SELECT * FROM prayer_reminder_events WHERE deviceId = :deviceId ORDER BY scheduledAtEpochMillis DESC")
    suspend fun getForDevice(deviceId: String): List<PrayerReminderEventEntity>

    @Query("SELECT COUNT(*) FROM prayer_reminder_events WHERE scheduledAtEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM prayer_reminder_events WHERE scheduledAtEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThan(cutoffEpochMillis: Long): Int

    @Query("DELETE FROM prayer_reminder_events WHERE deviceId = :deviceId AND scheduledAtEpochMillis < :cutoffEpochMillis")
    suspend fun deleteOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM prayer_reminder_events WHERE deviceId = :deviceId AND scheduledAtEpochMillis < :cutoffEpochMillis")
    suspend fun countOlderThanForDevice(deviceId: String, cutoffEpochMillis: Long): Int

    @Query("DELETE FROM prayer_reminder_events WHERE deviceId = :deviceId")
    suspend fun deleteAllForDevice(deviceId: String): Int

    @Query("DELETE FROM prayer_reminder_events WHERE deviceId IN " + FamilyScopeSql.DEVICE_IDS_FOR_FAMILY)
    suspend fun deleteAllForFamily(familyId: String): Int

    @Query("SELECT COUNT(*) FROM prayer_reminder_events")
    suspend fun count(): Int
}
