import type { LocationSample } from './types.js';

/**
 * A location sample is usable only while both freshness bounds hold:
 * measured time must not be in the future, the age must be within the
 * caller's display/geofence window, and the sample's explicit expiry must
 * still be in the future. The expiry check is intentionally independent of
 * measuredAtUtc so a stale record can never be revived by a broad display
 * threshold or a clock mistake.
 */
export function isLocationSampleFresh(
  sample: LocationSample,
  nowUtc: Date,
  freshnessThresholdMs: number,
): boolean {
  const nowMs = nowUtc.getTime();
  const measuredAtMs = sample.measuredAtUtc.getTime();
  const expiresAtMs = sample.expiresAtUtc.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(measuredAtMs) || !Number.isFinite(expiresAtMs)) return false;
  if (!Number.isFinite(freshnessThresholdMs) || freshnessThresholdMs < 0) return false;

  const ageMs = nowMs - measuredAtMs;
  return ageMs >= 0 && ageMs <= freshnessThresholdMs && nowMs < expiresAtMs;
}
