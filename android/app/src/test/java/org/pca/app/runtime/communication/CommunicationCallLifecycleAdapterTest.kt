package org.pca.app.runtime.communication

import org.junit.Assert.assertEquals
import org.junit.Test

class CommunicationCallLifecycleAdapterTest {
    private class FakeObserver : CommunicationCallStateObserver {
        var starts = 0
        var stops = 0
        var callback: ((CommunicationExceptionCoordinator.CallState) -> Unit)? = null

        override fun start(onState: (CommunicationExceptionCoordinator.CallState) -> Unit) {
            starts += 1
            callback = onState
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
}
