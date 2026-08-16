package org.pca.app.feature.breakshield

import android.content.Context
import android.content.Intent
import org.pca.app.PcaApplication
import org.pca.app.runtime.graph.newLocalRequestId

/**
 * PCA-FR-132 closure: the existing "Emergency Access" affordance on this screen only ever toggled
 * a local screen-time-policy bypass mode ([BreakShieldViewState.canRequestEmergencyException] /
 * `ScreenTimeMode.EMERGENCY_EXCEPTION]) -- it never actually reached a phone or emergency service.
 * This is the real action: launching the system dialer.
 *
 * Deliberately [Intent.ACTION_DIAL], NEVER `Intent.ACTION_CALL`. `ACTION_DIAL` opens the system
 * Phone app's dialer UI and requires the user to press the call button themselves; `ACTION_CALL`
 * places the call immediately and additionally requires the `CALL_PHONE` runtime permission this
 * app does not request anywhere. Silently placing a call on a child's behalf without a confirming
 * tap would be both a safety risk (accidental/duress-triggered calls with no way to back out) and
 * a scope overreach for a monitoring app -- routing through the system dialer keeps a human
 * confirmation step in the loop while still making calling for help exactly one tap away from
 * here, which is the actual requirement.
 *
 * No phone number is pre-filled (`Intent(Intent.ACTION_DIAL)` with no data URI): PCA has no
 * reliable, documented way to know the correct local emergency number for the device's current
 * region (it varies: 911 / 999 / 112 / 000 / ...), and guessing wrong would be worse than leaving
 * the dialer blank -- the child can dial any number, including a parent's, not only an emergency
 * one. Every Android device's own dialer additionally exposes its own "Emergency call" affordance
 * (reachable even from the lock screen) independent of this Intent, which already correctly
 * resolves the right number for the device's locale/carrier -- this button's job is only to get
 * the child to that dialer as fast as possible, not to re-implement emergency number resolution.
 */
fun buildEmergencyDialIntent(): Intent = Intent(Intent.ACTION_DIAL).apply {
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

/** True only for an [Intent] this app itself would consider a safe emergency-dial launch --
 * [Intent.ACTION_DIAL] with no call ever placed automatically. Exists so a caller/test can assert
 * on the actual [Intent] contents rather than trusting [buildEmergencyDialIntent]'s doc comment
 * alone; see [EmergencyDialIntentTest] for the adversarial-shape coverage (this function is not
 * itself reachable from anywhere unsafe -- there is no other Intent-building path in this file). */
internal fun isSafeEmergencyDialIntent(intent: Intent): Boolean =
    intent.action == Intent.ACTION_DIAL && intent.data == null

/**
 * PCA-FR-132 trusted-contact closure (Writer73): the real, best-effort "someone else should know
 * this was used" signal fired alongside [launchEmergencyDialer] -- until this existed, pressing the
 * dial button produced no record anywhere beyond the system dialer's own history. Deliberately an
 * injectable interface (not a hardcoded call inside [launchEmergencyDialer]) so the safety-critical
 * dial path stays trivially testable in total isolation from notification/sync machinery, and so a
 * caller's own alert failure can never be conflated with a dial-launch failure.
 */
fun interface EmergencyDialTrustedContactAlert {
    /** Must never throw and must never block meaningfully -- always invoked strictly AFTER
     * [launchEmergencyDialer] has already started the dialer Activity, never before or gating it. */
    fun alert()
}

/**
 * Production implementation: two independent, best-effort legs, each individually swallowing its
 * own failure so neither can affect the other.
 *  1. [EmergencyDialUsageAlertDelivery] -- a same-device local notification (honest, always
 *     available regardless of family-sync state; see that class's own doc comment for why this is
 *     NOT itself a cross-device parent notification).
 *  2. A real [org.pca.app.runtime.child.ChildRequestOfflineQueue] entry via
 *     `PcaRuntime.createChildRequest`, kind `EMERGENCY_DIAL_USED` -- the exact same mechanism
 *     [org.pca.app.MainActivity]'s "Request Parent Contact" wiring already uses, so this reaches a
 *     real parent-visible surface once family sync is `LIVE`, with the same honest
 *     `PENDING_SYNC_LOCAL` posture as that already-accepted feature -- never a new, separately
 *     invented cross-device claim.
 */
class RealEmergencyDialTrustedContactAlert(private val context: Context) : EmergencyDialTrustedContactAlert {
    override fun alert() {
        runCatching { EmergencyDialUsageAlertDelivery(context).deliver() }
        runCatching { enqueueEmergencyDialChildRequest(context) }
    }
}

private fun enqueueEmergencyDialChildRequest(context: Context) {
    val app = context.applicationContext as? PcaApplication ?: return
    app.graph.runtime.createChildRequest(
        requestId = newLocalRequestId(),
        kind = "EMERGENCY_DIAL_USED",
        detail = "Child opened the emergency dialer",
    )
}

/** Launches [buildEmergencyDialIntent] against [context] -- the one real call site
 * [BreakShieldScreen] wires its emergency-call button to by default. A plain function (not
 * `@Composable`) so it is trivially callable from a plain `onClick` lambda and independently unit
 * testable without a Compose test rule.
 *
 * [trustedContactAlert] fires strictly AFTER `context.startActivity` above has already returned --
 * the dial launch is never delayed, gated, or made conditional on it, and any failure inside it
 * (caught here too, belt-and-suspenders on top of [RealEmergencyDialTrustedContactAlert]'s own
 * internal `runCatching`) can never prevent or roll back the dial launch that already happened. */
fun launchEmergencyDialer(
    context: Context,
    trustedContactAlert: EmergencyDialTrustedContactAlert = RealEmergencyDialTrustedContactAlert(context),
) {
    context.startActivity(buildEmergencyDialIntent())
    runCatching { trustedContactAlert.alert() }
}
