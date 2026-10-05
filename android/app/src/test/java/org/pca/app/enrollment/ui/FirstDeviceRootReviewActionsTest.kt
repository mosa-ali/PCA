package org.pca.app.enrollment.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.firstdevice.FirstDeviceCeremonySeed
import org.pca.app.firstdevice.FirstDeviceRootRecord
import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.FirstDeviceSubmissionPayload

class FirstDeviceRootReviewActionsTest {
    private fun record(
        state: FirstDeviceRootState,
        submission: FirstDeviceSubmissionPayload? = null,
        deviceId: String = "device-1",
        ceremonyId: String? = "ceremony-1",
    ) = FirstDeviceRootRecord(
        seed = FirstDeviceCeremonySeed(
            attemptId = "attempt-1",
            attemptRecoveryToken = "recovery-token",
            serverBaseUrl = "https://api.example.test",
            deviceId = deviceId,
            signingKeyId = "dsk-1",
            encryptionKeyId = "dek-1",
            dskPublicKeyBase64 = "dsk-public",
            dekPublicKeyBase64 = "dek-public",
            dskAlias = "pca.dsk.attempt-1",
            dekAlias = "pca.dek.attempt-1",
        ),
        state = state,
        ceremonyId = ceremonyId,
        submission = submission,
    )

    private fun savedSubmission() = FirstDeviceSubmissionPayload(
        proofBytes = "proof-bytes",
        proofSignature = "proof-signature",
        epoch1Bytes = "epoch-bytes",
        epoch1Signature = "epoch-signature",
        attestationEvidence = "evidence-json",
    )

    @Test
    fun `submit action is available only for authoritative APPROVED state`() {
        for (state in FirstDeviceRootState.values()) {
            val actions = firstDeviceRootReviewActions(record(state), "device-1")
            assertEquals(
                "submit action for $state",
                state == FirstDeviceRootState.APPROVED,
                FirstDeviceRootReviewAction.SUBMIT_PROOF in actions,
            )
        }
    }

    @Test
    fun `unknown and submitting states permit only status refresh or exact saved replay`() {
        for (state in listOf(FirstDeviceRootState.UNKNOWN, FirstDeviceRootState.SUBMITTING)) {
            assertEquals(
                setOf(FirstDeviceRootReviewAction.REFRESH_STATUS),
                firstDeviceRootReviewActions(record(state), "device-1"),
            )
            assertEquals(
                setOf(
                    FirstDeviceRootReviewAction.REFRESH_STATUS,
                    FirstDeviceRootReviewAction.REPLAY_EXACT_SUBMISSION,
                ),
                firstDeviceRootReviewActions(record(state, savedSubmission()), "device-1"),
            )
        }
    }

    @Test
    fun `unknown without a ceremony or persisted submission offers only an explicit challenge retry`() {
        assertEquals(
            setOf(FirstDeviceRootReviewAction.START_REVIEW),
            firstDeviceRootReviewActions(
                record(FirstDeviceRootState.UNKNOWN, ceremonyId = null),
                "device-1",
            ),
        )
        assertEquals(
            setOf(
                FirstDeviceRootReviewAction.REFRESH_STATUS,
                FirstDeviceRootReviewAction.REPLAY_EXACT_SUBMISSION,
            ),
            firstDeviceRootReviewActions(
                record(FirstDeviceRootState.UNKNOWN, savedSubmission(), ceremonyId = null),
                "device-1",
            ),
        )
    }

    @Test
    fun `start and terminal actions match the coordinator ceremony policy`() {
        assertEquals(
            setOf(FirstDeviceRootReviewAction.START_REVIEW),
            firstDeviceRootReviewActions(record(FirstDeviceRootState.NOT_STARTED), "device-1"),
        )
        assertEquals(
            setOf(FirstDeviceRootReviewAction.START_REVIEW),
            firstDeviceRootReviewActions(record(FirstDeviceRootState.EXPIRED), "device-1"),
        )
        assertEquals(
            emptySet<FirstDeviceRootReviewAction>(),
            firstDeviceRootReviewActions(record(FirstDeviceRootState.ROOT_COMMITTED), "device-1"),
        )
        assertEquals(
            setOf(FirstDeviceRootReviewAction.REFRESH_STATUS),
            firstDeviceRootReviewActions(record(FirstDeviceRootState.REJECTED), "device-1"),
        )
    }

    @Test
    fun `root actions are scoped to the pairing-pending device and no missing record is actionable`() {
        assertTrue(firstDeviceRootReviewActions(null, "device-1").isEmpty())
        assertTrue(firstDeviceRootReviewActions(record(FirstDeviceRootState.NOT_STARTED, deviceId = "other-device"), "device-1").isEmpty())
    }

    @Test
    fun `activity connects explicit root-review actions to the application graph coordinator`() {
        val candidates = listOf(
            File("src/main/java/org/pca/app/enrollment/EnrollmentActivity.kt"),
            File("app/src/main/java/org/pca/app/enrollment/EnrollmentActivity.kt"),
        )
        val source = candidates.firstOrNull { it.exists() }?.readText()
            ?: error("EnrollmentActivity.kt was not found")

        assertTrue(source.contains("graph.firstDeviceTrustRootCoordinator"))
        assertTrue(source.contains("onStartFirstDeviceRootReview = {"))
        assertTrue(source.contains("firstDeviceRootCoordinator.beginCeremony()"))
        assertTrue(source.contains("firstDeviceRootCoordinator.refreshStatus()"))
        assertTrue(source.contains("firstDeviceRootCoordinator.submit()"))
        assertTrue(source.contains("firstDeviceRootCoordinator.resubmitExact()"))
        assertTrue(source.contains("firstDeviceRootRecord = graph.firstDeviceRootStore.current()"))
        assertFalse("the root ceremony must not start automatically during composition", source.contains("LaunchedEffect("))
    }

    @Test
    fun `root review panel is rendered only in the pairing-pending state and maps every authoritative state`() {
        val candidates = listOf(
            File("src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt"),
            File("app/src/main/java/org/pca/app/enrollment/ui/EnrollmentScreen.kt"),
        )
        val source = candidates.firstOrNull { it.exists() }?.readText()
            ?: error("EnrollmentScreen.kt was not found")
        val pendingBranch = source.substringAfter("is EnrollmentState.PairingPending ->")
            .substringBefore("is EnrollmentState.FailedInvitationInvalid ->")
        assertTrue(pendingBranch.contains("FirstDeviceRootReviewPanel("))
        assertFalse(source.substringBefore("is EnrollmentState.PairingPending ->").contains("FirstDeviceRootReviewPanel("))
        for (stateName in listOf("not_started", "awaiting_approval", "approved", "submitting", "committed", "expired", "rejected", "unknown")) {
            assertTrue("missing localized mapping for $stateName", source.contains("enrollment_root_status_$stateName"))
        }
        assertFalse(source.contains("EnrollmentState.Paired"))
        assertFalse(source.contains("EnrollmentState.Active"))
    }

    @Test
    fun `committed copy keeps family-root acceptance separate from device pairing and protection`() {
        val english = File("src/main/res/values/strings.xml").readText()
        val arabic = File("src/main/res/values-ar/strings.xml").readText()
        val englishCommitted = Regex("<string name=\"enrollment_root_status_committed\">(.*?)</string>")
            .find(english)?.groupValues?.get(1).orEmpty()
        val arabicCommitted = Regex("<string name=\"enrollment_root_status_committed\">(.*?)</string>")
            .find(arabic)?.groupValues?.get(1).orEmpty()

        assertTrue(englishCommitted.contains("pairing state"))
        assertFalse(englishCommitted.contains("active"))
        assertTrue(arabicCommitted.contains("حالة الاقتران"))
    }
}
