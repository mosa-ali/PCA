package org.pca.app.runtime.boot

import android.content.Context
import android.provider.Settings

/**
 * PCA-RUNTIME-2R1: the single authority for "did the device actually reboot," deliberately
 * narrow and deliberately NOT a device/family identity of any kind. Every state-restoration path
 * in this app that needs to distinguish "process died and restarted within the same boot" from
 * "the device rebooted" (monotonic-clock-anchored snapshots: screen-time, eye-distance, usage
 * observation) should read its boot-instance signal from here, not derive one itself.
 *
 * [Unknown] is a first-class outcome, not an error swallowed into "assume same boot" -- reading
 * platform boot state can fail (e.g. a `SecurityException` on a locked-down device, or the
 * setting being genuinely absent), and treating that as "definitely same boot" would let a
 * restorer trust a stale monotonic cursor across an unverified boot boundary. Callers MUST treat
 * [Unknown] as "cannot confirm continuity" and take the conservative/reboot-safe restoration
 * path, never the optimistic one.
 */
sealed interface BootInstanceResult {
    data class Known(val bootInstanceId: String) : BootInstanceResult
    data object Unknown : BootInstanceResult
}

interface BootInstanceSource {
    fun currentBootInstance(): BootInstanceResult
}

/**
 * Production binding: [Settings.Global.BOOT_COUNT], a monotonically-increasing platform counter
 * (API 17+, well below this module's minSdk floor) that increments exactly once per genuine
 * device reboot and is stable across ordinary app-process death/restart -- the correct
 * discriminator this app's restorers actually need, unlike `Settings.Secure.ANDROID_ID` (which
 * answers a different question: "what device is this," not "has it rebooted since I last saved
 * state," and which this app must never use for boot-instance detection -- see
 * [org.pca.app.runtime.identity.DeviceIdentityProvider] for the actual device-identity
 * authority). Reads via the standard `ContentResolver` API only; no private/hidden APIs, no root.
 */
class AndroidBootInstanceSource(private val context: Context) : BootInstanceSource {
    override fun currentBootInstance(): BootInstanceResult {
        val bootCount = runCatching {
            Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT)
        }.getOrNull()
        return if (bootCount != null) BootInstanceResult.Known(bootCount.toString()) else BootInstanceResult.Unknown
    }
}

/** Converts a [BootInstanceResult] to the nullable-`String` shape every existing restorer
 * (`ScreenTimeRestorer`, `EyeDistanceRestorer`, `UsageObservationRestorer`) already accepts as
 * `currentBootId` -- [BootInstanceResult.Unknown] becomes `null`, deliberately indistinguishable
 * from "no boot id available," since both cases must take the same fail-safe restoration path. */
fun BootInstanceResult.asNullableId(): String? = (this as? BootInstanceResult.Known)?.bootInstanceId
