package org.pca.app.feature.webprotection.vpn

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import org.pca.app.platform.VpnCapabilitySource

enum class VpnStartRequestOutcome { STARTED, CONSENT_REQUIRED, OWNER_APPROVAL_REQUIRED }

/**
 * Thin orchestration seam between a parent-facing UI surface (no dedicated screen is built in this
 * pass -- see the final report's KNOWN_PLATFORM_LIMITATIONS; this controller is the real, reachable,
 * production-composed integration point a future settings screen wires a button to, following the
 * exact same "engineering complete, UI wiring deferred" precedent already established for
 * [org.pca.app.feature.webprotection.ingress.WebRulePolicyConsumer] in this codebase) and the real
 * [WebProtectionVpnService]/[VpnCapabilitySource] consent flow.
 *
 * Deliberately holds no Activity reference and performs no ActivityResult handling itself --
 * callers own presenting [VpnCapabilitySource.createConsentIntentIfNeeded]'s Intent via their own
 * `ActivityResultLauncher` (the standard, only-available `VpnService.prepare()` contract on Standard
 * Mode Android -- see [VpnCapabilitySource]'s own doc comment) and must call [onConsentGranted] only
 * once that launcher reports the user actually granted it.
 *
 * PCA-DW-W3-G: [policy] gates both entry points -- ANDROID_VPN_DNS_POLICY is
 * OWNER_DECISION_PENDING, and this must not depend solely on "no settings
 * screen calls requestStart() yet" for that to stay true. See
 * [VpnEnforcementPolicy]'s own doc comment.
 */
class VpnEnforcementController(
    private val context: Context,
    private val vpnCapability: VpnCapabilitySource,
    private val policy: VpnEnforcementPolicy = defaultVpnEnforcementPolicy(),
) {

    /**
     * Returns [VpnStartRequestOutcome.OWNER_APPROVAL_REQUIRED] (no Intent, nothing started, no
     * consent even requested) while [VpnEnforcementPolicy.ownerApproved] is false -- the current,
     * always-true-in-production state. Returns [VpnStartRequestOutcome.CONSENT_REQUIRED] with the
     * Intent the caller must launch via `ActivityResultLauncher.launch(...)` -- the service is NOT
     * started in that case, so a caller that never launches the returned Intent leaves nothing
     * running (no covert fallback). Returns [VpnStartRequestOutcome.STARTED] when permission was
     * already granted (a previously-approved session) -- the service is started immediately in
     * that case.
     */
    fun requestStart(): Pair<VpnStartRequestOutcome, Intent?> {
        if (!policy.ownerApproved) return VpnStartRequestOutcome.OWNER_APPROVAL_REQUIRED to null
        val consentIntent = vpnCapability.createConsentIntentIfNeeded()
        if (consentIntent != null) return VpnStartRequestOutcome.CONSENT_REQUIRED to consentIntent
        startService()
        return VpnStartRequestOutcome.STARTED to null
    }

    /**
     * Caller invokes this once its `ActivityResultLauncher` reports the user actually granted
     * consent (`resultCode == Activity.RESULT_OK`). Never called for a denied/cancelled result --
     * doc 24's "Permission revoke"/consent-denied case simply leaves the tunnel unstarted, and
     * [VpnMetadataDecisionAdapter] honestly keeps reporting UNAVAILABLE, exactly as if the feature
     * were never enabled; nothing here fabricates a started session. Guarded by [policy] too, as
     * defense in depth -- consent can only genuinely be requested downstream of [requestStart]'s
     * own gate, but this must not silently start enforcement if ever invoked out of that sequence.
     */
    fun onConsentGranted() {
        if (!policy.ownerApproved) return
        startService()
    }

    /** Parent policy permits stopping enforcement at any time (this pass adds no "cannot be turned off" lock) -- routes to [WebProtectionVpnService.ACTION_STOP], which cleanly tears the tunnel down and reports [org.pca.app.platform.VpnConnectionState.DISCONNECTED]. */
    fun stop() {
        val intent = Intent(context, WebProtectionVpnService::class.java).setAction(WebProtectionVpnService.ACTION_STOP)
        context.startService(intent)
    }

    private fun startService() {
        val intent = Intent(context, WebProtectionVpnService::class.java)
        ContextCompat.startForegroundService(context, intent)
    }
}
