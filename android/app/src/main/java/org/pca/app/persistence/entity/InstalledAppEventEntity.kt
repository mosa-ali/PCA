package org.pca.app.persistence.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * PCA-FR-045/PCA-FR-131: a locally-observed "a new app was installed on this device" event,
 * captured by `org.pca.app.runtime.installobserver.InstalledAppEventReceiver` from the documented
 * `PACKAGE_ADDED` broadcast (never a poll/guess, never a package-usage inference). Visibility only
 * -- this table records that an install was observed and what its label/package were at the time;
 * it deliberately carries no approval/decision state (doc 03's install-approval workflow is
 * PROPOSED, not committed -- see that receiver's own doc comment for the scope line drawn here).
 *
 * [appLabel] is a best-effort human-readable label resolved via `PackageManager` at observation
 * time (nullable -- a label lookup can fail, e.g. for a package already uninstalled again by the
 * time it is resolved); [packageName] is always present and is the durable identifier a parent-
 * facing list should key off, never [appLabel] alone.
 */
@Entity(
    tableName = "installed_app_events",
    indices = [Index("deviceId"), Index("installedAtEpochMillis")],
)
data class InstalledAppEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val packageName: String,
    val appLabel: String?,
    /** `PackageInfo.firstInstallTime` at observation time -- the OS's own record of when the
     * install actually happened, not merely when this receiver happened to run. */
    val installedAtEpochMillis: Long,
    /** When this device actually observed/recorded the event -- may lag [installedAtEpochMillis]
     * slightly (broadcast delivery/process-start latency), kept separate for honest auditing. */
    val observedAtEpochMillis: Long,
)
