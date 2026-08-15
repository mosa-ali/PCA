package org.pca.app.runtime.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.pca.app.R
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.platform.LocationCapabilityLevel
import org.pca.app.platform.ProtectionMode
import org.pca.app.platform.UsageAccessState
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import org.pca.app.runtime.status.PcaRuntimeStatus
import java.util.concurrent.TimeUnit

/**
 * Section 15: replaces the pure launch-shell with an honest child status surface. Every row maps
 * 1:1 to a real [PcaRuntimeStatus] field -- Section 16 forbids any status here that isn't backed
 * by a genuine, currently-observed signal. Section 20: headings are marked for accessibility
 * services, status is never color-only (every row carries a text label), and rows use the default
 * Material list item minimum touch-target height.
 */
@Composable
fun ChildHomeScreen(
    status: PcaRuntimeStatus,
    modifier: Modifier = Modifier,
    onRequestParentContact: () -> Unit = {},
    onEmergencyAccess: () -> Unit = {},
    onOpenSafeBrowser: () -> Unit = {},
    onOpenAdminSecurity: () -> Unit = {},
) {
    val rows = statusRows(status)
    Surface(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { ScreenHeading() }
            item { OfflineBanner(status) }

            items(rows) { row -> StatusRow(row) }

            item { SafeBrowserEntryCard(onClick = onOpenSafeBrowser) }
            item { EmergencyAccessCard(isActive = status.isEmergencyExceptionActive, onClick = onEmergencyAccess) }
            item { ParentContactCard(pendingCount = status.pendingChildRequestCount, onClick = onRequestParentContact) }
            item { AdminSecurityEntryCard(onClick = onOpenAdminSecurity) }
        }
    }
}

/** PCA-WEB-RUNTIME-1: the real, reachable child entry point into [org.pca.app.feature.webprotection.ui.SafeBrowserActivity] -- without this, that Activity would be declared but unlaunchable, which doc 48 explicitly forbids counting as a closed navigation surface. */
@Composable
private fun SafeBrowserEntryCard(onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics { role = Role.Button },
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = stringResource(R.string.child_home_safe_browser), style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** Coordinator glue (Wave B integration): the real, reachable entry point into
 * [org.pca.app.security.ui.AdminSecurityActivity] -- without this, that Activity (Writer64's
 * PIN/biometric-gated PIN-config + removal-decision surface) would be declared but unlaunchable,
 * the same "no dead Activities" rule [SafeBrowserEntryCard] above already establishes. This card
 * itself gates nothing -- AdminSecurityActivity performs its own PIN/biometric authentication on
 * launch, exactly like SafeBrowserActivity performs its own navigation-policy checks. */
@Composable
private fun AdminSecurityEntryCard(onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics { role = Role.Button },
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = stringResource(R.string.removal_decision_title), style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun ScreenHeading() {
    Text(
        text = stringResource(R.string.child_home_title),
        style = MaterialTheme.typography.headlineSmall,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
private fun OfflineBanner(status: PcaRuntimeStatus) {
    // Section 15: honest, non-alarming offline messaging -- local protection is explicitly
    // affirmed as active even while remote updates are pending, never the reverse.
    if (!status.isDeviceOnline || status.areRemoteUpdatesPending) {
        Card(colors = CardDefaults.cardColors()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = stringResource(R.string.child_home_local_protection_active),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Text(
                    text = stringResource(R.string.child_home_remote_updates_pending),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

private data class StatusRowContent(val label: String, val value: String)

@Composable
private fun statusRows(status: PcaRuntimeStatus): List<StatusRowContent> = listOf(
    StatusRowContent(stringResource(R.string.child_home_protection_status), protectionModeLabel(status.protectionMode)),
    StatusRowContent(stringResource(R.string.child_home_screen_time_state), screenTimeModeLabel(status.screenTimeMode, status.remainingActiveMillis)),
    StatusRowContent(stringResource(R.string.child_home_break_state), breakStateLabel(status.isBreakShieldActive, status.remainingBreakMillis)),
    StatusRowContent(stringResource(R.string.child_home_schedule_status), scheduleStatusLabel(status.scheduleStatus)),
    StatusRowContent(stringResource(R.string.child_home_internet_status), internetStatusLabel(status.isDeviceOnline)),
    StatusRowContent(stringResource(R.string.child_home_sync_status), syncStatusLabel(status.syncConnectionState)),
    StatusRowContent(stringResource(R.string.child_home_last_sync), lastSyncLabel(status.lastSuccessfulSyncEpochMillis)),
    StatusRowContent(stringResource(R.string.child_home_usage_permission), usageAccessLabel(status.usageAccessState)),
    StatusRowContent(stringResource(R.string.child_home_location_capability), locationCapabilityLabel(status.locationCapabilityLevel)),
    StatusRowContent(stringResource(R.string.child_home_wellbeing_availability), wellbeingLabel(status.wellbeingNotificationsAvailable)),
    StatusRowContent(stringResource(R.string.child_home_pending_requests), localizedNumber(status.pendingChildRequestCount.toLong())),
)

@Composable
private fun StatusRow(row: StatusRowContent) {
    // PCA-16B: locale-owned format string (child_home_status_row_description) instead of a
    // code-level "${label}: ${value}" concatenation, so a translator controls the
    // label/value separator and order per locale rather than it being fixed by app code.
    val description = stringResource(R.string.child_home_status_row_description, row.label, row.value)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = description
            },
    ) {
        Text(text = row.label, style = MaterialTheme.typography.labelLarge)
        Text(text = row.value, style = MaterialTheme.typography.bodyLarge)
    }
    HorizontalDivider()
}

/**
 * Correction round Section 6/7: wired to the real runtime emergency exception, and toggles
 * label/description to give a clear, always-visible exit path while active -- never an
 * indefinite hidden bypass; the child (or a parent looking at the device) can always see and
 * reverse the state from this same control.
 */
@Composable
private fun EmergencyAccessCard(isActive: Boolean, onClick: () -> Unit) {
    val activeLabel = stringResource(R.string.child_home_emergency_access_active)
    val exitLabel = stringResource(R.string.child_home_emergency_access_exit)
    val startLabel = stringResource(R.string.child_home_emergency_access)
    // PCA-16B: the active-state description is a locale-owned format string (not a
    // code-level concatenation of two independently-translated fragments), so a translator
    // can adjust punctuation/order per locale.
    val description = if (isActive) {
        stringResource(R.string.child_home_emergency_access_active_description, activeLabel, exitLabel)
    } else {
        startLabel
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics {
                role = Role.Button
                contentDescription = description
            },
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = if (isActive) exitLabel else startLabel, style = MaterialTheme.typography.titleMedium)
            if (isActive) {
                Text(text = activeLabel, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** Correction round Section 9: honestly shows PENDING_SYNC_LOCAL-equivalent local state -- the
 * button's own subtitle reflects [pendingCount] rather than silently pretending a request already
 * reached a parent. */
@Composable
private fun ParentContactCard(pendingCount: Int, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .semantics { role = Role.Button },
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = stringResource(R.string.child_home_parent_contact), style = MaterialTheme.typography.titleMedium)
            if (pendingCount > 0) {
                Text(
                    text = stringResource(R.string.child_home_parent_contact_pending, localizedNumber(pendingCount.toLong())),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun protectionModeLabel(mode: ProtectionMode): String = when (mode) {
    ProtectionMode.PROTECTED -> stringResource(R.string.child_home_protection_protected)
    ProtectionMode.STANDARD -> stringResource(R.string.child_home_protection_standard)
}

@Composable
private fun screenTimeModeLabel(mode: ScreenTimeMode, remainingActiveMillis: Long): String = when (mode) {
    ScreenTimeMode.ACTIVE -> stringResource(R.string.child_home_screen_time_active, formatMinutes(remainingActiveMillis))
    ScreenTimeMode.PAUSED -> stringResource(R.string.child_home_screen_time_paused)
    ScreenTimeMode.BREAK_SHIELD -> stringResource(R.string.child_home_screen_time_break)
    ScreenTimeMode.EMERGENCY_EXCEPTION -> stringResource(R.string.child_home_screen_time_emergency)
}

@Composable
private fun breakStateLabel(active: Boolean, remainingBreakMillis: Long): String =
    if (active) {
        stringResource(R.string.child_home_break_active, formatMinutes(remainingBreakMillis))
    } else {
        stringResource(R.string.child_home_break_inactive)
    }

@Composable
private fun scheduleStatusLabel(scheduleStatus: ScheduleRuntimeStatus): String = when (scheduleStatus) {
    ScheduleRuntimeStatus.AVAILABLE -> stringResource(R.string.child_home_schedule_available)
    ScheduleRuntimeStatus.UNAVAILABLE -> stringResource(R.string.child_home_schedule_unavailable)
    ScheduleRuntimeStatus.NOT_READY -> stringResource(R.string.child_home_schedule_not_ready)
    ScheduleRuntimeStatus.EPOCH_STALE -> stringResource(R.string.child_home_schedule_epoch_stale)
}

@Composable
private fun internetStatusLabel(online: Boolean): String =
    if (online) stringResource(R.string.child_home_internet_online) else stringResource(R.string.child_home_internet_offline)

@Composable
private fun syncStatusLabel(state: FamilySyncConnectionState): String = when (state) {
    FamilySyncConnectionState.OFFLINE -> stringResource(R.string.child_home_sync_offline)
    FamilySyncConnectionState.SYNCING -> stringResource(R.string.child_home_sync_syncing)
    FamilySyncConnectionState.SYNC_PENDING -> stringResource(R.string.child_home_sync_pending)
    FamilySyncConnectionState.STALE -> stringResource(R.string.child_home_sync_stale)
    FamilySyncConnectionState.LIVE -> stringResource(R.string.child_home_sync_live)
}

@Composable
private fun lastSyncLabel(lastSuccessfulSyncEpochMillis: Long?): String =
    if (lastSuccessfulSyncEpochMillis == null) {
        stringResource(R.string.child_home_last_sync_never)
    } else {
        val agoMinutes = TimeUnit.MILLISECONDS.toMinutes(
            (System.currentTimeMillis() - lastSuccessfulSyncEpochMillis).coerceAtLeast(0L),
        )
        stringResource(R.string.child_home_last_sync_minutes_ago, localizedNumber(agoMinutes))
    }

@Composable
private fun usageAccessLabel(state: UsageAccessState): String = when (state) {
    UsageAccessState.GRANTED -> stringResource(R.string.child_home_usage_granted)
    UsageAccessState.DENIED -> stringResource(R.string.child_home_usage_denied)
    UsageAccessState.NOT_CONFIGURED -> stringResource(R.string.child_home_usage_not_configured)
    UsageAccessState.UNAVAILABLE -> stringResource(R.string.child_home_usage_unavailable)
}

@Composable
private fun locationCapabilityLabel(level: LocationCapabilityLevel): String = when (level) {
    LocationCapabilityLevel.USABLE -> stringResource(R.string.child_home_location_usable)
    LocationCapabilityLevel.LIMITED -> stringResource(R.string.child_home_location_limited)
    LocationCapabilityLevel.UNUSABLE -> stringResource(R.string.child_home_location_unusable)
}

@Composable
private fun wellbeingLabel(available: Boolean): String =
    if (available) stringResource(R.string.child_home_wellbeing_available) else stringResource(R.string.child_home_wellbeing_unavailable)

@Composable
private fun formatMinutes(millis: Long): String = localizedNumber(TimeUnit.MILLISECONDS.toMinutes(millis.coerceAtLeast(0L)))

/**
 * PCA-16B: renders a plain count/duration number honoring the device locale's own digit
 * shape (e.g. Arabic-Indic digits under an ar-* locale that prefers them), matching the
 * precedent already established in [org.pca.app.feature.breakshield.formatDuration] (doc 20
 * Section 4) -- a raw `Long.toString()` interpolated into a translated string would otherwise
 * always render Latin digits regardless of locale.
 */
@Composable
private fun localizedNumber(value: Long): String {
    val locale = LocalConfiguration.current.locales[0]
    return String.format(locale, "%d", value)
}
