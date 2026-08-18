import type { LocationCapabilityState, LocationSample } from './types.js';
import { isLocationSampleFresh } from './freshness.js';

export type SafeZoneTransitionType = 'ENTER' | 'EXIT' | 'DWELL';
export type SafeZoneEventKind = 'ENTER' | 'EXIT' | 'DWELL' | 'UNKNOWN' | 'NOT_MONITORED';

/** doc 16 Section 4. Default off; the parent chooses a conservative radius, PCA never infers one. */
export interface SafeZone {
  id: string;
  label: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  transitionTypes: SafeZoneTransitionType[];
  alertRecipientRoles: string[];
  policyRevision: number;
  enabled: boolean;
}

export interface EvaluateSafeZoneInput {
  zone: SafeZone;
  /** Whether the device was inside this zone as of the previous accepted sample, or `null` if unknown (no prior sample, or the zone was just enabled). */
  previousInside: boolean | null;
  sample: LocationSample | null;
  capabilityState: LocationCapabilityState;
  freshnessThresholdMs: number;
  nowUtc: Date;
}

export interface SafeZoneEvaluation {
  event: SafeZoneEventKind;
  currentInside: boolean | null;
}

const EARTH_RADIUS_METERS = 6_371_000;

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Deterministic geofence transition (doc 16 Section 4). Never manufactures
 * an ENTER/EXIT from a missing or stale sample -- degrades to UNKNOWN
 * (zone enabled but no trustworthy sample right now) or NOT_MONITORED
 * (zone disabled or the platform capability cannot support monitoring at
 * all), and DWELL only ever follows a transition that already resolved to
 * inside, never a bare timeout with no location evidence.
 */
export function evaluateSafeZoneTransition(input: EvaluateSafeZoneInput): SafeZoneEvaluation {
  if (!input.zone.enabled) {
    return { event: 'NOT_MONITORED', currentInside: input.previousInside };
  }
  if (input.capabilityState === 'NOT_CONFIGURED' || input.capabilityState === 'PERMISSION_DENIED' ||
    input.capabilityState === 'LOCATION_SERVICES_OFF') {
    return { event: 'NOT_MONITORED', currentInside: input.previousInside };
  }
  if (!input.sample) {
    return { event: 'UNKNOWN', currentInside: input.previousInside };
  }
  if (!isLocationSampleFresh(input.sample, input.nowUtc, input.freshnessThresholdMs)) {
    return { event: 'UNKNOWN', currentInside: input.previousInside };
  }

  const distance = haversineDistanceMeters(
    input.zone.centerLatitude,
    input.zone.centerLongitude,
    input.sample.latitude,
    input.sample.longitude,
  );
  const currentInside = distance <= input.zone.radiusMeters;

  if (input.previousInside === null) {
    return { event: 'UNKNOWN', currentInside };
  }
  if (currentInside && !input.previousInside && input.zone.transitionTypes.includes('ENTER')) {
    return { event: 'ENTER', currentInside };
  }
  if (!currentInside && input.previousInside && input.zone.transitionTypes.includes('EXIT')) {
    return { event: 'EXIT', currentInside };
  }
  if (currentInside && input.previousInside && input.zone.transitionTypes.includes('DWELL')) {
    return { event: 'DWELL', currentInside };
  }
  return { event: 'UNKNOWN', currentInside };
}
