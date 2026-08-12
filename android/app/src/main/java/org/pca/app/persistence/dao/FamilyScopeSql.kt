package org.pca.app.persistence.dao

/**
 * Shared SQL subquery fragments for family-scoped Delete Now (doc 11
 * Section 6 / PCA-LOCAL-DB-1 Section 21). Most activity/security tables do
 * not carry a `familyId` column directly -- they carry `deviceId` (or
 * `childDeviceId`/`actorMemberId`), and a device's family is reachable only
 * through `devices.memberId -> family_members.familyId`. Rather than adding
 * a redundant `familyId` column to every table (a schema/migration change
 * this defect fix does not need), family-scoped deletes join through this
 * existing relation so the deletion stays a single scoped SQL statement --
 * never "load every row, filter in Kotlin, delete by id."
 *
 * These are Kotlin `const val`s (not runtime-built strings) so they can be
 * spliced into `@Query` annotations, which require compile-time constants.
 */
object FamilyScopeSql {
    /** Device IDs belonging to a given family, via `devices.memberId -> family_members.familyId`. */
    const val DEVICE_IDS_FOR_FAMILY =
        "(SELECT deviceId FROM devices WHERE memberId IN (SELECT memberId FROM family_members WHERE familyId = :familyId))"

    /** Member IDs belonging to a given family -- for tables keyed by `actorMemberId`/`memberId` rather than `deviceId`. */
    const val MEMBER_IDS_FOR_FAMILY =
        "(SELECT memberId FROM family_members WHERE familyId = :familyId)"
}
