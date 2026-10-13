package org.pca.app.runtime.installobserver

import android.content.Intent
import android.net.Uri
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking

/**
 * PCA-FR-045/PCA-FR-131: coverage for [InstalledAppEventReceiver]'s pure parsing/filter logic
 * ([InstalledAppEventReceiver.newlyInstalledPackageNameOrNull]) plus the full [BroadcastReceiver]
 * negative paths that are safe to exercise under plain Robolectric (no real Room/enrollment state
 * needed for these -- they all return before touching persistence). Mirrors
 * `PrayerReminderReceiverTest`'s split between fast Robolectric-only ignore-path coverage here and
 * a full end-to-end positive case reserved for `androidTest` where real app resources/persistence
 * are available.
 */
@RunWith(RobolectricTestRunner::class)
class InstalledAppEventReceiverTest {

    private val receiver = InstalledAppEventReceiver()

    private fun packageAddedIntent(packageName: String, replacing: Boolean = false): Intent =
        Intent(Intent.ACTION_PACKAGE_ADDED, Uri.fromParts("package", packageName, null))
            .putExtra(Intent.EXTRA_REPLACING, replacing)

    @Test
    fun `a genuine new-install broadcast yields the installed package name`() {
        val intent = packageAddedIntent("com.example.newapp")
        assertEquals("com.example.newapp", receiver.newlyInstalledPackageNameOrNull(intent))
    }

    @Test
    fun `an app update -- EXTRA_REPLACING true -- is ignored, not treated as a new install`() {
        val intent = packageAddedIntent("com.example.existingapp", replacing = true)
        assertNull(receiver.newlyInstalledPackageNameOrNull(intent))
    }

    @Test
    fun `a broadcast with the wrong action is ignored`() {
        val intent = Intent("some.other.action", Uri.fromParts("package", "com.example.app", null))
        assertNull(receiver.newlyInstalledPackageNameOrNull(intent))
    }

    @Test
    fun `a PACKAGE_ADDED broadcast with no data URI is ignored, never crashes`() {
        val intent = Intent(Intent.ACTION_PACKAGE_ADDED)
        assertNull(receiver.newlyInstalledPackageNameOrNull(intent))
    }

    @Test
    fun `a PACKAGE_ADDED broadcast with a blank package name is ignored`() {
        val intent = Intent(Intent.ACTION_PACKAGE_ADDED, Uri.fromParts("package", "", null))
        assertNull(receiver.newlyInstalledPackageNameOrNull(intent))
    }

    @Test
    fun `onReceive on a wrong-action intent never throws and touches no persistence`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        // No enrolled identity exists in this test environment; if onReceive incorrectly tried to
        // reach persistence for a non-matching intent, this would be the first thing to surface it.
        receiver.onReceive(context, Intent("some.other.action"))
    }

    @Test
    fun `onReceive on an update -- EXTRA_REPLACING true -- never throws`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        receiver.onReceive(context, packageAddedIntent("com.example.existingapp", replacing = true))
    }

    @Test
    fun `metadata lookup failure uses null metadata and still finishes the broadcast`() = runBlocking {
        var recorded: Pair<String?, Long?>? = null
        var approvalHandled = false
        var finished = false

        runInstallBroadcastSteps(
            resolveMetadata = { throw SecurityException("package metadata unavailable") },
            recordInstall = { label, installedAt -> recorded = label to installedAt },
            handleApproval = { label, installedAt ->
                assertNull(label)
                assertNull(installedAt)
                approvalHandled = true
            },
            finish = { finished = true },
        )

        assertEquals(null to null, recorded)
        assertTrue(approvalHandled)
        assertTrue(finished)
    }

    @Test
    fun `ordinary step failure does not suppress the other step and still finishes`() = runBlocking {
        var approvalHandled = false
        var finished = false

        runInstallBroadcastSteps(
            resolveMetadata = { "New Game" to 42L },
            recordInstall = { _, _ -> throw IllegalStateException("local persistence unavailable") },
            handleApproval = { label, installedAt ->
                assertEquals("New Game", label)
                assertEquals(42L, installedAt)
                approvalHandled = true
            },
            finish = { finished = true },
        )

        assertTrue(approvalHandled)
        assertTrue(finished)
    }

    @Test
    fun `cancellation propagates and still finishes the broadcast`() {
        var approvalHandled = false
        var finished = false

        assertThrows(CancellationException::class.java) {
            runBlocking {
                runInstallBroadcastSteps(
                    resolveMetadata = { "New Game" to 42L },
                    recordInstall = { _, _ -> throw CancellationException("cancelled") },
                    handleApproval = { _, _ -> approvalHandled = true },
                    finish = { finished = true },
                )
            }
        }

        assertTrue(!approvalHandled)
        assertTrue(finished)
    }

    @Test
    fun `fatal JVM error propagates and still finishes the broadcast`() {
        var approvalHandled = false
        var finished = false

        assertThrows(AssertionError::class.java) {
            runBlocking {
                runInstallBroadcastSteps(
                    resolveMetadata = { "New Game" to 42L },
                    recordInstall = { _, _ -> throw AssertionError("fatal persistence failure") },
                    handleApproval = { _, _ -> approvalHandled = true },
                    finish = { finished = true },
                )
            }
        }

        assertTrue(!approvalHandled)
        assertTrue(finished)
    }

    @Test
    fun `optional metadata lookup falls back only for ordinary exceptions`() {
        assertEquals(42L, bestEffortInstallMetadata { 42L })
        assertNull(bestEffortInstallMetadata<Long> { throw SecurityException("permission denied") })

        assertThrows(CancellationException::class.java) {
            bestEffortInstallMetadata<Long> { throw CancellationException("cancelled") }
        }
        assertThrows(AssertionError::class.java) {
            bestEffortInstallMetadata<Long> { throw AssertionError("fatal metadata failure") }
        }
    }
}
