package org.pca.app.persistence

import androidx.room.migration.Migration

/**
 * Explicit migration registry (Section 22). Empty at schema version 1 --
 * the next entry added here (e.g. `MIGRATION_1_2`) MUST come with a
 * corresponding migration test using the exported schema JSON in
 * `android/app/schemas/`. Never rely on `fallbackToDestructiveMigration()`
 * as a substitute for an entry here (Section 4).
 */
object Migrations {
    val ALL: Array<Migration> = emptyArray()
}
