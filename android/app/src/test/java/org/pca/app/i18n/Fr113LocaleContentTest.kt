package org.pca.app.i18n

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-FR-113: child-facing Android notices remain localized and capability-honest.
 * Key parity is covered by StringResourceCompletenessTest; these assertions protect the
 * contextual meaning of the English/Arabic values that must not drift into family-wide or
 * unsupported YouTube claims.
 */
class Fr113LocaleContentTest {
    @Test
    fun `safe browser degraded notice addresses the child device to its parent settings`() {
        val english = read("res/values/strings.xml")
        val arabic = read("res/values-ar/strings.xml")

        assertTrue(english.contains("parent\\'s settings"))
        assertFalse(english.contains("children\\'s settings"))
        assertTrue(arabic.contains("إعدادات والديك"))
        assertFalse(arabic.contains("إعدادات أطفالك"))
    }

    @Test
    fun `YouTube notices distinguish app usage from PCA controlled playback`() {
        val english = read("res/values/strings.xml")
        val arabic = read("res/values-ar/strings.xml")

        assertTrue(english.contains("Mode A: App usage only"))
        assertTrue(english.contains("does not show a video list or search history"))
        assertTrue(english.contains("Mode B: PCA-controlled playback"))
        assertTrue(english.contains("started inside that player only"))
        assertFalse(english.contains("which videos were watched"))

        assertTrue(arabic.contains("النمط A: استخدام التطبيق فقط"))
        assertTrue(arabic.contains("ولا يعرض قائمة فيديوهات أو سجل بحث"))
        assertTrue(arabic.contains("النمط B: تشغيل يتحكم فيه PCA"))
        assertTrue(arabic.contains("التي تبدأ داخله فقط"))
        assertFalse(arabic.contains("الفيديوهات المحددة التي تمت مشاهدتها"))
    }

    @Test
    fun `removal decision notice remains scoped to this device and separate from history deletion`() {
        val english = read("res/values/strings.xml")
        val arabic = read("res/values-ar/strings.xml")

        assertTrue(english.contains("This decision changes protection on this device only"))
        assertTrue(english.contains("does not by itself delete activity history"))
        assertTrue(arabic.contains("يغيّر هذا القرار الحماية على هذا الجهاز فقط"))
        assertTrue(arabic.contains("ولا يحذف بحد ذاته سجل النشاط"))
    }

    private fun read(relative: String): String {
        val candidates = listOf(File("src/main/$relative"), File("android/app/src/main/$relative"))
        return candidates.firstOrNull { it.isFile }?.readText()
            ?: error("$relative was not found")
    }
}
