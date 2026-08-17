package org.pca.app.runtime.schedule

import org.pca.app.platform.DevicePolicyCapabilitySource
import org.pca.app.platform.ManagedDeviceAuthority
import org.pca.app.runtime.port.ScheduleEnforcementOutcome

/**
 * The concrete enforcement boundary after [ScheduleRuntime] has produced a decision. A
 * consumer must never infer enforcement from the decision alone: it must return the outcome of
 * the documented platform operation, or [ScheduleEnforcementOutcome.UNAVAILABLE].
 */
interface ScheduleEnforcementConsumer {
    fun apply(
        packageName: String,
        appToken: OpaqueAppToken,
        decision: ScheduleDecision,
        communicationSurfaces: CommunicationSafetySurfaceTokens,
    ): ScheduleEnforcementOutcome
}

/** No-op boundary used by tests and by compositions that have no supported enforcement authority. */
object NoOpScheduleEnforcementConsumer : ScheduleEnforcementConsumer {
    override fun apply(
        packageName: String,
        appToken: OpaqueAppToken,
        decision: ScheduleDecision,
        communicationSurfaces: CommunicationSafetySurfaceTokens,
    ): ScheduleEnforcementOutcome = ScheduleEnforcementOutcome.UNAVAILABLE
}

/**
 * Supported Protected Mode consumer. Package suspension is deliberately narrower than a generic
 * allowlist: the emergency, incoming-call, and SMS transport tokens are preserved before any DPM
 * call. Android does not expose a public package-level API that blocks Messages UI while keeping
 * delivery separate, so preserving the SMS transport is reported honestly rather than presented
 * as a narrower restriction than the platform can provide.
 */
class DevicePolicyScheduleEnforcementConsumer(
    private val authoritySource: DevicePolicyCapabilitySource,
    private val packageSuspensionExecutor: PackageSuspensionExecutor,
) : ScheduleEnforcementConsumer {

    override fun apply(
        packageName: String,
        appToken: OpaqueAppToken,
        decision: ScheduleDecision,
        communicationSurfaces: CommunicationSafetySurfaceTokens,
    ): ScheduleEnforcementOutcome {
        if (packageName.isBlank()) return ScheduleEnforcementOutcome.UNAVAILABLE

        if (
            EmergencyAccessFloor.isProtectedToken(appToken, communicationSurfaces.emergencySurfaceTokens) ||
            appToken in communicationSurfaces.callSurfaceTokens ||
            appToken in communicationSurfaces.smsTransportTokens
        ) {
            return ScheduleEnforcementOutcome.PRESERVED_SAFETY_SURFACE
        }

        if (authoritySource.currentAuthority() != ManagedDeviceAuthority.DEVICE_OWNER) {
            return ScheduleEnforcementOutcome.UNAVAILABLE
        }

        val shouldSuspend = when (decision.decision) {
            ScheduleDecisionKind.BLOCKED_BEDTIME,
            ScheduleDecisionKind.BLOCKED_SCHOOL_MODE,
            ScheduleDecisionKind.BLOCKED_PERIOD,
            ScheduleDecisionKind.BLOCKED_OUTSIDE_ALLOW_PERIOD,
            ScheduleDecisionKind.BLOCKED_LIMIT_REACHED,
            -> true
            ScheduleDecisionKind.ALLOWED,
            ScheduleDecisionKind.ALLOWED_BONUS,
            ScheduleDecisionKind.ALLOWED_EXCEPTION,
            -> false
            ScheduleDecisionKind.ENFORCEMENT_UNAVAILABLE,
            ScheduleDecisionKind.INVALID_CONFIG,
            -> return ScheduleEnforcementOutcome.UNAVAILABLE
        }

        val applied = runCatching {
            packageSuspensionExecutor.setSuspended(packageName, shouldSuspend)
        }.getOrDefault(false)
        if (!applied) return ScheduleEnforcementOutcome.FAILED
        return if (shouldSuspend) ScheduleEnforcementOutcome.APPLIED else ScheduleEnforcementOutcome.RELEASED
    }
}

/** Narrow platform operation used to keep the policy/consumer decision unit-testable. */
interface PackageSuspensionExecutor {
    fun setSuspended(packageName: String, suspended: Boolean): Boolean
}
