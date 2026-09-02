package org.pca.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.core.app.NotificationManagerCompat
import org.pca.app.accessibility.PcaAccessibilityContent
import org.pca.app.feature.webprotection.ui.SafeBrowserActivity
import org.pca.app.feature.youtube.ui.YouTubeModeActivity
import org.pca.app.platform.UsageAccessState
import org.pca.app.runtime.graph.newLocalRequestId
import org.pca.app.runtime.ui.ChildHomeScreen
import org.pca.app.runtime.ui.CallStatePermissionPromptPolicy
import org.pca.app.runtime.ui.NotificationPermissionPromptPolicy
import org.pca.app.runtime.ui.UsageAccessOnboardingPolicy
import org.pca.app.security.ui.AdminSecurityActivity

/**
 * PCA-RUNTIME-ANDROID-1 Section 15: the pure launch shell is replaced by the real child status
 * surface, driven live by [org.pca.app.runtime.PcaRuntime.status] -- the composition root
 * ([PcaApplication.graph]) is already running by the time this Activity is created (Section 2),
 * so this screen only ever observes already-live state, never triggers initialization itself.
 *
 * Correction round Section 6/9: [ChildHomeScreen]'s Emergency Access / Parent Contact actions are
 * wired to the real [org.pca.app.runtime.PcaRuntime] paths here -- toggling the actual runtime
 * emergency exception, and creating a real (locally-queued, honestly PENDING_SYNC_LOCAL-until-sync)
 * child request -- rather than being visually present but functionally dead.
 */
class MainActivity : ComponentActivity() {
    private var phoneStatePermissionGranted: Boolean? = null
    private var awaitingSettingsPermissionReturn = false
    private var usageAccessGranted: Boolean? = null
    private var awaitingUsageAccessSettingsReturn = false
    private var notificationsEnabled: Boolean? = null
    private var awaitingNotificationSettingsReturn = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtime = (application as PcaApplication).graph.runtime
        setContent {
            PcaAccessibilityContent {
                val status by runtime.status.collectAsState()
                MaterialTheme {
                    ChildHomeScreen(
                    status = status,
                    onEmergencyAccess = {
                        if (status.isEmergencyExceptionActive) {
                            runtime.deactivateEmergencyException()
                        } else {
                            runtime.activateEmergencyException()
                        }
                    },
                    onRequestParentContact = {
                        runtime.createChildRequest(
                            requestId = newLocalRequestId(),
                            kind = "PARENT_CONTACT",
                            detail = "Child requested to contact parent",
                        )
                    },
                    onRequestBonusTime = {
                        // PCA-FR-130: reuses the SAME real, offline-safe createChildRequest path
                        // as onRequestParentContact above -- never a second, parallel mechanism.
                        // `detail` carries the machine-readable ask (parsed by whichever channel
                        // eventually delivers this request to a parent device); the actual amount
                        // is NOT decided here -- only an authorized parent's decide() call
                        // (backend/src/childrequests/ChildRequestService.ts) ever produces a real,
                        // bounded, audited grant.
                        runtime.createChildRequest(
                            requestId = newLocalRequestId(),
                            kind = "BONUS_TIME",
                            detail = "requestedExtraMinutes=30;appScope=ALL",
                        )
                    },
                    onOpenSafeBrowser = {
                        startActivity(Intent(this@MainActivity, SafeBrowserActivity::class.java))
                    },
                    onOpenAdminSecurity = {
                        startActivity(Intent(this@MainActivity, AdminSecurityActivity::class.java))
                    },
                    onOpenYouTubeMode = {
                        startActivity(Intent(this@MainActivity, YouTubeModeActivity::class.java))
                    },
                    onRequestWellbeingIdea = {
                        // PCA-WELL-012/023: the one real UI entry point for the child-initiated
                        // GIVE_ME_AN_IDEA trigger -- PcaRuntime.requestWellbeingIdea() was a
                        // documented public entry point with zero callers until this wiring.
                        runtime.requestWellbeingIdea()
                    },
                    onRequestCallStatePermission = {
                        val hasPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.READ_PHONE_STATE,
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                        val preferences = getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
                        when (CallStatePermissionPromptPolicy.nextAction(
                            hasPermission = hasPermission,
                            promptWasShown = preferences.getBoolean(PHONE_STATE_PROMPT_SHOWN, false),
                        )) {
                            CallStatePermissionPromptPolicy.Action.ALREADY_GRANTED -> runtime.refreshCommunicationCallStateObserver()
                            CallStatePermissionPromptPolicy.Action.REQUEST -> {
                                preferences.edit().putBoolean(PHONE_STATE_PROMPT_SHOWN, true).apply()
                                requestPermissions(
                                    arrayOf(Manifest.permission.READ_PHONE_STATE),
                                    PHONE_STATE_PERMISSION_REQUEST_CODE,
                                )
                            }
                            CallStatePermissionPromptPolicy.Action.OPEN_SETTINGS -> {
                                awaitingSettingsPermissionReturn = true
                                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                    data = Uri.parse("package:$packageName")
                                })
                            }
                        }
                    },
                    onRequestUsageAccess = { requestUsageAccess() },
                    onRequestNotificationPermission = { requestNotificationPermission() },
                    )
                }
            }
        }
    }

    /**
     * PCA-FR-081 / doc 06 closure: the `PACKAGE_USAGE_STATS` hand-off. That permission is
     * signature/privileged -- there is no runtime dialog for it, and the ONLY way it is ever
     * granted is the manual per-app toggle in Settings > Special app access > Usage access. Until
     * this method existed nothing in the app ever opened that screen, so the manifest declaration
     * and [org.pca.app.platform.StandardUsageObservationSource]'s AppOps check could never resolve
     * to MODE_ALLOWED on a real device and every usage-derived capability read a permanently-empty
     * event list.
     *
     * Follows [onRequestCallStatePermission]'s Settings hand-off precedent exactly, with two
     * differences forced by the permission's nature: there is no `requestPermissions` branch, and
     * the Settings action is guarded against [ActivityNotFoundException] because a device that
     * reports [UsageAccessState.UNAVAILABLE] (no `AppOpsManager`) generally does not resolve this
     * screen either -- an unreachable Settings screen degrades to "unavailable", never a crash and
     * never a fabricated grant.
     */
    private fun requestUsageAccess() {
        when (UsageAccessOnboardingPolicy.nextAction(currentUsageAccessState())) {
            // Already granted, or the device genuinely has no usage-access surface: the card itself
            // already states which of those two it is; there is nothing further to hand off to.
            UsageAccessOnboardingPolicy.Action.ALREADY_GRANTED,
            UsageAccessOnboardingPolicy.Action.UNAVAILABLE_ON_DEVICE,
            -> Unit
            UsageAccessOnboardingPolicy.Action.OPEN_USAGE_ACCESS_SETTINGS -> {
                awaitingUsageAccessSettingsReturn = true
                try {
                    startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                } catch (_: ActivityNotFoundException) {
                    awaitingUsageAccessSettingsReturn = false
                }
            }
        }
    }

    /**
     * PCA-WELL-012/PCA-FR-073/PCA-FR-081 closure: the `POST_NOTIFICATIONS` runtime request. The
     * permission was declared and guarded at every `notify()` call site but never requested, so on
     * API 33+ prayer reminders, wellbeing suggestions and capability-tamper alerts were all inert.
     *
     * Same one-shot-then-Settings shape as [CallStatePermissionPromptPolicy]'s flow (Android stops
     * showing the dialog after the user dismisses it, so re-requesting silently no-ops and the app
     * must fall back to Settings). Below API 33 there is no runtime permission at all, so
     * [NotificationPermissionPromptPolicy] routes straight to the app-notification Settings screen,
     * which is the only real remedy for a user-disabled channel there.
     */
    private fun requestNotificationPermission() {
        val preferences = getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
        when (NotificationPermissionPromptPolicy.nextAction(
            sdkInt = Build.VERSION.SDK_INT,
            notificationsEnabled = areNotificationsEnabled(),
            promptWasShown = preferences.getBoolean(POST_NOTIFICATIONS_PROMPT_SHOWN, false),
        )) {
            NotificationPermissionPromptPolicy.Action.ALREADY_ENABLED -> Unit
            NotificationPermissionPromptPolicy.Action.REQUEST_RUNTIME_PERMISSION -> {
                preferences.edit().putBoolean(POST_NOTIFICATIONS_PROMPT_SHOWN, true).apply()
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    POST_NOTIFICATIONS_PERMISSION_REQUEST_CODE,
                )
            }
            NotificationPermissionPromptPolicy.Action.OPEN_SETTINGS -> {
                awaitingNotificationSettingsReturn = true
                try {
                    startActivity(
                        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
                    )
                } catch (_: ActivityNotFoundException) {
                    awaitingNotificationSettingsReturn = false
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val isGranted = hasPhoneStatePermission()
        val wasGranted = phoneStatePermissionGranted
        phoneStatePermissionGranted = isGranted
        if (awaitingSettingsPermissionReturn) {
            awaitingSettingsPermissionReturn = false
            if (wasGranted != null && CallStatePermissionPromptPolicy.shouldRefreshAfterSettingsReturn(wasGranted, isGranted)) {
                (application as PcaApplication).graph.runtime.refreshCommunicationCallStateObserver()
            }
        }
        resumeUsageAccessSettingsReturn()
        resumeNotificationSettingsReturn()
    }

    /** Mirrors the call-state Settings round-trip above: re-publishes the status snapshot only when
     * the trip genuinely changed denied to granted, so the child status surface stops claiming the
     * usage-derived capabilities are unavailable the moment they actually are not. */
    private fun resumeUsageAccessSettingsReturn() {
        val isGranted = UsageAccessOnboardingPolicy.isCapabilityUsable(currentUsageAccessState())
        val wasGranted = usageAccessGranted
        usageAccessGranted = isGranted
        if (!awaitingUsageAccessSettingsReturn) return
        awaitingUsageAccessSettingsReturn = false
        if (wasGranted != null && UsageAccessOnboardingPolicy.shouldRefreshAfterSettingsReturn(wasGranted, isGranted)) {
            (application as PcaApplication).graph.runtime.refreshCapabilityStatus()
        }
    }

    private fun resumeNotificationSettingsReturn() {
        val isEnabled = areNotificationsEnabled()
        val wasEnabled = notificationsEnabled
        notificationsEnabled = isEnabled
        if (!awaitingNotificationSettingsReturn) return
        awaitingNotificationSettingsReturn = false
        if (wasEnabled != null && NotificationPermissionPromptPolicy.shouldRefreshAfterSettingsReturn(wasEnabled, isEnabled)) {
            (application as PcaApplication).graph.runtime.refreshCapabilityStatus()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PHONE_STATE_PERMISSION_REQUEST_CODE) {
            phoneStatePermissionGranted = hasPhoneStatePermission()
            (application as PcaApplication).graph.runtime.refreshCommunicationCallStateObserver()
        }
        if (requestCode == POST_NOTIFICATIONS_PERMISSION_REQUEST_CODE) {
            notificationsEnabled = areNotificationsEnabled()
            (application as PcaApplication).graph.runtime.refreshCapabilityStatus()
        }
    }

    private fun hasPhoneStatePermission(): Boolean =
        androidx.core.content.ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_PHONE_STATE,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** Live AppOps-backed read through the graph's single production
     * [org.pca.app.platform.StandardUsageObservationSource] instance -- never a cached or assumed
     * value, and never the Compose snapshot, which can be up to one runtime tick stale at the exact
     * moment the parent returns from Settings. Falls closed to [UsageAccessState.UNAVAILABLE]. */
    private fun currentUsageAccessState(): UsageAccessState =
        runCatching { (application as PcaApplication).graph.usageObservationSource.accessState() }
            .getOrDefault(UsageAccessState.UNAVAILABLE)

    /** The same live signal [org.pca.app.runtime.status.PcaRuntimeStatus.wellbeingNotificationsAvailable]
     * carries -- on API 33+ this is false whenever `POST_NOTIFICATIONS` is denied, and on every API
     * level it is false when the user disabled the app's notifications. */
    private fun areNotificationsEnabled(): Boolean =
        runCatching { NotificationManagerCompat.from(this).areNotificationsEnabled() }.getOrDefault(false)

    private companion object {
        const val PERMISSION_PREFS = "pca_permission_prompts"
        const val PHONE_STATE_PROMPT_SHOWN = "read_phone_state_prompt_shown"
        const val PHONE_STATE_PERMISSION_REQUEST_CODE = 4201
        const val POST_NOTIFICATIONS_PROMPT_SHOWN = "post_notifications_prompt_shown"
        const val POST_NOTIFICATIONS_PERMISSION_REQUEST_CODE = 4202
    }
}
