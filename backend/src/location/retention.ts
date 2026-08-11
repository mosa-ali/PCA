import type { LocationSample } from './types.js';

export type LocationRetentionMode = 'CURRENT_LAST_ONLY' | 'HISTORY';

/** doc 16 Section 5 default: current/last only, unless the Family Owner deliberately selects history (bounded by doc 11's activity retention ceiling). */
export interface LocationRetentionPolicy {
  mode: LocationRetentionMode;
  historyRetentionDays: number | null;
}

export const DEFAULT_LOCATION_RETENTION_POLICY: LocationRetentionPolicy = {
  mode: 'CURRENT_LAST_ONLY',
  historyRetentionDays: null,
};

/**
 * Local-only retention interface: samples in, samples to keep out. Pure
 * and side-effect-free -- it never talks to a server, and lowering the
 * retention window only ever removes what is passed in; it can never
 * recreate a previously-deleted sample (doc 16 Section 5: "raising it does
 * not recreate past samples" -- true here simply because this function has
 * no access to anything but its own `samples` argument).
 */
export function pruneSamples(
  samples: LocationSample[],
  policy: LocationRetentionPolicy,
  nowUtc: Date,
): LocationSample[] {
  if (samples.length === 0) return [];

  if (policy.mode === 'CURRENT_LAST_ONLY') {
    const latest = samples.reduce((best, sample) =>
      sample.measuredAtUtc.getTime() > best.measuredAtUtc.getTime() ? sample : best,
    );
    return [latest];
  }

  if (policy.historyRetentionDays === null) {
    throw new RangeError('HISTORY retention mode requires historyRetentionDays.');
  }
  const cutoffMs = nowUtc.getTime() - policy.historyRetentionDays * 24 * 60 * 60 * 1000;
  return samples.filter((sample) => sample.measuredAtUtc.getTime() >= cutoffMs);
}
