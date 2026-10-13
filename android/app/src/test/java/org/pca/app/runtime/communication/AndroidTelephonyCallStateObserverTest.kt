package org.pca.app.runtime.communication

import android.Manifest
import android.app.Application
import android.content.Context
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

@RunWith(RobolectricTestRunner::class)
class AndroidTelephonyCallStateObserverTest {
    @Before
    fun resetShadow() {
        RegistrationLimitTelephonyManagerShadow.reset()
    }

    @Test
    @Config(sdk = [34], shadows = [RegistrationLimitTelephonyManagerShadow::class])
    fun `modern callback registration limit reports unavailable and clears partial registration`() {
        val events = startObserverWithRestoredException()

        assertEquals(listOf("UNAVAILABLE"), events)
        assertEquals(1, RegistrationLimitTelephonyManagerShadow.modernRegisterAttempts)
        assertEquals(1, RegistrationLimitTelephonyManagerShadow.modernCleanupAttempts)
        assertEquals(0, RegistrationLimitTelephonyManagerShadow.legacyRegisterAttempts)
    }

    @Test
    @Config(sdk = [30], shadows = [RegistrationLimitTelephonyManagerShadow::class])
    fun `legacy listener registration limit reports unavailable and clears partial registration`() {
        val events = startObserverWithRestoredException()

        assertEquals(listOf("UNAVAILABLE"), events)
        assertEquals(1, RegistrationLimitTelephonyManagerShadow.legacyRegisterAttempts)
        assertEquals(1, RegistrationLimitTelephonyManagerShadow.legacyCleanupAttempts)
        assertEquals(0, RegistrationLimitTelephonyManagerShadow.modernRegisterAttempts)
    }

    private fun startObserverWithRestoredException(): List<String> {
        val context = ApplicationProvider.getApplicationContext<Context>()
        shadowOf(context.applicationContext as Application)
            .grantPermissions(Manifest.permission.READ_PHONE_STATE)

        val events = mutableListOf<String>()
        val coordinator = CommunicationExceptionCoordinator(
            onCommunicationStarted = { events += "START" },
            onCommunicationEnded = { events += "END" },
            onCommunicationObservationUnavailable = { events += "UNAVAILABLE" },
            initiallyActive = true,
        )
        CommunicationCallLifecycleAdapter(
            observer = AndroidTelephonyCallStateObserver(context),
            coordinator = coordinator,
        ).start()
        return events
    }
}

@Implements(TelephonyManager::class)
class RegistrationLimitTelephonyManagerShadow {
    companion object {
        var modernRegisterAttempts = 0
        var modernCleanupAttempts = 0
        var legacyRegisterAttempts = 0
        var legacyCleanupAttempts = 0

        fun reset() {
            modernRegisterAttempts = 0
            modernCleanupAttempts = 0
            legacyRegisterAttempts = 0
            legacyCleanupAttempts = 0
        }
    }

    @Implementation(minSdk = 31)
    protected fun registerTelephonyCallback(executor: Executor, callback: TelephonyCallback) {
        modernRegisterAttempts += 1
        throw IllegalStateException("callback registration limit")
    }

    @Implementation(minSdk = 31)
    protected fun unregisterTelephonyCallback(callback: TelephonyCallback) {
        modernCleanupAttempts += 1
    }

    @Suppress("DEPRECATION")
    @Implementation(maxSdk = 30)
    protected fun listen(listener: PhoneStateListener?, events: Int) {
        if (events == PhoneStateListener.LISTEN_CALL_STATE) {
            legacyRegisterAttempts += 1
            throw IllegalStateException("listener registration limit")
        }
        if (events == PhoneStateListener.LISTEN_NONE) {
            legacyCleanupAttempts += 1
        }
    }
}
