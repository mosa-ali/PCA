package org.pca.app.feature.breakshield

import android.content.Context
import android.content.Intent

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

/** Launches [buildEmergencyDialIntent] against [context] -- the one real call site
 * [BreakShieldScreen] wires its emergency-call button to by default. A plain function (not
 * `@Composable`) so it is trivially callable from a plain `onClick` lambda and independently unit
 * testable without a Compose test rule. */
fun launchEmergencyDialer(context: Context) {
    context.startActivity(buildEmergencyDialIntent())
}
