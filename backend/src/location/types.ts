export type OpaqueDeviceId = string;

/** doc 16 Section 6 -- the exact capability-state enumeration the UI must expose; no state may silently appear healthy. */
export type LocationCapabilityState =
  | 'NOT_CONFIGURED'
  | 'PERMISSION_DENIED'
  | 'APPROXIMATE'
  | 'BACKGROUND_NOT_GRANTED'
  | 'LOCATION_SERVICES_OFF'
  | 'BATTERY_RESTRICTED'
  | 'OS_LIMITED'
  | 'STALE'
  | 'OFFLINE'
  | 'ACTIVE';

export type LocationSourceClass = 'precise' | 'approximate' | 'manual-city' | 'unknown';

/** doc 16 Section 2 minimum sample fields. Coordinates never leave this module in plaintext toward anything but the local family vault -- see retention.ts and presentation.ts. */
export interface LocationSample {
  deviceId: OpaqueDeviceId;
  sampleId: string;
  measuredAtUtc: Date;
  receivedAtUtc: Date;
  latitude: number;
  longitude: number;
  /** `null` when the platform did not report an accuracy figure -- must render as "accuracy unavailable", never a false zero. */
  horizontalAccuracyMeters: number | null;
  source: LocationSourceClass;
  batteryPercent: number | null;
  trustEpoch: number;
  expiresAtUtc: Date;
}

/**
 * The narrow platform port PCA-7 depends on. PCA-2 owns the concrete
 * Android adapter (and any future iOS adapter); this module only ever
 * consumes this interface.
 */
export interface LocationObservationSource {
  getCapabilityState(): LocationCapabilityState;
  getLatestSample(): LocationSample | null;
}

/** PCA-FR-062: last authenticated PCA connection/relay receipt time -- never a location measurement, must never be rendered as one (doc 16 Section 1). */
export interface LastSeenRecord {
  deviceId: OpaqueDeviceId;
  lastAuthenticatedAtUtc: Date;
}

export type LocationFreshness = 'FRESH' | 'STALE' | 'NO_SAMPLE';
export type ConnectionFreshness = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

/**
 * The two facets doc 16 requires to stay independently visible: a location
 * facet (measurement age/accuracy) and a connection facet (last-seen).
 * Deliberately not collapsed into a single boolean/status.
 */
export interface LocationDisplayState {
  capabilityState: LocationCapabilityState;
  location: {
    freshness: LocationFreshness;
    measuredAtUtc: Date | null;
    accuracyMeters: number | null;
    source: LocationSourceClass | null;
  };
  connection: {
    freshness: ConnectionFreshness;
    lastAuthenticatedAtUtc: Date | null;
  };
}
