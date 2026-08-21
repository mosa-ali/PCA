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
 * ORIGINAL SCOPE (superseded below): this class was first built deliberately conservatively,
 * because doc 03 then marked the full install-APPROVAL workflow "PROPOSED, not committed" -- it
 * only observed and locally recorded installs, with no approval request and no enforcement
 * attempt. The owner has since made the standing architectural decision
 * CAPABILITY_HONEST_INSTALL_APPROVAL (doc 03's PCA-FR-131 entry is now committed under that
 * decision), so this class now ALSO drives the real approval-request/enforcement flow below --
 * the observation half (OBSERVE via the documented `PACKAGE_ADDED` broadcast only -- no scraping,
 * no reverse-engineering, no polling `PackageManager` for a diff -- and record locally through
 * [org.pca.app.persistence.repository.InstalledAppEventRepository], the same path every other
 * locally-observed event in this app already uses) is UNCHANGED from the original scope.
 *
 * What's new (via [org.pca.app.feature.installapproval.InstallApprovalController]):
 *  - The device's CURRENT, honestly-resolved [org.pca.app.feature.installapproval.InstallApprovalCapabilityState]
 *    is computed live (never cached) from the SAME Device Owner authority gate every other real
 *    enforcement path in this app already uses (doc 06 Section 4/7) -- never a fabricated
 *    capability.
 *  - ONLY when that capability is genuinely ENFORCED (real, proven Device Owner authority) is the
 *    newly-installed package immediately quarantined (suspended, via the SAME
 *    `PackageSuspensionExecutor`/`setPackagesSuspended` doc 06 already documents for schedule
 *    enforcement) pending the parent's decision -- this is the closest genuinely real analog to
 *    "install approval enforcement" Android's documented API surface allows, since Android
 *    provides NO mechanism (even under Device Owner) to gate the install action itself, only to
 *    suspend an already-installed package (see [InstallApprovalController]'s own doc comment).
 *    This class never claims the install itself was blocked.
 *  - A real INSTALL_APPROVAL child request is always created (via
 *    [org.pca.app.runtime.PcaRuntime.createChildRequest], the SAME offline-safe, PENDING_SYNC_LOCAL
 *    path `BONUS_TIME` already uses -- see `ChildHomeScreen.kt`'s own doc comment on that reuse),
 *    REGARDLESS of capability: a REQUEST_ONLY/AUTHORIZATION_REQUIRED/NOT_SUPPORTED device still
 *    honestly reports the install and still lets a parent decide, it just cannot itself enforce
 *    that decision. Cross-device delivery of the request/decision is the SAME pre-existing,
 *    separate, crypto-gated sync pipeline this receiver still does not attempt to bypass (see
 *    [org.pca.app.runtime.graph.PcaAppGraph]'s `familySyncRuntimePort` doc comment;
 *    [org.pca.app.feature.installapproval.InstallApprovalDecisionApplier] is the on-device
 *    application step for once a decision arrives, mirroring `BonusGrantSync`'s identical scoping).
 *
 * Still never silently collects anything beyond what a parent-facing "recently installed apps"
 * list/approval request would show (package name, best-effort label, install time, capability
 * state) -- no permissions list, no APK contents, no covert reporting channel.
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
            // Resolved once and shared by both independent steps below -- avoids a second
            // PackageManager round-trip for the exact same package within the same broadcast.
            val (appLabel, firstInstallTimeMillis) = resolveAppMetadata(context, packageName)
            runCatching { recordInstall(app, packageName, appLabel, firstInstallTimeMillis) }
            runCatching { handleInstallApproval(app, packageName, appLabel) }
            pendingResult.finish()
        }
    }

    /**
     * PCA-FR-131: the capability-honest approval half (see this class's own doc comment). Runs
     * independently of [recordInstall] (each wrapped in its own `runCatching` in [onReceive]) so a
     * failure in one never silently suppresses the other -- local visibility and the parent-facing
     * approval request are two separately-valuable outcomes of the same broadcast.
     */
    private fun handleInstallApproval(app: PcaApplication, packageName: String, appLabel: String?) {
        val graph = app.graph
        val nowMillis = graph.wallClockTimeSource.currentTimeMillis()
        val detection = graph.installApprovalController.handleNewInstall(packageName, appLabel, nowMillis)
        graph.runtime.createChildRequest(detection.requestId, detection.kind, detection.detail)
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
    private suspend fun recordInstall(app: PcaApplication, packageName: String, appLabel: String?, firstInstallTimeMillis: Long?) {
        val graph = app.graph
        val deviceId = (graph.deviceIdentityProvider.currentIdentity() as? DeviceIdentityState.Enrolled)?.deviceId ?: return

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
