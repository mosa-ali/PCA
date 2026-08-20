package org.pca.app.enrollment

import java.time.Instant

/**
 * PCA-FR-140 Android parity: audit record for this device's own [PairingState]
 * transitions, mirroring iOS's `EnrollmentLifecycleAuditRecord`
 * (ios/PCA/Recovery/EnrollmentLifecycle.swift) shape and semantics --
 * actor/from/to/reason/timestamp, appended BEFORE the caller commits the new
 * state, never after (see [EnrollmentLifecycleAuditor.recordTransition]).
 *
 * [fromState] is null exactly once per device lifetime: the very first
 * recorded transition out of "not yet enrolled." [PairingState] itself has
 * no NotEnrolled/NEW case (see that enum's own doc -- it deliberately mirrors
 * only the backend's PAIRING_PENDING/PAIRED/ACTIVE/REVOKED device-status
 * vocabulary), so null stands in for the absent prior state here, exactly as
 * [org.pca.app.enrollment.EnrollmentState.NotEnrolled] does one layer up.
 */
data class EnrollmentLifecycleAuditRecord(
    val familyId: String,
    val deviceId: String,
    val actorId: String,
    val fromState: PairingState?,
    val toState: PairingState,
    val reason: String,
    val occurredAtUtc: Instant,
)

interface EnrollmentLifecycleAuditSink {
    fun append(record: EnrollmentLifecycleAuditRecord)
}

/**
 * Local in-memory audit sink used by tests and as the coordinator's default
 * -- mirrors iOS's `InMemoryEnrollmentLifecycleAuditSink`. No server-readable
 * family-data audit store is introduced here; a durable/device-local adapter
 * can wrap or replace this sink at the composition root without changing
 * this contract.
 */
class InMemoryEnrollmentLifecycleAuditSink : EnrollmentLifecycleAuditSink {
    private val _records = mutableListOf<EnrollmentLifecycleAuditRecord>()
    val records: List<EnrollmentLifecycleAuditRecord> get() = _records

    override fun append(record: EnrollmentLifecycleAuditRecord) {
        _records.add(record)
    }
}

sealed class EnrollmentLifecycleTransitionError(message: String) : Exception(message) {
    data class InvalidTransition(val from: PairingState?, val to: PairingState) :
        EnrollmentLifecycleTransitionError("invalid transition from=$from to=$to")

    object MissingOpaqueIdentifier : EnrollmentLifecycleTransitionError("missing opaque identifier")

    object InvalidReason : EnrollmentLifecycleTransitionError("invalid reason")
}

/**
 * Fail-closed guard mirroring iOS's `EnrollmentLifecycleMachine`: every
 * successful transition appends exactly one audit record before the caller
 * is told it may commit the new [PairingState]; an invalid transition throws
 * [EnrollmentLifecycleTransitionError.InvalidTransition] and appends nothing
 * -- the caller MUST NOT commit local state when this throws.
 *
 * The allowed-transition table mirrors [PairingState]'s own documented
 * backend mirror (PAIRING_PENDING -> PAIRED -> ACTIVE, REVOKED from any
 * non-terminal state), plus the null -> PAIRING_PENDING first-enrollment
 * edge and same-state replays (the bootstrap protocol's idempotent-retry
 * design -- PCA-ENROLLMENT-RUNTIME-2 -- can legitimately re-observe the same
 * server-reported status more than once for the same attempt).
 */
class EnrollmentLifecycleAuditor(
    private val familyId: String,
    private val deviceId: String,
    private val auditSink: EnrollmentLifecycleAuditSink,
    private val now: () -> Instant = Instant::now,
) {
    init {
        if (deviceId.isBlank()) throw EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier
    }

    @Suppress("ThrowsCount")
    fun recordTransition(
        from: PairingState?,
        to: PairingState,
        actorId: String,
        reason: String,
    ): EnrollmentLifecycleAuditRecord {
        if (actorId.isBlank()) throw EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier
        if (reason.isBlank() || reason.length > 280) throw EnrollmentLifecycleTransitionError.InvalidReason
        if (!isAllowed(from, to)) throw EnrollmentLifecycleTransitionError.InvalidTransition(from, to)

        val record = EnrollmentLifecycleAuditRecord(
            familyId = familyId,
            deviceId = deviceId,
            actorId = actorId,
            fromState = from,
            toState = to,
            reason = reason,
            occurredAtUtc = now(),
        )
        auditSink.append(record)
        return record
    }

    companion object {
        fun isAllowed(from: PairingState?, to: PairingState): Boolean {
            if (from == to) return true
            return when (from) {
                null -> to == PairingState.PAIRING_PENDING
                PairingState.PAIRING_PENDING -> to == PairingState.PAIRED || to == PairingState.REVOKED
                PairingState.PAIRED -> to == PairingState.ACTIVE || to == PairingState.REVOKED
                PairingState.ACTIVE -> to == PairingState.REVOKED
                PairingState.REVOKED -> false
            }
        }
    }
}
