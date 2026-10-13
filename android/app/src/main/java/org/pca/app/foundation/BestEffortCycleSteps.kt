package org.pca.app.foundation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Executes independent suspend steps on a best-effort basis. Ordinary failures stay isolated so
 * later steps can run; cancellation remains lifecycle control and fatal JVM errors remain fatal.
 */
internal suspend fun runBestEffortCycleSteps(vararg steps: suspend () -> Unit) {
    val context = currentCoroutineContext()
    for (step in steps) {
        // Some independently scheduled cycle steps are synchronous/non-suspending. Honor job
        // cancellation between those steps even when the prior lambda returned normally.
        context.ensureActive()
        try {
            step()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Preserve the cycle's ordinary-failure isolation without swallowing cancellation or Error.
        }
    }
}
