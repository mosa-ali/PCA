package org.pca.app.runtime.port

enum class ScheduleEnforcementOutcome {
    NOT_ATTEMPTED,
    APPLIED,
    RELEASED,
    PRESERVED_SAFETY_SURFACE,
    UNAVAILABLE,
    FAILED,
}

/**
 * Real, observable schedule-evaluation status this runtime can act on -- no default collapses to
 * a boolean "allowed"/"blocked". Section 8 of the PCA-RUNTIME-ANDROID-1 brief is explicit that
 * "offline => false" and "missing schedule => false" are NOT acceptable defaults: an implementer
 * (Agent 10, `runtime.schedule package`) must report exactly which of these applies rather than the
 * runtime silently guessing.
 */
enum class ScheduleRuntimeStatus {
    /** A schedule is loaded and currently evaluable; its verdict can be trusted. */
    AVAILABLE,
    /** A schedule exists but is not currently applicable/enforcing (e.g. outside any configured
     * window) -- distinct from [NOT_READY] (no schedule at all) and [EPOCH_STALE] (stale data). */
    UNAVAILABLE,
    /** No schedule has been loaded yet (first run, not yet synced, or still initializing) --
     * distinct from a schedule that was loaded and evaluated to "not applicable right now". */
    NOT_READY,
    /** A schedule was loaded but its policy epoch is stale (superseded by a newer family policy
     * this device has not yet received/applied) -- its verdict must not be trusted as current. */
    EPOCH_STALE,
}

/**
 * Coordinator-bound port: Agent 10 (`runtime.schedule package`) owns the concrete implementation. This
 * composition layer only depends on the interface so it compiles and is fully testable before
 * that binding exists (see `NotReadyScheduleRuntimePort` below, the conservative placeholder used
 * until the coordinator wires the real one in).
 */
interface ScheduleRuntimePort {
    fun currentStatus(): ScheduleRuntimeStatus

    /** Applies the current schedule decision to one locally observed package. */
    fun enforce(packageName: String): ScheduleEnforcementOutcome = ScheduleEnforcementOutcome.UNAVAILABLE
}

/**
 * Conservative placeholder: always reports [ScheduleRuntimeStatus.NOT_READY] rather than
 * fabricating a schedule verdict this lane has no way to actually observe. Matches the same
 * boundary discipline as `NoOpWellbeingScheduleContextSource` in
 * `feature/wellbeing/ports/StandardWellbeingPorts.kt` -- a real adapter is a Coordinator
 * integration task, not something this worktree invents.
 */
class NotReadyScheduleRuntimePort : ScheduleRuntimePort {
    override fun currentStatus(): ScheduleRuntimeStatus = ScheduleRuntimeStatus.NOT_READY
}
