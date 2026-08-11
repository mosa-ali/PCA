package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * doc 10 Section 4.7. Delivery metadata only -- no devotional-behavior
 * surveillance beyond what scheduling/delivery requires (PCA-LOCAL-DB-1
 * Section 16).
 */
@Entity(
    tableName = "prayer_reminder_events",
    indices = [Index("deviceId"), Index("scheduledAtEpochMillis")],
)
data class PrayerReminderEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val prayerKey: String,
    val scheduledAtEpochMillis: Long,
    val deliveryState: PrayerDeliveryState,
)
