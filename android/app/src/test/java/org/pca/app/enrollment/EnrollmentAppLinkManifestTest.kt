package org.pca.app.enrollment

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/** Guards the verified Android App Link filter against drifting from runtime enrollment parsing. */
class EnrollmentAppLinkManifestTest {
    private fun locate(relative: String): File = listOf(
        File(relative),
        File("app/$relative"),
        File("android/app/$relative"),
    ).firstOrNull(File::isFile)
        ?: error("Could not locate $relative from ${File(".").absolutePath}")

    private fun manifest(): org.w3c.dom.Document = DocumentBuilderFactory.newInstance()
        .apply { isNamespaceAware = true }
        .newDocumentBuilder()
        .parse(locate("src/main/AndroidManifest.xml"))

    private fun Element.android(name: String): String? = getAttributeNS(ANDROID_NS, name).takeIf(String::isNotEmpty)

    @Test
    fun `enrollment app link filter uses the exact configured HTTPS origin and narrow path prefix`() {
        val document = manifest()
        val activities = document.getElementsByTagName("activity")
        val enrollment = (0 until activities.length).map { activities.item(it) as Element }
            .single { it.android("name") == ".enrollment.EnrollmentActivity" }
        val filters = enrollment.getElementsByTagName("intent-filter")
        val verified = (0 until filters.length).map { filters.item(it) as Element }
            .single { it.android("autoVerify") == "true" }
        val actions = verified.getElementsByTagName("action")
        assertEquals(1, (0 until actions.length).count { (actions.item(it) as Element).android("name") == "android.intent.action.VIEW" })
        val categories = verified.getElementsByTagName("category")
        assertEquals(1, (0 until categories.length).count { (categories.item(it) as Element).android("name") == "android.intent.category.DEFAULT" })
        assertEquals(1, (0 until categories.length).count { (categories.item(it) as Element).android("name") == "android.intent.category.BROWSABLE" })

        val data = verified.getElementsByTagName("data")
        assertEquals("one narrow App Link data declaration", 1, data.length)
        val appLinkData = data.item(0) as Element
        assertEquals("https", appLinkData.android("scheme"))
        assertEquals("${'$'}{pcaChildAppLinkHost}", appLinkData.android("host"))
        assertEquals("${'$'}{pcaChildAppLinkPathPrefix}", appLinkData.android("pathPrefix"))
        assertFalse("The App Link must not claim an exact alternate path", appLinkData.hasAttributeNS(ANDROID_NS, "path"))
        assertFalse("The App Link must not broaden to path patterns", appLinkData.hasAttributeNS(ANDROID_NS, "pathPattern"))
        assertFalse("The App Link must not accept arbitrary content types", appLinkData.hasAttributeNS(ANDROID_NS, "mimeType"))
    }

    @Test
    fun `manifest placeholders and runtime parser share the same Gradle BuildConfig values`() {
        val gradle = locate("build.gradle.kts").readText()
        val deepLinkConfig = locate("src/main/java/org/pca/app/enrollment/EnrollmentDeepLinkConfig.kt").readText()
        val graph = locate("src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt").readText()

        assertTrue(gradle.contains("manifestPlaceholders[\"pcaChildAppLinkHost\"] = childAppLinkHost"))
        assertTrue(gradle.contains("manifestPlaceholders[\"pcaChildAppLinkPathPrefix\"] = childAppLinkPathPrefix"))
        assertTrue(gradle.contains("buildConfigField(\"String\", \"PCA_CHILD_APP_LINK_HOST\", \"\\\"${'$'}childAppLinkHost\\\"\")"))
        assertTrue(gradle.contains("buildConfigField(\"String\", \"PCA_CHILD_APP_LINK_PATH_PREFIX\", \"\\\"${'$'}childAppLinkPathPrefix\\\"\")"))
        assertTrue(deepLinkConfig.contains("const val APP_LINK_HOST = BuildConfig.PCA_CHILD_APP_LINK_HOST"))
        assertTrue(deepLinkConfig.contains("const val APP_LINK_PATH_PREFIX = BuildConfig.PCA_CHILD_APP_LINK_PATH_PREFIX"))
        assertTrue(graph.contains("appLinkHost = EnrollmentDeepLinkConfig.APP_LINK_HOST"))
        assertTrue(graph.contains("appLinkPathPrefix = EnrollmentDeepLinkConfig.APP_LINK_PATH_PREFIX"))

        val document = manifest()
        val activities = document.getElementsByTagName("activity")
        val enrollment = (0 until activities.length)
            .map { activities.item(it) as Element }
            .single { it.android("name") == ".enrollment.EnrollmentActivity" }
        val customFilters = enrollment.getElementsByTagName("intent-filter")
        val customSchemeFilter = (0 until customFilters.length).map { customFilters.item(it) as Element }
            .firstOrNull { it.android("autoVerify") == null && it.getElementsByTagName("data").length == 1 }
        assertNotNull("The compatibility custom-scheme filter remains available", customSchemeFilter)
        val customData = (customSchemeFilter!!.getElementsByTagName("data").item(0) as Element)
        assertEquals("pca", customData.android("scheme"))
        assertEquals("enroll", customData.android("host"))
    }

    private companion object {
        const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
    }
}
