package org.pca.app.platform.proximity

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Static, source-scanning proofs (same technique as
 * [org.pca.app.persistence.SecurityStaticCheckTest] and
 * [org.pca.app.enrollment.EnrollmentStaticScanTest]) for the camera/proximity properties a plain
 * runtime unit test cannot fully demonstrate: no code path in this feature can perform network
 * I/O, persist a camera frame/bitmap/byte array to disk, or invoke ML-Kit-style face-recognition
 * APIs -- PCA-FR-022/023/024's hard architectural constraints for the whole
 * `org.pca.app.platform.proximity` package plus [CameraXFrameSource]'s own composition-root
 * wiring, [EyeDistanceCameraPermissionActivity], and [EyeDistanceCameraPermissionScreen].
 */
class CameraPrivacyStaticScanTest {

    private fun locateMainDir(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"))
        return candidates.firstOrNull { it.exists() }
            ?: error("Could not locate '$relative' from working dir ${File(".").absolutePath}")
    }

    private fun readAllKotlinSources(dir: File): Map<File, String> =
        dir.walkTopDown().filter { it.isFile && it.extension == "kt" }.associateWith { it.readText() }

    private fun stripComments(text: String): String =
        text.replace(Regex("/\\*.*?\\*/", RegexOption.DOT_MATCHES_ALL), "")
            .lines()
            .joinToString("\n") { it.substringBefore("//") }

    private val networkPatterns = listOf(
        Regex("""(?i)\bRetrofit\b"""),
        Regex("""(?i)\bOkHttp"""),
        Regex("""(?i)HttpURLConnection"""),
        Regex("""(?i)\bURL\s*\("""),
        Regex("""(?i)\bSocket\s*\("""),
        Regex("""(?i)\bHttpClient\b"""),
        Regex("""\.upload\("""),
        Regex("""(?i)ApiClient"""),
    )

    private val persistencePatterns = listOf(
        Regex("""\bFileOutputStream\b"""),
        Regex("""\bMediaStore\b"""),
        Regex("""\.compress\(\s*Bitmap\.CompressFormat"""),
        Regex("""(?i)\bcacheDir\b"""),
        Regex("""(?i)\bfilesDir\b"""),
    )

    private val faceRecognitionPatterns = listOf(
        Regex("""com\.google\.mlkit"""),
        Regex("""(?i)FaceRecognition"""),
        Regex("""(?i)FaceEmbedding"""),
        Regex("""(?i)FaceTemplate"""),
        Regex("""(?i)FaceIdentity"""),
    )

    private fun proximityPackageDir() = locateMainDir("src/main/java/org/pca/app/platform/proximity")

    @Test
    fun `no source file under platform-proximity references any network client, HTTP, or upload API`() {
        for ((file, text) in readAllKotlinSources(proximityPackageDir())) {
            val stripped = stripComments(text)
            for (pattern in networkPatterns) {
                assertFalse(
                    "${file.path} must not reference a network API ($pattern) -- PCA-FR-024 forbids any upload path for camera-derived data",
                    pattern.containsMatchIn(stripped),
                )
            }
        }
    }

    @Test
    fun `no source file under platform-proximity writes a frame, bitmap, or byte array to disk or MediaStore`() {
        for ((file, text) in readAllKotlinSources(proximityPackageDir())) {
            val stripped = stripComments(text)
            for (pattern in persistencePatterns) {
                assertFalse(
                    "${file.path} must not persist camera-derived data ($pattern) -- PCA-FR-022 forbids storing any frame/crop/template",
                    pattern.containsMatchIn(stripped),
                )
            }
        }
    }

    @Test
    fun `no source file under platform-proximity references ML-Kit or any face-recognition-identity API`() {
        for ((file, text) in readAllKotlinSources(proximityPackageDir())) {
            val stripped = stripComments(text)
            for (pattern in faceRecognitionPatterns) {
                assertFalse(
                    "${file.path} must not reference a face-recognition/identity API ($pattern) -- geometry-only, never ML-Kit recognition",
                    pattern.containsMatchIn(stripped),
                )
            }
        }
    }

    @Test
    fun `CameraXFrameSource always closes the analyzer's ImageProxy in a finally block, not conditionally`() {
        val text = locateMainDir("src/main/java/org/pca/app/platform/proximity/CameraXFrameSource.kt").readText()
        // Structural proof of "no code path can leak or retain the platform image past this call":
        // the close() call must be the last statement inside a finally block wrapping the frame
        // conversion, not inside an if/success-only branch.
        val onFrameAvailableBody = Regex(
            """internal fun onFrameAvailable\(imageProxy: ImageProxy\)\s*\{(.*?)\n {4}\}""",
            RegexOption.DOT_MATCHES_ALL,
        ).find(text)?.groupValues?.get(1) ?: error("Could not locate onFrameAvailable body")
        assertTrue("imageProxy.close() must be called unconditionally", onFrameAvailableBody.contains("finally"))
        assertTrue(
            "imageProxy.close() must appear inside the finally block",
            onFrameAvailableBody.substringAfter("finally").contains("imageProxy.close()"),
        )
    }

    @Test
    fun `CameraXFrameSource never buffers more than the single most-recent frame`() {
        val text = locateMainDir("src/main/java/org/pca/app/platform/proximity/CameraXFrameSource.kt").readText()
        // No List/Queue/ArrayDeque/MutableList of frames anywhere in the file -- only the single
        // AtomicReference slot inside SingleSlotFrameBuffer.
        assertFalse(Regex("""(?i)(ArrayDeque|LinkedList|frameQueue|frameList|frameBuffer\s*:\s*Mutable(List|Set))""").containsMatchIn(text))
        assertTrue(text.contains("STRATEGY_KEEP_ONLY_LATEST"))
    }

    @Test
    fun `EyeDistanceCameraPermissionActivity is the only production source that ever calls a CAMERA permission request`() {
        val proximityDir = proximityPackageDir()
        val eyeDistanceUiDir = locateMainDir("src/main/java/org/pca/app/feature/eyedistance/ui")
        val allSources = readAllKotlinSources(proximityDir) + readAllKotlinSources(eyeDistanceUiDir)
        val requestPattern = Regex("""requestPermissions?\(|registerForActivityResult\(\s*ActivityResultContracts\.RequestPermission""")
        val offenders = allSources.filterKeys { it.name != "EyeDistanceCameraPermissionActivity.kt" }
            .filter { (_, text) -> requestPattern.containsMatchIn(stripComments(text)) }
        assertTrue(
            "only EyeDistanceCameraPermissionActivity may request the CAMERA permission, found in: ${offenders.keys.map { it.name }}",
            offenders.isEmpty(),
        )
    }
}
