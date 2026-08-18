import { RETENTION_WINDOWS, type LocationRetentionMode, type RetentionWindow } from '../domain/retention';

/**
 * Client-side safety mirror of PCA-DATA-022. The server remains authoritative;
 * this helper prevents the UI from accepting a longer location window merely
 * because an API response changes the ordering of available windows.
 */
export function isLocationRetentionWithinGeneral(
  generalWindow: RetentionWindow | null | undefined,
  locationMode: LocationRetentionMode,
): boolean {
  if (locationMode === 'CURRENT_LAST_ONLY') return true;
  if (!generalWindow) return false;
  const generalIndex = RETENTION_WINDOWS.indexOf(generalWindow);
  const locationIndex = RETENTION_WINDOWS.indexOf(locationMode.window);
  return generalIndex >= 0 && locationIndex >= 0 && locationIndex <= generalIndex;
}
