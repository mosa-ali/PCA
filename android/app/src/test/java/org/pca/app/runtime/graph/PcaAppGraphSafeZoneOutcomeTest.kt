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
