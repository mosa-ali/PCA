export type OpaqueAppToken = string;

/**
 * PCA-FR-040/PCA-FR-041. Only capability states the child device can
 * actually distinguish. `ACTIVE` is the only state in which reported
 * usage may be treated as complete for the covered interval; every other
 * state MUST surface as a visible gap, never as silent zero usage
 * (doc 15 "Unavailable is a valid result; missing evidence must never be
 * displayed as zero use").
 */
export type UsageCapabilityState =
  | 'ACTIVE'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_REVOKED'
  | 'UNSUPPORTED'
  | 'DEGRADED'
  | 'NOT_CONFIGURED';

export type UsagePlatformSource = 'ANDROID_USAGE_STATS' | 'IOS_DEVICE_ACTIVITY';

/**
 * One raw signal as handed to this module by a platform adapter (PCA-2's
 * UsageStats adapter, or an iOS Device Activity adapter). This module
 * never talks to a platform API itself -- see UsageObservationSource.
 * `endAtMonotonicMs` is `null` for an in-progress/foreground session with
 * no observed end yet; normalization preserves that as an open session,
 * never inventing an end time.
 */
export interface RawUsageObservation {
  appToken: OpaqueAppToken;
  source: UsagePlatformSource;
  startAtMonotonicMs: number;
  endAtMonotonicMs: number | null;
  /** Wall-clock instant corresponding to startAtMonotonicMs, captured once at observation time so normalization can render calendar-local sessions without itself depending on wall-clock deltas (PCA-FR-017: elapsed tracking is monotonic-anchored). */
  startAtWallClock: Date;
}

/**
 * The narrow platform port PCA-4 depends on. PCA-2 owns the concrete
 * Android UsageStats-backed implementation (and any future iOS Device
 * Activity implementation); this module only ever consumes this
 * interface, never a concrete adapter, so no platform code is duplicated
 * here.
 */
export interface UsageObservationSource {
  getCapabilityState(): UsageCapabilityState;
  /** Raw observations since the given monotonic instant, in arrival order; may overlap or duplicate, normalization is this module's job. */
  observeSince(sinceMonotonicMs: number): RawUsageObservation[];
}

export type UsageIntegrityEventKind =
  | 'REBOOT'
  | 'PERMISSION_REVOKED'
  | 'OS_HISTORY_PRUNED'
  | 'WALL_CLOCK_ROLLBACK'
  | 'UNSUPPORTED_DEVICE'
  | 'PROCESS_RESTART';

export interface UsageIntegrityEvent {
  kind: UsageIntegrityEventKind;
  atWallClock: Date;
}

/**
 * Local, normalized app-usage session (doc 15 "App-usage normalization").
 * `coverageGap` marks a session whose true end is unknown -- normalization
 * must set this rather than fabricate `endAtMonotonicMs`.
 */
export interface UsageSession {
  appToken: OpaqueAppToken;
  source: UsagePlatformSource;
  startAtMonotonicMs: number;
  endAtMonotonicMs: number | null;
  startAtWallClock: Date;
  coverageGap: boolean;
}
