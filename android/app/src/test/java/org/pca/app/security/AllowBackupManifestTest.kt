package org.pca.app.security

import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * PCA-SEC-025 gap item 10: confirms `android:allowBackup="false"` (set at
 * the `<application>` level in `AndroidManifest.xml`) is genuinely in
 * effect, not merely present as unread XML text. This satisfies
 * PCA-SEC-025's fallback clause -- "exclude the entire app data directory"
 * from any OS-level backup mechanism (Auto Backup for Apps / adb backup) --
 * without any new production code: the flag was already correct, this
 * closes the gap by making that fact test-asserted rather than only
 * audit-observed.
 *
 * Reads the flag the OS itself would actually consult
 * ([ApplicationInfo.FLAG_ALLOW_BACKUP] via Robolectric's manifest-derived
 * [ApplicationInfo]), not a string/regex match against the manifest file --
 * a regex match can't distinguish "the flag is off" from "the attribute
 * moved to a different element" the way reading the parsed, OS-consumed
 * value can.
 */
@RunWith(RobolectricTestRunner::class)
class AllowBackupManifestTest {
    @Test
    fun `FLAG_ALLOW_BACKUP is not set on the application, satisfying PCA-SEC-025's data-directory-exclusion fallback`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val flags = context.applicationInfo.flags
        assertEquals(0, flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
    }
}
