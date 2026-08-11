package org.pca.app.feature.wellbeing.privacy

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Privacy tests (PCA-WELL brief): a lightweight static scan of this module's main sources rather
 * than a full instrumented log-capture harness (no Robolectric/log-capture infra exists in this
 * project yet). Confirms two structural invariants that a code reviewer would otherwise have to
 * re-verify by hand every change:
 *
 * 1. No file under the wellbeing feature package (main sources) imports `android.util.Log` -- the module
 *    has zero logging surface, so there is no code path that could leak a suggestion/app-token/
 *    faith-preference/custom-text sentinel into logcat.
 * 2. The notification delivery's PUBLIC (lock-screen-visible) notification builder never
 *    references the resolved suggestion text ([WellbeingNotificationDelivery]'s `fullText`
 *    variable) -- only the generic/redacted string resources.
 */
class WellbeingPrivacyStaticScanTest {

    private fun mainSourceRoot(): File? {
        val candidates = listOf(
            "src/main/java/org/pca/app/feature/wellbeing",
            "android/app/src/main/java/org/pca/app/feature/wellbeing",
            "app/src/main/java/org/pca/app/feature/wellbeing",
        )
        return candidates.map { File(it) }.firstOrNull { it.isDirectory }
    }

    @Test
    fun `no source file in the wellbeing module imports android util Log`() {
        val root = mainSourceRoot()
        assumeTrue("could not locate feature/wellbeing main sources from test working directory", root != null)
        val offenders = root!!.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains("android.util.Log") }
            .toList()
        assertTrue("files importing android.util.Log: $offenders", offenders.isEmpty())
    }

    @Test
    fun `public notification builder never references the resolved suggestion text`() {
        val root = mainSourceRoot()
        assumeTrue("could not locate feature/wellbeing main sources from test working directory", root != null)
        val deliveryFile = File(root, "delivery/WellbeingNotificationDelivery.kt")
        assumeTrue("delivery file not found", deliveryFile.isFile)
        val text = deliveryFile.readText()

        val publicBuilderStart = text.indexOf("publicVersion")
        val notificationBuilderStart = text.indexOf("val notification =")
        assertTrue(publicBuilderStart in 0 until notificationBuilderStart)

        val publicBuilderBlock = text.substring(publicBuilderStart, notificationBuilderStart)
        assertFalse("public/lock-screen notification block must never reference fullText", publicBuilderBlock.contains("fullText"))
    }
}
