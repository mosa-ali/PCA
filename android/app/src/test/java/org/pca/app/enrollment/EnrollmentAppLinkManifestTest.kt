package org.pca.app.enrollment

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    private fun elements(parent: Element, tag: String): List<Element> {
        val nodes = parent.getElementsByTagName(tag)
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    @Test
    fun `enrollment app link filter uses the exact configured HTTPS origin and narrow path prefix`() {
        val document = manifest()
        val enrollment = elements(document.documentElement, "activity")
            .single { it.android("name") == ".enrollment.EnrollmentActivity" }
        assertEquals("true", enrollment.android("exported"))

        val verified = elements(enrollment, "intent-filter")
            .single { it.android("autoVerify") == "true" }
        val actions = elements(verified, "action")
        assertEquals(1, actions.count { it.android("name") == "android.intent.action.VIEW" })
        val categories = elements(verified, "category")
        assertEquals(1, categories.count { it.android("name") == "android.intent.category.DEFAULT" })
        assertEquals(1, categories.count { it.android("name") == "android.intent.category.BROWSABLE" })

        val data = elements(verified, "data")
        assertEquals("one narrow App Link data declaration", 1, data.size)
        val appLinkData = data.single()
        assertEquals("https", appLinkData.android("scheme"))
        assertEquals("${'$'}{pcaChildAppLinkHost}", appLinkData.android("host"))
        assertEquals("${'$'}{pcaChildAppLinkPathPrefix}", appLinkData.android("pathPrefix"))
        assertFalse("The App Link must not claim an exact alternate path", appLinkData.hasAttributeNS(ANDROID_NS, "path"))
        assertFalse("The App Link must not broaden to path patterns", appLinkData.hasAttributeNS(ANDROID_NS, "pathPattern"))
        assertFalse("The App Link must not accept arbitrary content types", appLinkData.hasAttributeNS(ANDROID_NS, "mimeType"))

        val gradle = locate("build.gradle.kts").readText()
        val pathPrefix = Regex("""(?m)^val childAppLinkPathPrefix = "([^"]+)"$""")
            .find(gradle)?.groupValues?.get(1)
        assertEquals("The App Link path stays scoped to enrollment", "/enroll/", pathPrefix)
        assertTrue(gradle.contains("""manifestPlaceholders["pcaChildAppLinkPathPrefix"] = childAppLinkPathPrefix"""))
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
        val enrollment = elements(document.documentElement, "activity")
            .single { it.android("name") == ".enrollment.EnrollmentActivity" }
        val customSchemeFilter = elements(enrollment, "intent-filter").single { filter ->
            filter.android("autoVerify") == null && elements(filter, "data").any {
                it.android("scheme") == "pca" && it.android("host") == "enroll"
            }
        }
        val customData = elements(customSchemeFilter, "data").single {
            it.android("scheme") == "pca" && it.android("host") == "enroll"
        }
        assertEquals("pca", customData.android("scheme"))
        assertEquals("enroll", customData.android("host"))
    }

    private companion object {
        const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
    }
}
