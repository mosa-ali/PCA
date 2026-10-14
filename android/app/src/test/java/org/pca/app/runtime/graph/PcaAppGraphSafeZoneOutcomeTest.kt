package org.pca.app.runtime.graph

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryHttpFailure
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryIncompleteException
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryMalformedResponseException
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryAuthorityFailure
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryInboxCorruptException
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryRevisionConflictException
import org.pca.app.runtime.location.geofence.SafeZoneDeliveryPersistenceIoException
import org.pca.app.runtime.sync.RuntimeCustodyOutcome
import org.pca.app.foundation.PersistentStateStoreDurabilityFailure

class PcaAppGraphSafeZoneOutcomeTest {
    @Test fun `429 and server failures are retryable while auth and authority statuses block`() = runBlocking {
        for (status in listOf(408, 429, 500, 503, 599)) {
            assertEquals(
                RuntimeCustodyOutcome.RETRYABLE_FAILURE,
                synchronizeWithSafeZoneDelivery({ throw SafeZoneDeliveryHttpFailure(status) }) { RuntimeCustodyOutcome.COMPLETE },
            )
        }
        for (status in listOf(400, 401, 403, 404, 418)) {
            assertEquals(
                RuntimeCustodyOutcome.BLOCKED,
                synchronizeWithSafeZoneDelivery({ throw SafeZoneDeliveryHttpFailure(status) }) { RuntimeCustodyOutcome.COMPLETE },
            )
        }
    }

    @Test fun `transport and incomplete bounded page walk remain retryable`() = runBlocking {
        assertEquals(
            RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            synchronizeWithSafeZoneDelivery({ throw IOException("offline") }) { RuntimeCustodyOutcome.COMPLETE },
        )
        assertEquals(
            RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            synchronizeWithSafeZoneDelivery({ throw SafeZoneDeliveryIncompleteException("page_limit") }) { RuntimeCustodyOutcome.COMPLETE },
        )
    }

    @Test fun `known malformed response and storage I O failures remain pending`() = runBlocking {
        val retryable = listOf(
            SafeZoneDeliveryMalformedResponseException(),
            SafeZoneDeliveryPersistenceIoException(IOException("disk unavailable")),
            PersistentStateStoreDurabilityFailure(),
        )
        for (failure in retryable) {
            assertEquals(
                RuntimeCustodyOutcome.RETRYABLE_FAILURE,
                synchronizeWithSafeZoneDelivery({ throw failure }) { RuntimeCustodyOutcome.COMPLETE },
            )
        }
    }

    @Test fun `authority scope corruption and revision conflict remain blocked`() = runBlocking {
        val blocked = listOf(
            SafeZoneDeliveryAuthorityFailure(),
            SafeZoneDeliveryInboxCorruptException(),
            SafeZoneDeliveryRevisionConflictException(),
            IllegalStateException("Safe Zone delivery scope changed"),
        )
        for (failure in blocked) {
            assertEquals(
                RuntimeCustodyOutcome.BLOCKED,
                synchronizeWithSafeZoneDelivery({ throw failure }) { RuntimeCustodyOutcome.COMPLETE },
            )
        }
    }

    @Test fun `custody sync proceeds after safe zone failure but aggregate cannot claim complete`() = runBlocking {
        var custodyAttempted = false
        val result = synchronizeWithSafeZoneDelivery(
            fetchAndStage = { throw SafeZoneDeliveryHttpFailure(503) },
            custodySync = { custodyAttempted = true; RuntimeCustodyOutcome.COMPLETE },
        )
        assertTrue(custodyAttempted)
        assertEquals(RuntimeCustodyOutcome.RETRYABLE_FAILURE, result)
    }

    @Test fun `security failure blocks even if unrelated custody sync completes`() = runBlocking {
        var custodyAttempted = false
        val result = synchronizeWithSafeZoneDelivery(
            fetchAndStage = { throw SafeZoneDeliveryHttpFailure(403) },
            custodySync = { custodyAttempted = true; RuntimeCustodyOutcome.COMPLETE },
        )
        assertTrue(custodyAttempted)
        assertEquals(RuntimeCustodyOutcome.BLOCKED, result)
    }

    @Test fun `custody authority failure retains precedence and safe zone success preserves pending`() = runBlocking {
        assertEquals(
            RuntimeCustodyOutcome.BLOCKED,
            synchronizeWithSafeZoneDelivery({ throw IOException("offline") }) { RuntimeCustodyOutcome.BLOCKED },
        )
        assertEquals(
            RuntimeCustodyOutcome.MORE_PENDING,
            synchronizeWithSafeZoneDelivery({ }) { RuntimeCustodyOutcome.MORE_PENDING },
        )
    }

    @Test fun `unresolved ordinary Trust Set request retries without skipping independent custody sync`() = runBlocking {
        var custodyAttempted = false
        val result = synchronizeWithSafeZoneDelivery(
            fetchAndStage = { },
            ordinaryTrustSetOutcome = RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            custodySync = { custodyAttempted = true; RuntimeCustodyOutcome.COMPLETE },
        )
        assertTrue("opaque custody sync still runs", custodyAttempted)
        assertEquals(RuntimeCustodyOutcome.RETRYABLE_FAILURE, result)
    }

    @Test fun `blocked custody remains blocked when Trust Set has pending custody`() = runBlocking {
        val result = synchronizeWithSafeZoneDelivery(
            fetchAndStage = { },
            ordinaryTrustSetOutcome = RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            custodySync = { RuntimeCustodyOutcome.BLOCKED },
        )
        assertEquals(RuntimeCustodyOutcome.BLOCKED, result)
    }

    @Test fun `Trust Set reconciliation classifies pending and I O as retryable while integrity failures block`() = runBlocking {
        assertEquals(
            RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            ordinaryTrustSetReconciliationOutcome(reconcile = { }, hasPendingRequest = { true }),
        )
        assertEquals(
            RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            ordinaryTrustSetReconciliationOutcome(
                reconcile = { throw IOException("transient I/O") },
                hasPendingRequest = { throw AssertionError("pending read must not follow failed reconciliation") },
            ),
        )
        assertEquals(
            RuntimeCustodyOutcome.RETRYABLE_FAILURE,
            ordinaryTrustSetReconciliationOutcome(
                reconcile = { throw PersistentStateStoreDurabilityFailure() },
                hasPendingRequest = { throw AssertionError("pending read must not follow failed reconciliation") },
            ),
        )
        var custodyAttempted = false
        val blocked = ordinaryTrustSetReconciliationOutcome(
            reconcile = { throw IllegalStateException("root changed") },
            hasPendingRequest = { throw AssertionError("pending read must not follow failed reconciliation") },
        )
        assertEquals(RuntimeCustodyOutcome.BLOCKED, blocked)
        val aggregate = synchronizeWithSafeZoneDelivery(
            fetchAndStage = { },
            ordinaryTrustSetOutcome = blocked,
            custodySync = { custodyAttempted = true; RuntimeCustodyOutcome.COMPLETE },
        )
        assertTrue("independent custody still runs after a Trust Set block", custodyAttempted)
        assertEquals(RuntimeCustodyOutcome.BLOCKED, aggregate)
        assertEquals(
            RuntimeCustodyOutcome.BLOCKED,
            ordinaryTrustSetReconciliationOutcome(
                reconcile = { throw IllegalArgumentException("invalid signed chain") },
                hasPendingRequest = { false },
            ),
        )
    }

    @Test fun `Trust Set reconciliation propagates cancellation instead of retrying it`() = runBlocking {
        val cancelled = CancellationException("owner cancelled reconciliation")
        try {
            ordinaryTrustSetReconciliationOutcome(
                reconcile = { throw cancelled },
                hasPendingRequest = { false },
            )
            throw AssertionError("cancellation must propagate")
        } catch (actual: CancellationException) {
            assertTrue(actual === cancelled)
        }
    }

    @Test fun `committed Trust Set runtime construction failure is blocked without projecting a head`() = runBlocking {
        var projectedHead: String? = null
        val runtime = createOrdinaryTrustSetRuntimeOrNull<String> {
            throw IllegalStateException("committed epoch anchor is corrupt")
        }

        val outcome = ordinaryTrustSetRuntimeOutcome(
            runtimeAvailable = runtime != null,
            reconcile = { projectedHead = "server-head" },
            hasPendingRequest = { false },
        )

        assertEquals(RuntimeCustodyOutcome.BLOCKED, outcome)
        assertEquals("failed runtime construction cannot manufacture or reconcile an accepted head", null, projectedHead)
    }

    @Test fun `Trust Set reconciliation does not catch fatal JVM errors`() = runBlocking {
        val fatal = LinkageError("fatal Trust Set reconciliation failure")
        try {
            ordinaryTrustSetReconciliationOutcome(
                reconcile = { throw fatal },
                hasPendingRequest = { false },
            )
            throw AssertionError("fatal JVM errors must propagate")
        } catch (actual: LinkageError) {
            assertTrue(actual === fatal)
        }
    }

    @Test fun `cancellation is propagated and skips custody sync`() = runBlocking {
        var custodyAttempted = false
        val cancelled = runCatching {
            synchronizeWithSafeZoneDelivery(
                fetchAndStage = { throw CancellationException("cancelled") },
                custodySync = { custodyAttempted = true; RuntimeCustodyOutcome.COMPLETE },
            )
        }.exceptionOrNull()
        assertTrue(cancelled is CancellationException)
        assertFalse(custodyAttempted)
    }
}
