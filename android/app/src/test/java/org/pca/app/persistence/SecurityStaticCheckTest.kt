package org.pca.app.persistence

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-LOCAL-DB-1 Section 29: static proof this module's entities cannot
 * hold prohibited content. Scans the actual `entity/` source files rather
 * than asserting from memory, so a future entity addition that reintroduces
 * a forbidden field fails this test immediately.
 */
class SecurityStaticCheckTest {
    private val entityDir = locateEntityDir()

    private fun locateEntityDir(): File {
        val relative = "src/main/java/org/pca/app/persistence/entity"
        return listOf(File(relative), File("app/$relative")).firstOrNull { it.exists() }
            ?: error("Could not locate persistence/entity source directory from working dir ${File(".").absolutePath}")
    }

    /**
     * Strips `/* */` and `//` comments before scanning -- KDoc explaining
     * WHY a forbidden concept is deliberately absent (e.g. "no biometric
     * derivative", ProximityEventEntity's own doc comment) is exactly the
     * kind of documentation this module should have, and must not itself
     * trip the check that only cares about actual field declarations.
     */
    private fun entitySources(): List<String> =
        entityDir.listFiles { f -> f.extension == "kt" }!!.map { file ->
            file.readText()
                .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
                .lines()
                .joinToString("\n") { it.substringBefore("//") }
        }

    private val forbiddenPatterns = listOf(
        Regex("(?i)privateKey"),
        Regex("(?i)recoverySecret"),
        Regex("(?i)cameraFrame"),
        Regex("(?i)faceLandmark"),
        Regex("(?i)faceTemplate"),
        Regex("(?i)biometric"),
        Regex("(?i)microphone"),
        Regex("(?i)\\bpassword\\b"),
        Regex("(?i)\\bcredential\\b"),
    )

    @Test
    fun `no entity source file declares a prohibited field name`() {
        for (source in entitySources()) {
            for (pattern in forbiddenPatterns) {
                assertFalse("Forbidden pattern '$pattern' found in an entity source file:\n$source", pattern.containsMatchIn(source))
            }
        }
    }

    @Test
    fun `sensitive doc-10 fields are declared as encrypted column pairs, not plain String`() {
        val familyMember = File(entityDir, "FamilyMemberEntity.kt").readText()
        assertTrue(familyMember.contains("displayNameEnc"))
        assertTrue(familyMember.contains("displayNameIv"))

        val webVisit = File(entityDir, "WebVisitEntity.kt").readText()
        assertTrue(webVisit.contains("domainEnc") && webVisit.contains("domainIv"))
        assertTrue(webVisit.contains("urlEnc") && webVisit.contains("urlIv"))

        val location = File(entityDir, "LocationPointEntity.kt").readText()
        assertTrue(location.contains("latitudeEnc") && location.contains("latitudeIv"))
        assertTrue(location.contains("longitudeEnc") && location.contains("longitudeIv"))

        val usageSession = File(entityDir, "UsageSessionEntity.kt").readText()
        assertTrue(usageSession.contains("appOrCategoryTokenEnc") && usageSession.contains("appOrCategoryTokenIv"))

        // PCA-LOCAL-DB-1 Section 8: an installed package name / app label is the SAME class of
        // family-sensitive value UsageSessionEntity's own comment says must be encrypted ("an
        // app/category identifier can be family-sensitive"). Both were stored in plaintext until
        // MIGRATION_5_6; this assertion is what stops that regressing.
        val installedApp = File(entityDir, "InstalledAppEventEntity.kt").readText()
        assertTrue(installedApp.contains("packageNameEnc") && installedApp.contains("packageNameIv"))
        assertTrue(installedApp.contains("appLabelEnc") && installedApp.contains("appLabelIv"))
    }

    /**
     * The companion to the positive assertion above: a plain `val packageName: String` / `val
     * appLabel: String?` column on the installed-app entity IS the defect, so the plaintext field
     * declarations must be structurally absent, not merely accompanied by encrypted ones.
     */
    @Test
    fun `the installed-app entity declares no plaintext package name or app label column`() {
        val installedApp = entityDir.resolve("InstalledAppEventEntity.kt").readText()
            .replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
            .lines()
            .joinToString("\n") { it.substringBefore("//") }

        assertFalse(Regex("""\bval\s+packageName\s*:""").containsMatchIn(installedApp))
        assertFalse(Regex("""\bval\s+appLabel\s*:""").containsMatchIn(installedApp))
    }

    @Test
    fun `proximity entity has no field capable of holding an image or numeric distance`() {
        val proximity = File(entityDir, "ProximityEventEntity.kt").readText()
        assertFalse(proximity.contains("Bitmap"))
        assertFalse(proximity.contains("ByteArray"))
        assertTrue(proximity.contains("ProximityBucket")) // bucketed enum only
    }

    @Test
    fun `content block event has no field capable of holding blocked media`() {
        val contentBlock = File(entityDir, "ContentBlockEventEntity.kt").readText()
        assertFalse(contentBlock.contains("Bitmap"))
        assertFalse(contentBlock.contains("ByteArray"))
        assertFalse(contentBlock.contains("blockedContent", ignoreCase = true))
    }
}
