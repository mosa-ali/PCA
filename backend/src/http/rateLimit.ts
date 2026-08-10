import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Distinct budgets per route -- exhausting the invitation-creation budget must not affect bootstrap's budget. */
  bucket: string;
}

interface WindowState {
  count: number;
  resetAt: number;
}

// A distinct source IP (trivially multipliable via IPv6) that only ever
// sends one request per bucket creates one Map entry that's never touched
// again, so eviction cannot rely solely on "overwrite on next use." Sweep
// expired entries every SWEEP_INTERVAL insertions to keep the map bounded
// by "distinct keys active in roughly the last window," not "every key
// ever seen."
const SWEEP_INTERVAL = 1000;

/**
 * Minimal in-process fixed-window rate limiter: a bounded abuse control for
 * a single backend instance. A multi-instance deployment would need a
 * shared store (e.g. Redis) -- out of scope for this slice, and the
 * interface (a preHandler factory) is deliberately swappable later without
 * touching route code.
 *
 * Keyed by client IP + bucket, never by anything that would turn the
 * limiter itself into a token-validity oracle (e.g. never keyed by the
 * invitation token or a value derived from it).
 */
export function createRateLimiter() {
  const windows = new Map<string, WindowState>();
  let insertCount = 0;

  function sweepExpired(now: number): void {
    for (const [key, state] of windows) {
      if (state.resetAt <= now) windows.delete(key);
    }
  }

  return function rateLimit(options: RateLimitOptions) {
    return async function rateLimitPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const key = `${options.bucket}:${request.ip}`;
      const now = Date.now();
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + options.windowMs });
        insertCount += 1;
        if (insertCount % SWEEP_INTERVAL === 0) sweepExpired(now);
        return;
      }
      existing.count += 1;
      if (existing.count > options.max) {
        await reply.code(429).send({ error: 'rate_limited' });
      }
    };
  };
}
