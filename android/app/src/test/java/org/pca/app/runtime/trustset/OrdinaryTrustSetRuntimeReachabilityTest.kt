package org.pca.app.runtime.trustset

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the production call chain against the coordinator becoming test-only scaffolding. */
class OrdinaryTrustSetRuntimeReachabilityTest {
    @Test fun `background custody cycle creates and drives root-bound Trust Set runtime`() {
        val main = mainSourceDir()
        val graph = File(main, "java/org/pca/app/runtime/graph/PcaAppGraph.kt").readText()
        val worker = File(main, "java/org/pca/app/runtime/background/UsageIngestionWorker.kt").readText()
        val application = File(main, "java/org/pca/app/PcaApplication.kt").readText()

        assertTrue("application startup starts the process-wide graph", Regex("graph\\.start\\(\\)").containsMatchIn(application))
        assertTrue("startup loop reaches the graph custody synchronizer", Regex("synchronize = \\{ synchronizeRuntimeCustody\\(\\) \\}").containsMatchIn(graph))
        assertTrue(graph.contains("OrdinaryTrustSetRuntime.create("))
        assertTrue(graph.contains("PersistentOrdinaryEpochStore(runtimeStateStore)"))
        assertTrue(graph.contains("HttpOrdinaryTrustSetApi(\"https://api.pcasafe.com\", session)"))
        assertTrue(graph.contains("signer = androidKeystoreDskProvider"))
        assertTrue(graph.contains("verifier = P256OrdinaryEpochVerifier()"))
        assertTrue(Regex("\\btrustSetRuntime\\.reconcile\\(\\)").containsMatchIn(graph))
        assertTrue(Regex("\\btrustSetRuntime\\.hasPendingRequest\\(\\)").containsMatchIn(graph))
        assertTrue(graph.contains("ordinaryTrustSetOutcome = ordinaryTrustSetReconciliationOutcome("))
        assertTrue(graph.contains("if (custodyDeviceId != deviceId || custodyRoot != root)"))
        assertTrue(Regex("\\bgraph\\.synchronizeRuntimeCustody\\(\\)").containsMatchIn(worker))
        assertTrue(worker.contains("outcome == RuntimeCustodyOutcome.MORE_PENDING || outcome == RuntimeCustodyOutcome.RETRYABLE_FAILURE"))
        assertTrue("the runtime must not self-activate devices", !graph.contains("trustSetRuntime.activate"))
    }

    private fun mainSourceDir(): File {
        val candidates = listOf(File("src/main"), File("android/app/src/main"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate src/main directory from ${File(".").absolutePath}")
    }
}
