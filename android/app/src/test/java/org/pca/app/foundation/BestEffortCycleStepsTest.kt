package org.pca.app.foundation

import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Test

class BestEffortCycleStepsTest {

    @Test
    fun `cancellation between normally returning steps prevents later work`() = runTest {
        var laterStepRan = false

        val job = launch {
            runBestEffortCycleSteps(
                { currentCoroutineContext().cancel() },
                { laterStepRan = true },
            )
        }
        job.join()

        assertFalse("a canceled cycle must not enter the next step", laterStepRan)
    }
}
