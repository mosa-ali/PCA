package org.pca.app.persistence

import android.content.Context
import androidx.room.Room
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
            .allowMainThreadQueries()
            .build()

    fun testCipher(): LocalRecordCipher = InMemoryLocalRecordCipher()
}
