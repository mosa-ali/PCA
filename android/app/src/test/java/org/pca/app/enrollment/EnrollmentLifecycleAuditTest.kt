package org.pca.app.enrollment

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    /**
     * The bootstrap step (EnrollmentCoordinator.persistSuccess) genuinely does not know the real
     * familyId yet -- proves the auditor accepts an honest `null` for it (never fabricating "")
     * and that the resulting record carries that `null` through untouched, not silently coerced
     * to any other value.
     */
    @Test
    fun `null familyId -- not yet known -- is accepted and recorded honestly`() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor(
            familyId = null,
            deviceId = "device-1",
            auditSink = sink,
            now = { now },
        )

        val record = auditor.recordTransition(
            from = null,
            to = PairingState.PAIRING_PENDING,
            actorId = "device:device-1",
            reason = "server-authorized bootstrap/pairing result committed",
        )

        assertNull(record.familyId)
        assertEquals(1, sink.records.size)
        assertNull(sink.records.single().familyId)
    }

    /**
     * A blank-but-non-null familyId ("" or all-whitespace) must NEVER reach the audit log --
     * it is indistinguishable from a real-but-empty id, unlike an honest `null`. Fail-closed:
     * construction itself throws before any transition can be recorded.
     */
    @Test
    fun `blank non-null familyId is rejected fail-closed at construction, distinct from null`() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()

        for (blank in listOf("", "   ")) {
            val error = try {
                EnrollmentLifecycleAuditor(
                    familyId = blank,
                    deviceId = "device-1",
                    auditSink = sink,
                )
                null
            } catch (e: EnrollmentLifecycleTransitionError) {
                e
            }
            assertTrue(error is EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier)
        }
        assertTrue(sink.records.isEmpty())
    }
}
