package org.pca.app.runtime.communication

import org.junit.Assert.assertEquals
import org.junit.Test

class CommunicationExceptionCoordinatorTest {
    @Test
    fun `ringing and offhook share one ordinary communication exception until idle`() {
        val events = mutableListOf<String>()
        val coordinator = CommunicationExceptionCoordinator(
            onCommunicationStarted = { events += "START" },
            onCommunicationEnded = { events += "END" },
        )

        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.RINGING)
        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.OFFHOOK)
        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.IDLE)
        coordinator.onCallState(CommunicationExceptionCoordinator.CallState.IDLE)

        assertEquals(listOf("START", "END"), events)
    }
}
