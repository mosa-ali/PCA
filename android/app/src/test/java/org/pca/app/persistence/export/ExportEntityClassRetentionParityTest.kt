package org.pca.app.persistence.export

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PPR1R-D037 cross-boundary guard, in the same spirit as
 * [org.pca.app.runtime.schedule.ScheduleConformanceVectorTest]: it reads the OTHER side's real
 * source file rather than a hand-maintained Kotlin copy of it.
 *
 * Every `entityClass` string this device puts into a family export is a name the backend must be
 * able to act on: `http/routes/retentionRoutes.ts`'s `parseDeleteNowRecords` validates a parent's
 * Section 6 "Delete now" request against `ALL_RETENTION_ENTITY_CLASSES` in
 * `backend/src/retention/types.ts` and rejects anything else outright. An export that emits a
 * class outside that union produces records a parent can hold but can never name -- which is
 * exactly the defect that let installed-app records ship as `ROUTINE_ACTIVITY`, the union's
 * catch-all, instead of their own `INSTALLED_APP_EVENT`. A behavioural test catches that only for
 * the entity types it happens to seed; this catches it for every emitter in the file.
 */
class ExportEntityClassRetentionParityTest {

    @Test
    fun `every exported activity entityClass is a class the backend retention union can address`() {
        val backendClasses = backendRetentionEntityClasses()
        val emitted = emittedEntityClasses()

        assertTrue("no entityClass literals found in the export data source -- the scan is broken", emitted.isNotEmpty())
        val unaddressable = emitted - backendClasses - DELETION_EVIDENCE_CLASSES
        assertEquals(
            "the export emits activity entity classes the backend's ALL_RETENTION_ENTITY_CLASSES cannot address, " +
                "so a parent's Delete now request could never name those records: $unaddressable",
            emptySet<String>(),
            unaddressable,
        )
    }

    @Test
    fun `the deletion-evidence exemption stays exactly two classes, and each is genuinely outside the union`() {
        val backendClasses = backendRetentionEntityClasses()

        // Pinned so the exemption above can never quietly grow into a way to smuggle a real
        // activity class past the parity check.
        assertEquals(setOf("RETENTION_DELETION_RECEIPT", "DELETION_TOMBSTONE"), DELETION_EVIDENCE_CLASSES)
        assertEquals(
            "a deletion-evidence class has been added to the delete-now-addressable union -- that would let a " +
                "Delete now request erase the proof that a prior deletion happened.",
            emptySet<String>(),
            DELETION_EVIDENCE_CLASSES intersect backendClasses,
        )
    }

    @Test
    fun `installed-app records are emitted under their own itemized class, never the catch-all`() {
        val emitted = emittedEntityClasses()

        assertTrue(
            "the export no longer emits INSTALLED_APP_EVENT -- installed-app records are unaddressable by " +
                "Delete now again (PPR1R-D037).",
            "INSTALLED_APP_EVENT" in emitted,
        )
        assertTrue(
            "ROUTINE_ACTIVITY is doc 11 Section 3.1's catch-all for activity NOT otherwise itemized. Emitting a " +
                "record that has its own itemized class under it hides that record from the only name a parent has " +
                "for it. If a genuinely unitemized activity type is added later, this assertion is the place to " +
                "revisit -- deliberately, not by accident.",
            "ROUTINE_ACTIVITY" !in emitted,
        )
    }

    /** Parses the runtime union the backend actually validates against -- not a copy of it. */
    private fun backendRetentionEntityClasses(): Set<String> {
        val source = locateFromRepositoryRoot("backend/src/retention/types.ts")
            ?: error("could not locate backend/src/retention/types.ts from ${File(".").absolutePath}")
        val body = Regex("""ALL_RETENTION_ENTITY_CLASSES.*?=\s*\[(.*?)];""", RegexOption.DOT_MATCHES_ALL)
            .find(source.readText())
            ?.groupValues
            ?.get(1)
            ?: error("ALL_RETENTION_ENTITY_CLASSES array not found in backend/src/retention/types.ts")
        val classes = Regex("'([A-Z_]+)'").findAll(body).map { it.groupValues[1] }.toSet()
        assertTrue("parsed no entity classes out of ALL_RETENTION_ENTITY_CLASSES", classes.isNotEmpty())
        return classes
    }

    private fun emittedEntityClasses(): Set<String> {
        val source = locateFromRepositoryRoot("android/app/src/main/java/org/pca/app/persistence/export/LocalRoomFamilyExportDataSource.kt")
            ?: error("could not locate LocalRoomFamilyExportDataSource.kt from ${File(".").absolutePath}")
        return Regex("""entityClass\s*=\s*"([A-Z_]+)"""").findAll(source.readText()).map { it.groupValues[1] }.toSet()
    }

    /** Same walk-up strategy as `org.pca.app.runtime.schedule.locateSharedVectorFile`. */
    private fun locateFromRepositoryRoot(relativePath: String): File? =
        listOf(relativePath, "../$relativePath", "../../$relativePath", "../../../$relativePath")
            .map { File(it) }
            .firstOrNull { it.isFile }

    private companion object {
        /**
         * The two classes the export emits that are DELIBERATELY outside
         * `ALL_RETENTION_ENTITY_CLASSES`, and must stay outside it.
         *
         * `RETENTION_DELETION_RECEIPT` and `DELETION_TOMBSTONE` are doc 11 Section 5.1 deletion
         * EVIDENCE, not family activity: they exist to record that data was already deleted. They
         * belong in an export (a parent is entitled to see the proof) but must never be
         * delete-now targets -- a request that could erase the record of a prior deletion would
         * destroy the very evidence the deletion state machine exists to preserve. They are also
         * not general-window records; the device-side engine prunes tombstones under their own
         * rule (`RetentionEngine.pruneTombstones`), not the general cutoff.
         *
         * This is an exemption, not an oversight: every OTHER emitted class is an activity class
         * a parent must be able to name.
         */
        val DELETION_EVIDENCE_CLASSES = setOf("RETENTION_DELETION_RECEIPT", "DELETION_TOMBSTONE")
    }
}
