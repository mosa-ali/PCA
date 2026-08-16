package org.pca.app.feature.youtube.ui

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.webprotection.identity.WebProtectionIdentity
import org.pca.app.feature.webprotection.identity.WebProtectionIdentityContextProvider
import org.pca.app.feature.youtube.engine.ModeAAndroidUsageAdapter
import org.pca.app.feature.youtube.engine.YOUTUBE_APP_PACKAGE_NAME
import org.pca.app.feature.youtube.policy.ModeBFeatureFlagLocalStore
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageAccessState
import org.robolectric.RobolectricTestRunner

private const val FAMILY = "family-1"
private const val PROFILE = "device-1"
private const val DEVICE = "device-1"

/**
 * PCA-FR-054 closure (Writer73): real loading/success/error-state coverage for [YouTubeModeLoader]
 * -- the async orchestration [YouTubeModeActivity] needs but, before this pass, had no caller and
 * no test at all. Uses real port implementations with fakes at the boundary (a fake
 * [WebProtectionIdentityContextProvider], a real [ModeAAndroidUsageAdapter] over an in-memory DB,
 * a real [ModeBFeatureFlagLocalStore] over [InMemoryPersistentStateStore]) rather than mocking the
 * loader's own logic away.
 */
@RunWith(RobolectricTestRunner::class)
class YouTubeModeLoaderTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var usageSessions: UsageSessionRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        usageSessions = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private class FakeIdentityProvider(private val identity: WebProtectionIdentity) : WebProtectionIdentityContextProvider {
        override fun current(): WebProtectionIdentity = identity
    }

    @Test
    fun `SUCCESS -- a trusted identity with granted usage access resolves to a Success state carrying real measured evidence`() = runTest {
        usageSessions.record("s1", DEVICE, YOUTUBE_APP_PACKAGE_NAME, 0L, 600_000L, 600_000L, SourceConfidence.PLATFORM_API)
        val loader = YouTubeModeLoader(
            identityProvider = FakeIdentityProvider(WebProtectionIdentity.Trusted(FAMILY, PROFILE, DEVICE)),
            usageAdapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.GRANTED }),
            modeBFlagStore = ModeBFeatureFlagLocalStore(InMemoryPersistentStateStore()),
        )

        val result = loader.load()

        assertTrue(result is YouTubeModeLoadState.Success)
        val viewState = (result as YouTubeModeLoadState.Success).viewState
        assertEquals(600_000L, viewState.modeAEvidence?.durationMs)
        assertTrue(viewState.hasMeasuredUsage())
        assertEquals(false, viewState.isModeBAvailable)
    }

    @Test
    fun `ERROR -- no trusted family context yet (not enrolled or crypto not active) resolves to Error, never a fabricated view`() = runTest {
        val loader = YouTubeModeLoader(
            identityProvider = FakeIdentityProvider(WebProtectionIdentity.TrustedFamilyContextUnavailable),
            usageAdapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.GRANTED }),
            modeBFlagStore = ModeBFeatureFlagLocalStore(InMemoryPersistentStateStore()),
        )

        val result = loader.load()

        assertTrue(result is YouTubeModeLoadState.Error)
    }

    @Test
    fun `ERROR -- an unexpected exception from the usage-evidence read degrades to Error, never crashes the caller`() = runTest {
        val loader = YouTubeModeLoader(
            identityProvider = FakeIdentityProvider(WebProtectionIdentity.Trusted(FAMILY, PROFILE, DEVICE)),
            usageAdapter = ModeAAndroidUsageAdapter(
                usageSessions,
                accessState = { throw IllegalStateException("simulated AppOps read failure") },
            ),
            modeBFlagStore = ModeBFeatureFlagLocalStore(InMemoryPersistentStateStore()),
        )

        val result = loader.load()

        assertTrue(result is YouTubeModeLoadState.Error)
    }

    @Test
    fun `SUCCESS -- revoked usage access still resolves to Success, with the coverage gap honestly reflected (never zero usage)`() = runTest {
        val loader = YouTubeModeLoader(
            identityProvider = FakeIdentityProvider(WebProtectionIdentity.Trusted(FAMILY, PROFILE, DEVICE)),
            usageAdapter = ModeAAndroidUsageAdapter(usageSessions, accessState = { UsageAccessState.DENIED }),
            modeBFlagStore = ModeBFeatureFlagLocalStore(InMemoryPersistentStateStore()),
        )

        val result = loader.load()

        assertTrue(result is YouTubeModeLoadState.Success)
        val viewState = (result as YouTubeModeLoadState.Success).viewState
        assertEquals(false, viewState.hasMeasuredUsage())
        assertEquals(null, viewState.modeAEvidence?.durationMs)
    }
}
