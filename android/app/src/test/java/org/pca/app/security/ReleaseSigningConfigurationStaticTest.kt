package org.pca.app.security

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the release-build signing boundary: signing secrets are supplied externally, but an
 * accidental partial secret configuration must never silently downgrade a signed release build to
 * an unsigned artifact. */
class ReleaseSigningConfigurationStaticTest {

    private fun buildScript(): String {
        val candidates = listOf(
            File("build.gradle.kts"),
            File("app/build.gradle.kts"),
            File("android/app/build.gradle.kts"),
            File("build.gradle.kts").takeIf { File("settings.gradle.kts").isFile }
                ?.resolveSibling("app/build.gradle.kts"),
        ).filterNotNull()
        return candidates.firstOrNull { it.isFile }?.readText()
            ?: error("Could not locate android/app/build.gradle.kts from ${File(".").absolutePath}")
    }

    @Test
    fun `release signing rejects partial credentials and missing keystore files`() {
        val source = buildScript()
        for (name in listOf(
            "PCA_RELEASE_KEYSTORE_PATH",
            "PCA_RELEASE_KEYSTORE_PASSWORD",
            "PCA_RELEASE_KEY_ALIAS",
            "PCA_RELEASE_KEY_PASSWORD",
        )) {
            assertTrue("release signing config no longer reads $name", source.contains(name))
        }
        assertTrue(source.contains("releaseSigningValues.any { !it.isNullOrBlank() }"))
        assertTrue(source.contains("releaseSigningValues.all { !it.isNullOrBlank() }"))
        assertTrue(source.contains("require(!hasAnyReleaseSigningValue || hasReleaseSigning)"))
        assertTrue(source.contains("file(releaseKeystorePath!!).isFile"))
    }

    @Test
    fun `android package version is pipeline-configurable and validates supplied values`() {
        val source = buildScript()
        assertTrue(source.contains("PCA_ANDROID_VERSION_CODE"))
        assertTrue(source.contains("PCA_ANDROID_VERSION_NAME"))
        assertTrue(source.contains("val androidVersionCodePattern = Regex(\"^[1-9][0-9]{0,9}$\")"))
        assertTrue(source.contains("it in 1..2_100_000_000"))
        assertTrue(source.contains("configuredAndroidVersionCode == null"))
        assertTrue(source.contains("configuredAndroidVersionName == null) \"0.1.0\""))
        assertTrue(source.contains("versionCode = androidVersionCode"))
        assertTrue(source.contains("versionName = androidVersionName"))
        assertTrue(source.contains("androidVersionName.length <= 64"))
        assertTrue(source.contains("androidVersionName.none { it.isISOControl() }"))
    }
}
