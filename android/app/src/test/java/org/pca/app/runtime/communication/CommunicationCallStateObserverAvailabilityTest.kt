package org.pca.app.runtime.communication

import org.junit.Assert.assertFalse
import org.junit.Test

class CommunicationCallStateObserverAvailabilityTest {
    @Test
    fun unavailableObserverDoesNotClaimCallTimingCapability() {
        assertFalse(NoOpCommunicationCallStateObserver.isAvailable())
    }
}
