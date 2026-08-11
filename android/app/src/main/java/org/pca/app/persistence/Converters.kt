package org.pca.app.persistence

import androidx.room.TypeConverter
import org.pca.app.persistence.entity.DeviceEnrollmentState
import org.pca.app.persistence.entity.DeviceKeyState
import org.pca.app.persistence.entity.DevicePlatform
import org.pca.app.persistence.entity.DeviceTrustState
import org.pca.app.persistence.entity.FamilyMemberRole
import org.pca.app.persistence.entity.FamilyMemberStatus
import org.pca.app.persistence.entity.ParentActionType
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.persistence.entity.ProximityBucket
import org.pca.app.persistence.entity.RetentionPolicy
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.entity.SyncOutboxState
import org.pca.app.persistence.entity.SyncReceiptApplicationState
import org.pca.app.persistence.entity.WebVisitAction

/**
 * All enums stored as their plain `.name` string -- readable in DB
 * inspection tools and stable across Kotlin recompiles (ordinal-based
 * storage would silently corrupt data if an enum's declaration order ever
 * changed).
 */
class Converters {
    @TypeConverter fun toFamilyMemberRole(v: String) = enumValueOf<FamilyMemberRole>(v)
    @TypeConverter fun fromFamilyMemberRole(v: FamilyMemberRole) = v.name

    @TypeConverter fun toFamilyMemberStatus(v: String) = enumValueOf<FamilyMemberStatus>(v)
    @TypeConverter fun fromFamilyMemberStatus(v: FamilyMemberStatus) = v.name

    @TypeConverter fun toDevicePlatform(v: String) = enumValueOf<DevicePlatform>(v)
    @TypeConverter fun fromDevicePlatform(v: DevicePlatform) = v.name

    @TypeConverter fun toDeviceEnrollmentState(v: String) = enumValueOf<DeviceEnrollmentState>(v)
    @TypeConverter fun fromDeviceEnrollmentState(v: DeviceEnrollmentState) = v.name

    @TypeConverter fun toDeviceTrustState(v: String) = enumValueOf<DeviceTrustState>(v)
    @TypeConverter fun fromDeviceTrustState(v: DeviceTrustState) = v.name

    @TypeConverter fun toDeviceKeyState(v: String) = enumValueOf<DeviceKeyState>(v)
    @TypeConverter fun fromDeviceKeyState(v: DeviceKeyState) = v.name

    @TypeConverter fun toSourceConfidence(v: String) = enumValueOf<SourceConfidence>(v)
    @TypeConverter fun fromSourceConfidence(v: SourceConfidence) = v.name

    @TypeConverter fun toWebVisitAction(v: String) = enumValueOf<WebVisitAction>(v)
    @TypeConverter fun fromWebVisitAction(v: WebVisitAction) = v.name

    @TypeConverter fun toProximityBucket(v: String) = enumValueOf<ProximityBucket>(v)
    @TypeConverter fun fromProximityBucket(v: ProximityBucket) = v.name

    @TypeConverter fun toPrayerDeliveryState(v: String) = enumValueOf<PrayerDeliveryState>(v)
    @TypeConverter fun fromPrayerDeliveryState(v: PrayerDeliveryState) = v.name

    @TypeConverter fun toRetentionPolicy(v: String) = enumValueOf<RetentionPolicy>(v)
    @TypeConverter fun fromRetentionPolicy(v: RetentionPolicy) = v.name

    @TypeConverter fun toParentActionType(v: String) = enumValueOf<ParentActionType>(v)
    @TypeConverter fun fromParentActionType(v: ParentActionType) = v.name

    @TypeConverter fun toSyncOutboxState(v: String) = enumValueOf<SyncOutboxState>(v)
    @TypeConverter fun fromSyncOutboxState(v: SyncOutboxState) = v.name

    @TypeConverter fun toSyncReceiptApplicationState(v: String) = enumValueOf<SyncReceiptApplicationState>(v)
    @TypeConverter fun fromSyncReceiptApplicationState(v: SyncReceiptApplicationState) = v.name
}
