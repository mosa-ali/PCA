package org.pca.app.runtime.prayer

import android.content.Context
import android.content.Intent
import org.pca.app.feature.prayer.model.PrayerName

/**
 * Single source of truth for the broadcast contract between [AlarmManagerPrayerScheduler] (the
 * sender, via the `receiverIntentFactory` the composition root supplies) and
 * [PrayerReminderReceiver] (the manifest-registered receiver, PCA-FR-073). Previously these two
 * ends of the same contract were defined twice -- private constants duplicated in
 * `PcaAppGraph`'s companion object with a comment promising "a future receiver ... starts
 * receiving these without any change here". This object replaces both copies so the action
 * string/extra key can never drift out of sync between sender and receiver.
 *
 * Targets this app's own package only (`setPackage`, no explicit receiver component) -- see
 * [AlarmManagerPrayerScheduler]'s own doc comment for why: the OS-alarm-scheduling class does not
 * itself know about the concrete receiver.
 */
object PrayerReminderIntents {
    const val ACTION_PRAYER_REMINDER = "org.pca.app.action.PRAYER_REMINDER"
    const val EXTRA_PRAYER_NAME = "prayer_name"

    fun build(context: Context, prayer: PrayerName): Intent =
        Intent(ACTION_PRAYER_REMINDER).apply {
            setPackage(context.packageName)
            putExtra(EXTRA_PRAYER_NAME, prayer.name)
        }

    /**
     * Parses the [PrayerName] this contract's own [build] encoded, or `null` for anything that
     * does not match (wrong action, missing/unrecognized extra) -- [PrayerReminderReceiver] must
     * silently ignore any such intent rather than crash, since a manifest-registered receiver can
     * in principle be handed an unexpected broadcast. Pulled out as a pure function (no
     * Context/notification/DB dependency) specifically so this parsing contract is unit-testable
     * without Robolectric/Android resources -- see `PrayerReminderIntentsTest`.
     */
    fun parsePrayerOrNull(intent: Intent): PrayerName? {
        if (intent.action != ACTION_PRAYER_REMINDER) return null
        val name = intent.getStringExtra(EXTRA_PRAYER_NAME) ?: return null
        return runCatching { PrayerName.valueOf(name) }.getOrNull()
    }
}
