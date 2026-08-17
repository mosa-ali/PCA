package org.pca.app.persistence

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.test.core.app.ApplicationProvider
import org.pca.app.persistence.crypto.InMemoryLocalRecordCipher
import org.pca.app.persistence.crypto.LocalRecordCipher

/** Shared Robolectric test helpers -- real SQLite via Room, real AES/GCM via [InMemoryLocalRecordCipher]. */
object PersistenceTestSupport {
    fun context(): Context = ApplicationProvider.getApplicationContext()

    fun inMemoryDb(): PcaLocalDatabase =
        Room.inMemoryDatabaseBuilder(context(), PcaLocalDatabase::class.java)
            .allowMainThreadQueries()
            .build()

    /** Builds a real file-backed DB (not in-memory) under the given file name, for close/reopen durability tests. */
    fun fileBackedDb(fileName: String): PcaLocalDatabase =
        Room.databaseBuilder(context(), PcaLocalDatabase::class.java, fileName)
            .addMigrations(*Migrations.ALL)
            // Robolectric's sqlite4java WAL sidecar cleanup is racy when several
            // file-backed tests close/reopen databases in one JVM on Windows.
            // TRUNCATE still exercises real on-disk Room durability without
            // making the validation suite depend on that test-runtime race;
            // production PcaLocalDatabase.build() keeps Room's normal journal
            // policy unchanged.
            .setJournalMode(RoomDatabase.JournalMode.TRUNCATE)
            .allowMainThreadQueries()
            .build()

    fun testCipher(): LocalRecordCipher = InMemoryLocalRecordCipher()
}
