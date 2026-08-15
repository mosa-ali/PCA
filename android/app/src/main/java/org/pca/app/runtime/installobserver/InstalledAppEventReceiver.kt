package org.pca.app.runtime.installobserver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.pca.app.PcaApplication
import org.pca.app.runtime.identity.DeviceIdentityState

/**
 * PCA-FR-045/PCA-FR-131 closure: install-approval/install-broadcast-visibility. Before this class
 * existed AND was registered in the manifest, no component in this app ever observed a new app
 * install at all -- there was no `BroadcastReceiver` for `PACKAGE_ADDED`/`PACKAGE_INSTALL`
 * anywhere in the codebase.
 *
 * Deliberately scoped conservatively, per this lane's own mission brief: doc 03 marks the full
 * install-APPROVAL workflow (a parent gate that can block/require sign-off on a new install) as
 * "PROPOSED, not committed." Building a real approval gate would additionally require (a) a
 * documented Android mechanism to actually BLOCK an install before it completes, which does not
 * exist for an ordinary (non device-owner) app -- see doc 06 Section 4's "Suspend selected
 * packages: UNSUPPORTED (no ordinary-app authority)" row, and even under Device Owner authority
 * `setPackagesSuspended` only suspends an ALREADY-installed package, it does not gate the install
 * itself -- and (b) a decided, backend-agreed approval-request/response protocol, neither of which
 * exists yet. So this class builds exactly the "clearly real value" half the brief calls out:
 * OBSERVE the install (via the documented `PACKAGE_ADDED` broadcast only -- no scraping, no
 * reverse-engineering, no polling `PackageManager` for a diff) and make it VISIBLE by recording it
 * through the app's normal, disclosed local-persistence path
 * ([org.pca.app.persistence.repository.InstalledAppEventRepository]), the same path every other
 * locally-observed event in this app (prayer reminders, tamper events, usage sessions) already
 * uses. It never silently collects anything beyond what a parent-facing "recently installed apps"
 * list would show (package name, best-effort label, install time) -- no permissions list, no APK
 * contents, no covert reporting channel. Cross-device delivery to the parent app is a separate,
 * already-existing crypto-gated sync pipeline (see [org.pca.app.runtime.graph.PcaAppGraph]'s
 * `familySyncRuntimePort` doc comment) this receiver does not attempt to bypass.
 *
 * Registered `android:exported="true"` in the manifest with a matching `<intent-filter>` for
 * `android.intent.action.PACKAGE_ADDED` plus `<data android:scheme="package"/>` -- required
 * because `PACKAGE_ADDED` is a system broadcast the OS itself sends, not one this app sends to
 * itself (contrast `PrayerReminderReceiver`, which IS self-sent and so stays `exported="false"`).
 * `EXTRA_REPLACING` is checked and app UPDATES are deliberately ignored -- this receiver reports
 * genuinely NEW installs only, matching "new app install" in both requirement IDs' titles, not
 * every version bump of an already-known app.
 */
class InstalledAppEventReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val packageName = newlyInstalledPackageNameOrNull(intent) ?: return

        val app = context.applicationContext as? PcaApplication ?: return
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { recordInstall(context, app, packageName) }
            pendingResult.finish()
        }
    }

    /**
     * Pure parsing/filter logic, split out for direct unit testing without an Android
     * `BroadcastReceiver`/coroutine context: returns the installed package name only for a genuine
     * new-install `PACKAGE_ADDED` broadcast (wrong action -> null; `EXTRA_REPLACING == true`
     * (an update, not a new install) -> null; missing/malformed package data -> null).
     */
    internal fun newlyInstalledPackageNameOrNull(intent: Intent): String? {
        if (intent.action != Intent.ACTION_PACKAGE_ADDED) return null
        if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return null
        return intent.data?.schemeSpecificPart?.takeIf { it.isNotBlank() }
    }

    /**
     * Doc 10-style local record only (see this class's own doc comment for the scope boundary).
     * Silently does nothing if the device has no PCA enrolled identity yet, matching every other
     * receiver/recorder in this app's "never fabricate an id" discipline
     * ([org.pca.app.runtime.prayer.PrayerReminderReceiver.recordDelivery] is the direct precedent).
     */
    private suspend fun recordInstall(context: Context, app: PcaApplication, packageName: String) {
        val graph = app.graph
        val deviceId = (graph.deviceIdentityProvider.currentIdentity() as? DeviceIdentityState.Enrolled)?.deviceId ?: return

        val (appLabel, firstInstallTimeMillis) = resolveAppMetadata(context, packageName)
        val nowMillis = graph.wallClockTimeSource.currentTimeMillis()

        graph.persistence.installedAppEventRepository.record(
            id = UUID.nameUUIDFromBytes("$deviceId|$packageName|$firstInstallTimeMillis".toByteArray(Charsets.UTF_8)).toString(),
            deviceId = deviceId,
            packageName = packageName,
            appLabel = appLabel,
            installedAtEpochMillis = firstInstallTimeMillis ?: nowMillis,
            observedAtEpochMillis = nowMillis,
        )
    }

    /** Best-effort `PackageManager` lookup -- both parts fall back safely (null label / no
     * install-time override) rather than crashing, since a package can already be gone again
     * (rapid install/uninstall) by the time this async recording step runs. */
    private fun resolveAppMetadata(context: Context, packageName: String): Pair<String?, Long?> {
        val pm = context.packageManager
        return try {
            val info = pm.getApplicationInfo(packageName, 0)
            val label = pm.getApplicationLabel(info)?.toString()
            val installTime = runCatching { pm.getPackageInfo(packageName, 0).firstInstallTime }.getOrNull()
            label to installTime
        } catch (e: PackageManager.NameNotFoundException) {
            null to null
        }
    }
}
