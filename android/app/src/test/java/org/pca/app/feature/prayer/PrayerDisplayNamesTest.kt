package org.pca.app.feature.prayer

import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.prayer.model.PrayerName

class PrayerDisplayNamesTest {
    @Test
    fun `every PrayerName has a mapped display string resource`() {
        for (prayer in PrayerName.entries) {
            // A Kotlin `when` with no `else` branch over an enum is exhaustive at compile time --
            // this test exists to keep that guarantee visible/documented as a PCA-16 contract,
            // not to catch something the compiler wouldn't already catch.
            assertTrue("displayNameRes() must return a valid resource id for $prayer", prayer.displayNameRes() != 0)
        }
    }
}
