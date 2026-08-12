package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.wellbeing.model.WellbeingCategory

class CategoryMappingTest {

    @Test
    fun `every SdkWellbeingCategory maps to exactly one Android category`() {
        for (sdk in SdkWellbeingCategory.entries) {
            val android = CategoryMapping.toAndroid(sdk)
            assertEquals(sdk, CategoryMapping.toSdkOrNull(android))
        }
    }

    @Test
    fun `the 12 shared categories map by identical name`() {
        val shared = SdkWellbeingCategory.entries.filter { it != SdkWellbeingCategory.CUSTOM }
        for (sdk in shared) {
            assertEquals(sdk.name, CategoryMapping.toAndroid(sdk).name)
        }
    }

    @Test
    fun `SDK CUSTOM maps to Android PARENT_CUSTOM_OTHER`() {
        assertEquals(WellbeingCategory.PARENT_CUSTOM_OTHER, CategoryMapping.toAndroid(SdkWellbeingCategory.CUSTOM))
    }

    @Test
    fun `Android CHILD_SELECTED_FAVORITES has no SDK equivalent`() {
        assertNull(CategoryMapping.toSdkOrNull(WellbeingCategory.CHILD_SELECTED_FAVORITES))
    }

    @Test
    fun `every Android category except CHILD_SELECTED_FAVORITES has an SDK equivalent`() {
        for (android in WellbeingCategory.entries) {
            if (android == WellbeingCategory.CHILD_SELECTED_FAVORITES) continue
            val sdk = CategoryMapping.toSdkOrNull(android)
            assertEquals(android, sdk?.let { CategoryMapping.toAndroid(it) })
        }
    }
}
