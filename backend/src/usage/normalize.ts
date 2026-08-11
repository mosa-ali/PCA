import type { RawUsageObservation, UsageIntegrityEvent, UsageSession } from './types.js';

export interface NormalizeResult {
  sessions: UsageSession[];
  integrityEvents: UsageIntegrityEvent[];
}

/**
 * Deduplicates/merges raw platform observations into local UsageSession
 * records (doc 15 "App-usage normalization"). `rawObservationsInArrivalOrder`
 * must be in the order the platform adapter actually produced them --
 * arrival order (not sorted by startAt) is what lets this function detect a
 * monotonic-clock reset (reboot) independently of any wall-clock signal.
 *
 * Deterministic and pure: no I/O, no current-time reads. Coverage gaps are
 * preserved rather than invented end times (doc 15).
 */
export function normalizeUsageObservations(rawObservationsInArrivalOrder: RawUsageObservation[]): NormalizeResult {
  const integrityEvents: UsageIntegrityEvent[] = [];

  let maxMonotonicSeen = -Infinity;
  let maxWallClockAtMaxMonotonic: Date | null = null;
  for (const raw of rawObservationsInArrivalOrder) {
    if (raw.startAtMonotonicMs < maxMonotonicSeen) {
      integrityEvents.push({ kind: 'REBOOT', atWallClock: raw.startAtWallClock });
    } else if (
      maxWallClockAtMaxMonotonic !== null &&
      raw.startAtWallClock.getTime() < maxWallClockAtMaxMonotonic.getTime()
    ) {
      integrityEvents.push({ kind: 'WALL_CLOCK_ROLLBACK', atWallClock: raw.startAtWallClock });
    }
    if (raw.startAtMonotonicMs >= maxMonotonicSeen) {
      maxMonotonicSeen = raw.startAtMonotonicMs;
      maxWallClockAtMaxMonotonic = raw.startAtWallClock;
    }
  }

  const byApp = new Map<string, RawUsageObservation[]>();
  for (const raw of rawObservationsInArrivalOrder) {
    const bucket = byApp.get(raw.appToken);
    if (bucket) bucket.push(raw);
    else byApp.set(raw.appToken, [raw]);
  }

  const sessions: UsageSession[] = [];
  for (const observations of byApp.values()) {
    const sorted = [...observations].sort((a, b) => a.startAtMonotonicMs - b.startAtMonotonicMs);
    let current: UsageSession | null = null;
    for (const raw of sorted) {
      if (current === null) {
        current = toSession(raw);
        continue;
      }
      const currentEnd = current.endAtMonotonicMs;
      const overlapsOrTouches = currentEnd !== null && raw.startAtMonotonicMs <= currentEnd;
      if (overlapsOrTouches) {
        if (raw.endAtMonotonicMs === null) {
          current.endAtMonotonicMs = null;
        } else if (current.endAtMonotonicMs !== null) {
          current.endAtMonotonicMs = Math.max(current.endAtMonotonicMs, raw.endAtMonotonicMs);
        }
        continue;
      }
      // A prior session left open (no observed end) whose app resumed
      // later without ever reporting a close is a real coverage gap, not
      // a merge candidate -- the true end between the two is unknown.
      if (current.endAtMonotonicMs === null) {
        current.coverageGap = true;
      }
      sessions.push(current);
      current = toSession(raw);
    }
    if (current !== null) sessions.push(current);
  }

  sessions.sort((a, b) => a.startAtMonotonicMs - b.startAtMonotonicMs);
  return { sessions, integrityEvents };
}

function toSession(raw: RawUsageObservation): UsageSession {
  return {
    appToken: raw.appToken,
    source: raw.source,
    startAtMonotonicMs: raw.startAtMonotonicMs,
    endAtMonotonicMs: raw.endAtMonotonicMs,
    startAtWallClock: raw.startAtWallClock,
    coverageGap: raw.endAtMonotonicMs === null,
  };
}

/** Total covered milliseconds for one app across normalized sessions, excluding still-open/coverage-gap sessions unless `includeOpenAsOf` supplies a current monotonic instant to close them against. */
export function sumSessionDurationMs(sessions: UsageSession[], appToken: string, includeOpenAsOf?: number): number {
  let total = 0;
  for (const session of sessions) {
    if (session.appToken !== appToken) continue;
    if (session.endAtMonotonicMs !== null) {
      total += session.endAtMonotonicMs - session.startAtMonotonicMs;
    } else if (includeOpenAsOf !== undefined && includeOpenAsOf >= session.startAtMonotonicMs) {
      total += includeOpenAsOf - session.startAtMonotonicMs;
    }
  }
  return total;
}
