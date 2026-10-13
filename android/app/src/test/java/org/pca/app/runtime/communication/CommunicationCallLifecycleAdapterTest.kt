package org.pca.app.runtime.communication

import org.junit.Assert.assertEquals
import org.junit.Test

class CommunicationCallLifecycleAdapterTest {
    private class FakeObserver : CommunicationCallStateObserver {
        var starts = 0
        var stops = 0
        var registrationSucceeds = true
        var callback: ((CommunicationExceptionCoordinator.CallState) -> Unit)? = null

        override fun start(onState: (CommunicationExceptionCoordinator.CallState) -> Unit): Boolean {
            starts += 1
            if (!registrationSucceeds) return false
            callback = onState
            return true
        }

        override fun stop() {
            stops += 1
            callback = null
        }
    }

    @Test
    fun `observer registration is idempotent and reversible`() {
        val observer = FakeObserver()
        val events = mutableListOf<String>()
        val adapter = CommunicationCallLifecycleAdapter(
            observer = observer,
            coordinator = CommunicationExceptionCoordinator(
                onCommunicationStarted = { events += "START" },
                onCommunicationEnded = { events += "END" },
                onCommunicationObservationUnavailable = { events += "UNAVAILABLE" },
            ),
        )

        adapter.start()
        adapter.start()
        observer.callback?.invoke(CommunicationExceptionCoordinator.CallState.OFFHOOK)
        observer.callback?.invoke(CommunicationExceptionCoordinator.CallState.IDLE)
        adapter.stop()
        adapter.stop()

        assertEquals(1, observer.starts)
        assertEquals(1, observer.stops)
        assertEquals(listOf("START", "END"), events)
    }

    @Test
    fun `unavailable registration releases restored exception and later call is a fresh lifecycle`() {
        val observer = FakeObserver().apply { registrationSucceeds = false }
        val events = mutableListOf<String>()
        val adapter = CommunicationCallLifecycleAdapter(
            observer = observer,
            coordinator = CommunicationExceptionCoordinator(
                onCommunicationStarted = { events += "START" },
                onCommunicationEnded = { events += "END" },
                onCommunicationObservationUnavailable = { events += "UNAVAILABLE" },
                initiallyActive = true,
            ),
        )

        adapter.start()
        assertEquals(listOf("UNAVAILABLE"), events)
        assertEquals(null, observer.callback)

        observer.registrationSucceeds = true
        adapter.start()
        observer.callback?.invoke(CommunicationExceptionCoordinator.CallState.OFFHOOK)
        observer.callback?.invoke(CommunicationExceptionCoordinator.CallState.IDLE)

        assertEquals(listOf("UNAVAILABLE", "START", "END"), events)
        assertEquals(2, observer.starts)
    }
}
