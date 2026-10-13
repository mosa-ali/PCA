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

        for (blank in listOf("", "   ", "\u00A0", "\u0085", "\u2003")) {
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

    @Test
    fun `Unicode White_Space vectors are blank for identifiers actors and reasons`() {
        val whitespace = listOf(
            "\u0009", "\u000A", "\u000B", "\u000C", "\u000D", "\u0020", "\u0085", "\u00A0",
            "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006",
            "\u2007", "\u2008", "\u2009", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000",
        )
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor(
            familyId = "family-1",
            deviceId = "device-1",
            auditSink = sink,
            now = { now },
        )

        for (blank in whitespace) {
            val familyError = try {
                EnrollmentLifecycleAuditor(blank, "device-1", sink)
                null
            } catch (error: EnrollmentLifecycleTransitionError) {
                error
            }
            assertTrue("U+${blank[0].code.toString(16)} should be blank as family id", familyError is EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier)

            val deviceError = try {
                EnrollmentLifecycleAuditor("family-1", blank, sink)
                null
            } catch (error: EnrollmentLifecycleTransitionError) {
                error
            }
            assertTrue("whitespace scalar should be blank as device id", deviceError is EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier)

            val actorError = try {
                auditor.recordTransition(null, PairingState.PAIRING_PENDING, blank, "reason")
                null
            } catch (error: EnrollmentLifecycleTransitionError) {
                error
            }
            assertTrue("whitespace scalar should be blank as actor", actorError is EnrollmentLifecycleTransitionError.MissingOpaqueIdentifier)

            val reasonError = try {
                auditor.recordTransition(null, PairingState.PAIRING_PENDING, "actor-1", blank)
                null
            } catch (error: EnrollmentLifecycleTransitionError) {
                error
            }
            assertTrue("whitespace scalar should be blank as reason", reasonError is EnrollmentLifecycleTransitionError.InvalidReason)
        }
        assertTrue(sink.records.isEmpty())
    }

    @Test
    fun `Unicode control separators U+001C through U+001F are not in the blank set`() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor(
            familyId = "\u001C",
            deviceId = "\u001D",
            auditSink = sink,
            now = { now },
        )

        val record = auditor.recordTransition(
            from = null,
            to = PairingState.PAIRING_PENDING,
            actorId = "\u001E",
            reason = "\u001F",
        )

        assertEquals("\u001C", record.familyId)
        assertEquals("\u001D", record.deviceId)
        assertEquals("\u001E", record.actorId)
        assertEquals("\u001F", record.reason)
        assertEquals(1, sink.records.size)
    }

    @Test
    fun `U+FEFF is not in the shared Unicode White_Space blank set`() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val bom = "\uFEFF"
        val auditor = EnrollmentLifecycleAuditor(
            familyId = bom,
            deviceId = "device-1",
            auditSink = sink,
            now = { now },
        )

        val record = auditor.recordTransition(
            from = null,
            to = PairingState.PAIRING_PENDING,
            actorId = bom,
            reason = bom,
        )

        assertEquals(bom, record.familyId)
        assertEquals(bom, record.actorId)
        assertEquals(bom, record.reason)
    }

    @Test
    fun `reason limit counts UTF-16 units at the 280-unit boundary`() {
        val sink = InMemoryEnrollmentLifecycleAuditSink()
        val auditor = EnrollmentLifecycleAuditor("family-1", "device-1", sink, now = { now })
        val exactly280Units = "\uD83D\uDE00".repeat(140)
        val overLimit = "\uD83D\uDE00".repeat(141)

        assertEquals(280, exactly280Units.length)
        auditor.recordTransition(null, PairingState.PAIRING_PENDING, "actor-1", exactly280Units)
        assertEquals(1, sink.records.size)

        val error = try {
            auditor.recordTransition(null, PairingState.PAIRING_PENDING, "actor-1", overLimit)
            null
        } catch (failure: EnrollmentLifecycleTransitionError) {
            failure
        }
        assertTrue(error is EnrollmentLifecycleTransitionError.InvalidReason)
        assertEquals(1, sink.records.size)
    }
}
