import type { LocationCapabilityState, LocationDisplayState, LastSeenRecord, LocationSample } from './types.js';

/** doc 16 Section 1: "Current" default freshness threshold -- a display state, not proof of physical presence. */
export const DEFAULT_FRESHNESS_THRESHOLD_MS = 15 * 60 * 1000;
/** doc 16 Section 1: last-seen/offline threshold is independent of the location-freshness threshold -- connection facet, not the location facet. */
export const DEFAULT_CONNECTION_OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

export interface ComputeDisplayStateInput {
  sample: LocationSample | null;
  lastSeen: LastSeenRecord | null;
  capabilityState: LocationCapabilityState;
  nowUtc: Date;
  freshnessThresholdMs?: number;
  connectionOfflineThresholdMs?: number;
}

/**
 * Pure derivation of the parent-facing location/connection display state.
 * Never extrapolates a position and never lets one facet's staleness leak
 * into the other's label (doc 16 Section 1's "Last seen" definition: "must
 * never be rendered as [a location measurement]").
 */
export function computeLocationDisplayState(input: ComputeDisplayStateInput): LocationDisplayState {
  const freshnessThresholdMs = input.freshnessThresholdMs ?? DEFAULT_FRESHNESS_THRESHOLD_MS;
  const connectionOfflineThresholdMs = input.connectionOfflineThresholdMs ?? DEFAULT_CONNECTION_OFFLINE_THRESHOLD_MS;

  const location = (() => {
    if (!input.sample) {
      return { freshness: 'NO_SAMPLE' as const, measuredAtUtc: null, accuracyMeters: null, source: null };
    }
    const ageMs = input.nowUtc.getTime() - input.sample.measuredAtUtc.getTime();
    const freshness = ageMs >= 0 && ageMs <= freshnessThresholdMs ? ('FRESH' as const) : ('STALE' as const);
    return {
      freshness,
      measuredAtUtc: input.sample.measuredAtUtc,
      accuracyMeters: input.sample.horizontalAccuracyMeters,
      source: input.sample.source,
    };
  })();

  const connection = (() => {
    if (!input.lastSeen) {
      return { freshness: 'UNKNOWN' as const, lastAuthenticatedAtUtc: null };
    }
    const ageMs = input.nowUtc.getTime() - input.lastSeen.lastAuthenticatedAtUtc.getTime();
    const freshness = ageMs >= 0 && ageMs <= connectionOfflineThresholdMs ? ('ONLINE' as const) : ('OFFLINE' as const);
    return { freshness, lastAuthenticatedAtUtc: input.lastSeen.lastAuthenticatedAtUtc };
  })();

  return { capabilityState: input.capabilityState, location, connection };
}
