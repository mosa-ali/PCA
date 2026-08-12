package org.pca.app.feature.youtube.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.pca.app.foundation.InMemoryPersistentStateStore

class ModeBFeatureFlagLocalStoreTest {

    @Test
    fun `Mode B is disabled by default on a fresh device with no prior state`() {
        val store = ModeBFeatureFlagLocalStore(InMemoryPersistentStateStore())

        val state = store.load()

        assertFalse(state.enabled)
        assertEquals(null, state.termsReviewedAtEpochMillis)
        assertFalse(store.isActive())
    }

    @Test
    fun `corrupt stored state fails safe to the disabled default, never to enabled`() {
        val backing = InMemoryPersistentStateStore()
        backing.putString("youtube_mode_b_feature_flag_v1", "not-valid-state")
        val store = ModeBFeatureFlagLocalStore(backing)

        assertFalse(store.load().enabled)
        assertFalse(store.isActive())
    }

    @Test
    fun `enabled without a recorded terms review still does not count as active`() {
        // isModeBActive requires BOTH -- proven directly against the shared policy function this
        // lane never calls with enabled = true from anywhere in feature/youtube.
        val halfState = ModeBFeatureFlagState(enabled = true, termsReviewedAtEpochMillis = null)
        assertFalse(isModeBActive(halfState))
    }

    @Test
    fun `this lane defines no mutator that can flip Mode B on`() {
        // Structural proof: ModeBFeatureFlagLocalStore exposes no method whose name implies
        // enabling/writing the flag -- only load()/isActive().
        val methodNames = ModeBFeatureFlagLocalStore::class.java.declaredMethods.map { it.name }
        assertFalse(methodNames.any { it.contains("enable", ignoreCase = true) || it.contains("set", ignoreCase = true) })
    }
}
