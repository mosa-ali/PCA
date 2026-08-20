package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * PCA-FR-140: durable, device-local mirror of
 * [org.pca.app.enrollment.EnrollmentLifecycleAuditRecord] -- see that
 * class's own doc comment for [familyId]/[fromState]'s honest-nullability
 * rules, which this entity preserves exactly (columns stay nullable, never
 * a fabricated `""`/placeholder state). `fromState`/`toState` are stored as
 * plain [org.pca.app.enrollment.PairingState] `.name` strings rather than a
 * [org.pca.app.persistence.Converters] enum converter, since `fromState`
 * must support the null "not yet enrolled" case a non-nullable
 * `@TypeConverter` cannot express. No central/server-readable audit store
 * is introduced by this entity -- it stays on-device only, mirroring
 * [org.pca.app.persistence.entity.ParentActionAuditEntity]'s local-only
 * posture.
 */
@Entity(
    tableName = "enrollment_lifecycle_audits",
    indices = [Index("deviceId"), Index("occurredAtEpochMillis")],
)
data class EnrollmentLifecycleAuditEntity(
    @PrimaryKey val id: String,
    val familyId: String?,
    val deviceId: String,
    val actorId: String,
    val fromState: String?,
    val toState: String,
    val reason: String,
    val occurredAtEpochMillis: Long,
)
