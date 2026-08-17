package org.pca.app.runtime.communication

import org.junit.Assert.assertEquals
import org.junit.Test

class CommunicationExceptionCoordinatorTest {
    private fun eventsFor(vararg states: CommunicationExceptionCoordinator.CallState): List<String> {
        val events = mutableListOf<String>()
        val coordinator = CommunicationExceptionCoordinator(
            onCommunicationStarted = { events += "START" },
            onCommunicationEnded = { events += "END" },
        )
        states.forEach(coordinator::onCallState)
        return events
    }

    @Test
    fun `unanswered ringing never starts or ends a recovery exception`() {
        assertEquals(
            emptyList<String>(),
            eventsFor(
                CommunicationExceptionCoordinator.CallState.RINGING,
                CommunicationExceptionCoordinator.CallState.IDLE,
            ),
        )
    }

    @Test
    fun `answered call starts only at offhook and ends at idle`() {
        assertEquals(
            listOf("START", "END"),
            eventsFor(
                CommunicationExceptionCoordinator.CallState.RINGING,
                CommunicationExceptionCoordinator.CallState.OFFHOOK,
                CommunicationExceptionCoordinator.CallState.IDLE,
            ),
        )
    }

    @Test
    fun `offhook without ringing is still a complete answered-call lifecycle`() {
        assertEquals(
            listOf("START", "END"),
            eventsFor(
                CommunicationExceptionCoordinator.CallState.OFFHOOK,
                CommunicationExceptionCoordinator.CallState.IDLE,
            ),
        )
    }

    @Test
    fun `duplicate offhook and idle do not duplicate callbacks`() {
        assertEquals(
            listOf("START", "END"),
            eventsFor(
                CommunicationExceptionCoordinator.CallState.OFFHOOK,
                CommunicationExceptionCoordinator.CallState.OFFHOOK,
                CommunicationExceptionCoordinator.CallState.IDLE,
                CommunicationExceptionCoordinator.CallState.IDLE,
            ),
        )
    }

    @Test
    fun `rapid ringing active ringing idle preserves one active-call exception`() {
        assertEquals(
            listOf("START", "END"),
            eventsFor(
                CommunicationExceptionCoordinator.CallState.RINGING,
                CommunicationExceptionCoordinator.CallState.OFFHOOK,
                CommunicationExceptionCoordinator.CallState.RINGING,
                CommunicationExceptionCoordinator.CallState.OFFHOOK,
                CommunicationExceptionCoordinator.CallState.IDLE,
            ),
        )
    }
}
