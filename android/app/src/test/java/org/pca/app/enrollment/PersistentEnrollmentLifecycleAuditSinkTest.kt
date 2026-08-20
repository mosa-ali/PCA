package org.pca.app.enrollment

import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.repository.EnrollmentLifecycleAuditRepository
import org.robolectric.RobolectricTestRunner

/**
 * PCA-FR-140: proves [PersistentEnrollmentLifecycleAuditSink] actually persists what
 * [EnrollmentLifecycleAuditor] hands it -- the durable replacement for
 * [InMemoryEnrollmentLifecycleAuditSink] wired at [org.pca.app.runtime.graph.PcaAppGraph]'s
 * composition root.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PersistentEnrollmentLifecycleAuditSinkTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: EnrollmentLifecycleAuditRepository
    private lateinit var scope: CoroutineScope
    private lateinit var sink: PersistentEnrollmentLifecycleAuditSink

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repository = EnrollmentLifecycleAuditRepository(db.enrollmentLifecycleAuditDao())
        // Unconfined so append()'s fire-and-forget launch{} completes before the
        // assertion below runs, without needing a real async wait in the test.
        // Cancelled in tearDown so this scope's job never outlives the test
        // (an uncancelled CoroutineScope here could otherwise leak an
        // uncaught-exception report into a later, unrelated test in the same
        // JVM run).
        scope = CoroutineScope(UnconfinedTestDispatcher())
        sink = PersistentEnrollmentLifecycleAuditSink(repository, scope)
    }

    @After
    fun tearDown() {
        scope.cancel()
        db.close()
    }

    @Test
    fun `appending a transition durably persists every field, honoring null familyId and fromState`() {
        val auditor = EnrollmentLifecycleAuditor(
            familyId = null,
            deviceId = "device-1",
            auditSink = sink,
            now = { Instant.ofEpochSecond(1_700_000_000) },
        )

        auditor.recordTransition(
            from = null,
            to = PairingState.PAIRING_PENDING,
            actorId = "actor-1",
            reason = "first enrollment",
        )

        val stored = repository.let { runBlockingForTest { it.getForDevice("device-1") } }
        assertEquals(1, stored.size)
        assertNull(stored[0].familyId)
        assertNull(stored[0].fromState)
        assertEquals("PAIRING_PENDING", stored[0].toState)
        assertEquals("actor-1", stored[0].actorId)
        assertEquals("first enrollment", stored[0].reason)
        assertEquals(1_700_000_000_000L, stored[0].occurredAtEpochMillis)
    }
}

private fun <T> runBlockingForTest(block: suspend () -> T): T =
    kotlinx.coroutines.runBlocking { block() }
