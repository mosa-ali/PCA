/**
 * Minimal in-process, arbitrary-key rate limiter -- the same fixed-window
 * technique as backend/src/http/rateLimit.ts (bounded map, periodic sweep
 * of expired entries), but keyed by a caller-supplied string rather than
 * only `request.ip`, so registration/verification/login can each be
 * independently rate-limited BOTH per source IP and per submitted email
 * (PCA-ADD-IDENT-007 / WRITER57 assignment's negative-test requirement) --
 * http/rateLimit.ts's own factory has no email-keying hook, and it is not
 * this lane's file to extend. A single-instance, in-process limiter shares
 * the same documented multi-instance-deployment caveat as
 * http/rateLimit.ts's own header comment.
 */

interface WindowState {
  count: number;
  resetAt: number;
}

const SWEEP_INTERVAL = 1000;

export interface KeyedRateLimiter {
  /** Returns true iff this call is within budget (and counts against it); false means the caller must reject the request. */
  consume(bucket: string, key: string, windowMs: number, max: number): boolean;
}

export function createKeyedRateLimiter(): KeyedRateLimiter {
  const windows = new Map<string, WindowState>();
  let insertCount = 0;

  function sweepExpired(now: number): void {
    for (const [mapKey, state] of windows) {
      if (state.resetAt <= now) windows.delete(mapKey);
    }
  }

  return {
    consume(bucket: string, key: string, windowMs: number, max: number): boolean {
      const mapKey = `${bucket}:${key}`;
      const now = Date.now();
      const existing = windows.get(mapKey);
      if (!existing || existing.resetAt <= now) {
        windows.set(mapKey, { count: 1, resetAt: now + windowMs });
        insertCount += 1;
        if (insertCount % SWEEP_INTERVAL === 0) sweepExpired(now);
        return true;
      }
      existing.count += 1;
      return existing.count <= max;
    },
  };
}
