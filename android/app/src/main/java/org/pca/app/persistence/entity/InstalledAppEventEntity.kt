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
 * PCA-LOCAL-DB-1 Section 8 / doc 10 Section 4.1: the package name and the human-readable label are
 * BOTH encrypted at rest, exactly as [UsageSessionEntity.appOrCategoryTokenEnc] already is and for
 * exactly the reason that entity's own comment gives -- "an app/package identifier can be
 * family-sensitive". These two columns previously stored the identical class of value in plaintext,
 * which meant a rooted-device file copy or backup exfiltration of `pca_local.db` disclosed the full
 * list of apps a child installed while the sibling table's equivalent value was protected. The
 * cipher is the SAME [org.pca.app.persistence.crypto.LocalRecordCipher] every other encrypted
 * column in this database already uses (AES/GCM via AndroidKeyStore) -- no new cryptography is
 * introduced here, and no multi-party/E2EE claim is made.
 *
 * [appLabelEnc]/[appLabelIv] stay nullable together (both null, or both present): the label is a
 * best-effort `PackageManager` lookup at observation time and can genuinely fail, e.g. for a
 * package already uninstalled again by the time it is resolved. [packageNameEnc] is always present
 * and is the durable identifier a parent-facing list keys off, never the label alone. Ciphertext is
 * stored as Base64 `TEXT`, matching [org.pca.app.persistence.crypto.EncryptedFieldCodec]'s
 * repo-wide column convention.
 */
@Entity(
    tableName = "installed_app_events",
    indices = [Index("deviceId"), Index("installedAtEpochMillis")],
)
data class InstalledAppEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val packageNameEnc: String,
    val packageNameIv: String,
    val appLabelEnc: String?,
    val appLabelIv: String?,
    /** `PackageInfo.firstInstallTime` at observation time -- the OS's own record of when the
     * install actually happened, not merely when this receiver happened to run. */
    val installedAtEpochMillis: Long,
    /** When this device actually observed/recorded the event -- may lag [installedAtEpochMillis]
     * slightly (broadcast delivery/process-start latency), kept separate for honest auditing. */
    val observedAtEpochMillis: Long,
)
