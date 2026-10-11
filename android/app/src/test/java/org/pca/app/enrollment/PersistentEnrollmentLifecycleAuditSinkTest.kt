package org.pca.app.enrollment

import java.time.Instant
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.job
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.dao.EnrollmentLifecycleAuditDao
import org.pca.app.persistence.entity.EnrollmentLifecycleAuditEntity
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
        // NOTE: Unconfined does NOT make append()'s launch{} complete inline.
        // It runs eagerly only up to the first real suspension, and the Room
        // suspend DAO underneath suspends and resumes on Room's own query
        // executor. Waiting for the write is done explicitly in the test via
        // awaitPendingWrites(); this dispatcher just removes one scheduling hop.
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

    /**
     * Waits for every write [PersistentEnrollmentLifecycleAuditSink.append] has
     * launched into [scope] to actually finish.
     *
     * `append` is fire-and-forget by contract, and the Room suspend DAO it calls
     * suspends and resumes on Room's own multi-threaded query executor rather
     * than on this scope's dispatcher -- so `UnconfinedTestDispatcher` cannot
     * carry the write past that hop, and a read issued immediately afterwards
     * races it on a different pool thread. That race is what made this test fail
     * intermittently in CI (runs 34096395811 and 34097010233) while passing
     * locally and on the preceding tip.
     *
     * Joining the scope's children waits for the real write instead of assuming
     * it already happened. Nothing about what the test asserts changes: the
     * production sink still writes exactly as it does in production, and this
     * only removes the timing assumption from the observation of it.
     */
    private fun awaitPendingWrites() {
        runBlockingForTest { scope.coroutineContext.job.children.toList().joinAll() }
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

        awaitPendingWrites()

        val stored = repository.let { runBlockingForTest { it.getForDevice("device-1") } }
        assertEquals(1, stored.size)
        assertNull(stored[0].familyId)
        assertNull(stored[0].fromState)
        assertEquals("PAIRING_PENDING", stored[0].toState)
        assertEquals("actor-1", stored[0].actorId)
        assertEquals("first enrollment", stored[0].reason)
        assertEquals(1_700_000_000_000L, stored[0].occurredAtEpochMillis)
    }

    @Test
    fun `repository write failure stays contained in best effort sink without uncaught process failure`() {
        val uncaught = AtomicReference<Throwable?>(null)
        val handler = CoroutineExceptionHandler { _, failure -> uncaught.set(failure) }
        val failingScope = CoroutineScope(SupervisorJob() + UnconfinedTestDispatcher() + handler)
        val failingDao = object : EnrollmentLifecycleAuditDao {
            override suspend fun insert(entity: EnrollmentLifecycleAuditEntity) {
                throw IllegalStateException("database unavailable")
            }

            override suspend fun getForDevice(deviceId: String): List<EnrollmentLifecycleAuditEntity> = emptyList()
            override suspend fun count(): Int = 0
            override suspend fun deleteAll(): Int = 0
        }
        val failingSink = PersistentEnrollmentLifecycleAuditSink(
            EnrollmentLifecycleAuditRepository(failingDao),
            failingScope,
        )
        val record = EnrollmentLifecycleAuditRecord(
            familyId = null,
            deviceId = "device-1",
            actorId = "actor-1",
            fromState = null,
            toState = PairingState.PAIRING_PENDING,
            reason = "first enrollment",
            occurredAtUtc = Instant.ofEpochSecond(1_700_000_000),
        )

        try {
            failingSink.append(record)
            runBlockingForTest { failingScope.coroutineContext.job.children.toList().joinAll() }

            assertNull("best-effort DB failure must not reach the process exception handler", uncaught.get())
        } finally {
            failingScope.cancel()
        }
    }
}

private fun <T> runBlockingForTest(block: suspend () -> T): T =
    kotlinx.coroutines.runBlocking { block() }
