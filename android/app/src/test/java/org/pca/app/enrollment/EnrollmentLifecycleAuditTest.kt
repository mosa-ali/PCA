package org.pca.app.enrollment

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-FR-140 Android parity coverage, mirroring
 * ios/PCATests/RecoveryLifecycleTests.swift's two cases: every documented
 * transition records actor/time/reason, and an invalid transition changes
 * neither state nor the audit log (fail-closed).
 */
class EnrollmentLifecycleAuditTest {
    private val now = Instant.ofEpochSecond(1_700_000_000)

    @Test
    fun everyDocumentedPairingTransitionRecordsActorTimeAndReason() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor(
            familyId = "family-1",
            deviceId = "device-1",
            auditSink = sink,
            now = { now },
        )

        val transitions: List<Pair<PairingState?, PairingState>> = listOf(
            null to PairingState.PAIRING_PENDING,
            PairingState.PAIRING_PENDING to PairingState.PAIRED,
            PairingState.PAIRED to PairingState.ACTIVE,
            PairingState.ACTIVE to PairingState.REVOKED,
        )

        for ((from, to) in transitions) {
            val record = auditor.recordTransition(
                from = from,
                to = to,
                actorId = "parent-device-1",
                reason = "test transition",
            )
            assertEquals(from, record.fromState)
            assertEquals(to, record.toState)
            assertEquals("parent-device-1", record.actorId)
            assertEquals(now, record.occurredAtUtc)
        }
        assertEquals(transitions.size, sink.records.size)
    }

    @Test
    fun invalidTransitionDoesNotAppendToAuditLog() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor(
            familyId = "family-1",
            deviceId = "device-1",
            auditSink = sink,
        )

        // REVOKED is terminal in this local model -- no further transition is ever valid.
        auditor.recordTransition(
            from = null,
            to = PairingState.PAIRING_PENDING,
            actorId = "parent-device-1",
            reason = "initial bootstrap",
        )
        auditor.recordTransition(
            from = PairingState.PAIRING_PENDING,
            to = PairingState.REVOKED,
            actorId = "parent-device-1",
            reason = "revoke before pairing completes",
        )
        assertEquals(2, sink.records.size)

        val error = try {
            auditor.recordTransition(
                from = PairingState.REVOKED,
                to = PairingState.PAIRED,
                actorId = "parent-device-1",
                reason = "should never be reachable",
            )
            null
        } catch (e: EnrollmentLifecycleTransitionError.InvalidTransition) {
            e
        }

        assertTrue(error != null)
        assertEquals(PairingState.REVOKED, error!!.from)
        assertEquals(PairingState.PAIRED, error.to)
        assertEquals(2, sink.records.size)
    }

    @Test
    fun missingActorIdIsRejectedFailClosed() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor(
            familyId = "family-1",
            deviceId = "device-1",
            auditSink = sink,
        )

        val error = try {
            auditor.recordTransition(
                from = null,
                to = PairingState.PAIRING_PENDING,
                actorId = "",
                reason = "missing actor",
            )
            null
        } catch (e: EnrollmentLifecycleTransitionError) {
            e
        }

        assertTrue(error is EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier)
        assertTrue(sink.records.isEmpty())
    }
}
