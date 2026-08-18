package org.pca.app.persistence.entity

/** Mirrors doc 02 Section 3 / doc 10 Section 3.2 exactly -- no second role enum. */
enum class FamilyMemberRole { OWNER, ADMIN, VIEWER, CHILD }

enum class FamilyMemberStatus { ACTIVE, REMOVED }

enum class DevicePlatform { ANDROID, IOS }

/**
 * Mirrors doc 08 Section 3's device lifecycle state machine exactly
 * (doc 10 Section 3.3) -- this is the single source of truth reused here,
 * not a second, divergent enum (doc 10 Section 9 failure-mode table).
 */
enum class DeviceEnrollmentState { NEW, INVITED, PAIRED, ACTIVE, DEGRADED, RECOVERY_PENDING, REVOKED, REMOVED }

/** doc 10 Section 3.3 -- key/trust-epoch state, distinct from [DeviceEnrollmentState]. */
enum class DeviceTrustState { ACTIVE, ROTATION_PENDING, DEVICE_OFFLINE, REVOKED, EPOCH_STALE, RECOVERY_REQUIRED }

/** doc 10 Section 5 -- DeviceKeyMetadata.keyState. Never stores a private key. */
enum class DeviceKeyState { ACTIVE, ROTATED_OUT, REVOKED }

/** doc 10 Section 4.1 -- distinguishes a platform-reported value from an inferred one. */
enum class SourceConfidence { PLATFORM_API, HEURISTIC }

/**
 * `REVIEW` added by PCA-ANDROID-WEB-YOUTUBE-1: mirrors backend
 * `WebDecisionOutcome`'s three-way ALLOW/BLOCK/REVIEW outcome (doc 14's
 * classifier-held-for-review case is distinct from an outright block --
 * the child can request review on either, but a REVIEW-held page was never
 * definitively blocked by a rule/security source). Stored as [Converters]
 * already stores every enum here: by `.name` string, so this is not a
 * Room schema change (column type/shape is unaffected) and needs no
 * migration.
 */
enum class WebVisitAction { ALLOWED, BLOCKED, REVIEW }

/**
 * doc 10 Section 4.6 -- bucketed proximity signal only, never a
 * claimed-precise centimeter measurement (PCA-LOCAL-DB-1 Section 15).
 */
enum class ProximityBucket { NEAR, FAR, UNKNOWN }

enum class PrayerDeliveryState { SCHEDULED, DELIVERED, MISSED, CANCELLED }

/**
 * doc 11 Section 2 -- the five parent-selectable activity-retention windows,
 * plus the location-only rolling "keep latest point" mode (doc 11 Section 4).
 * [LATEST_ONLY] is valid only on [LocationPointEntity.retentionPolicy].
 */
enum class RetentionPolicy { FOURTEEN_DAYS, ONE_MONTH, THREE_MONTHS, SIX_MONTHS, NINE_MONTHS, LATEST_ONLY }

/** doc 10 Section 5 -- ParentActionAudit.actionType (doc 03 PCA-FR-124). */
enum class ParentActionType { ROLE_CHANGE, POLICY_EDIT, RETENTION_CHANGE, DELETION, DEVICE_LIFECYCLE_TRANSITION, EXPORT }

/** doc 21 -- TamperEvent.conditionType is free-form per the monitored-condition list; kept as String, not enumerated here. */

/** doc 09 Section 5.1-adjacent local outbox delivery state (PCA-LOCAL-DB-1 Section 18). */
enum class SyncOutboxState { PENDING, SENDING, SENT, ACKED, FAILED, EXPIRED }

/** doc 11 Section 5.1's per-replica deletion state machine, applied to outbox/receipt rows. */
enum class SyncReceiptApplicationState { RECEIVED, APPLIED, DUPLICATE_IGNORED, STALE_EPOCH_REJECTED, OUT_OF_ORDER_REJECTED }
