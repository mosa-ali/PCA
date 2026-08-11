import type { LocationDisplayState } from './types.js';
import type { SafeZoneEventKind } from './safeZone.js';

export interface SafeZonePresentationEntry {
  zoneId: string;
  zoneLabel: string;
  event: SafeZoneEventKind;
}

/**
 * The single view model the parent Location card renders from. Assembled
 * only from already-computed, already-honest facets (LocationDisplayState,
 * safe-zone evaluations) -- this module performs no measurement, no
 * distance math, and no freshness judgement of its own, so it cannot
 * accidentally re-introduce a collapsed "everything is fine" state.
 */
export interface ParentLocationPresentation {
  capabilityState: LocationDisplayState['capabilityState'];
  location: LocationDisplayState['location'];
  connection: LocationDisplayState['connection'];
  safeZones: SafeZonePresentationEntry[];
}

export function buildParentLocationPresentation(
  displayState: LocationDisplayState,
  safeZones: SafeZonePresentationEntry[],
): ParentLocationPresentation {
  return {
    capabilityState: displayState.capabilityState,
    location: displayState.location,
    connection: displayState.connection,
    safeZones,
  };
}
