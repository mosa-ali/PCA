package org.pca.app.feature.youtube.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFailsWith
import org.junit.Test

class YouTubeSafeContentCapabilityTest {

    @Test
    fun `normal YouTube app is explicitly unsupported when no compliant signal exists`() {
        assertEquals(
            YouTubeSafeContentCapability(
                status = YouTubeSafeContentStatus.UNSUPPORTED,
                source = YouTubeSafeContentSource.UNAVAILABLE,
            ),
            YouTubeSafeContentCapability.unsupportedNormalYouTubeApp(),
        )
    }

    @Test
    fun `Restricted Mode source can report enabled or disabled`() {
        assertEquals(
            YouTubeSafeContentStatus.ENABLED,
            YouTubeSafeContentCapability(
                YouTubeSafeContentStatus.ENABLED,
                YouTubeSafeContentSource.YOUTUBE_RESTRICTED_MODE,
            ).status,
        )
        assertEquals(
            YouTubeSafeContentStatus.DISABLED,
            YouTubeSafeContentCapability(
                YouTubeSafeContentStatus.DISABLED,
                YouTubeSafeContentSource.YOUTUBE_RESTRICTED_MODE,
            ).status,
        )
    }

    @Test
    fun `unavailable source cannot make an enabled or disabled claim`() {
        assertFailsWith<IllegalArgumentException> {
            YouTubeSafeContentCapability(
                YouTubeSafeContentStatus.ENABLED,
                YouTubeSafeContentSource.UNAVAILABLE,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            YouTubeSafeContentCapability(
                YouTubeSafeContentStatus.DISABLED,
                YouTubeSafeContentSource.UNAVAILABLE,
            )
        }
    }
}
