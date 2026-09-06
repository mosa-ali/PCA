/**
 * PCA-DW-W2-15D -- the single runtime-environment authority for the
 * backend. Before this module existed, "is this production" was checked
 * independently in at least two places (parentaccount/cookies.ts,
 * billing/provider/sandboxProvider.ts's identical-but-separate inline
 * check) with no guarantee the two answers ever agreed. That asymmetry is
 * exactly the shape of bug this module exists to make impossible: every
 * module that gates production-sensitive behaviour (Secure cookies,
 * trustProxy configuration, verification-code HMAC secret enforcement, the
 * email/payment sandbox gates) must call one of the two functions below
 * instead of reading `NODE_ENV` itself.
 *
 * Two functions, two different failure shapes, both deliberate:
 *
 *  - `isProductionSensitiveRuntime` NEVER throws. It is called on hot paths
 *    (every response's cookie serialization, every rate-limited request).
 *    A misconfigured/unset/misspelled NODE_ENV degrades to "treat this as
 *    production" -- the most restrictive posture -- never to a crash loop
 *    and never to a silently-relaxed (insecure) posture. This is what
 *    "fail closed" means for this function.
 *
 *  - `assertKnownRuntimeEnvironment` DOES throw, but only when called --
 *    it is boot-time defense in depth (main.ts calls it once at startup),
 *    surfacing a genuinely misconfigured NODE_ENV loudly and early rather
 *    than letting the process run indefinitely in the maximally-restrictive
 *    fallback posture without anyone noticing.
 */

export type PcaKnownRuntimeEnvironment = 'test' | 'development' | 'production';

const KNOWN_RUNTIME_ENVIRONMENTS: ReadonlySet<string> = new Set<string>(['test', 'development', 'production']);

function isKnownRuntimeEnvironment(value: string | undefined): value is PcaKnownRuntimeEnvironment {
  return value !== undefined && KNOWN_RUNTIME_ENVIRONMENTS.has(value);
}

/**
 * True unless NODE_ENV is EXACTLY "test" or "development". Anything else --
 * "production", unset, empty, "Production" (wrong case), "staging" (not a
 * recognized value here), a typo -- is treated as production-sensitive.
 *
 * Never throws. Callers on a hot path (cookie serialization, rate limiting)
 * depend on that: a bad NODE_ENV must never turn every request into a
 * thrown error, only into the safest available behaviour.
 */
export function isProductionSensitiveRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NODE_ENV;
  return !(raw === 'test' || raw === 'development');
}

export class UnknownRuntimeEnvironmentError extends Error {
  constructor(rawValue: string | undefined) {
    super(
      `NODE_ENV must be exactly one of "test", "development", or "production" (got ${JSON.stringify(rawValue)}). ` +
        'Refusing to start with an unrecognized runtime environment.',
    );
    this.name = 'UnknownRuntimeEnvironmentError';
  }
}

/**
 * Boot-time-only defense in depth: throws `UnknownRuntimeEnvironmentError`
 * if NODE_ENV is not one of the three known values. Call this ONCE during
 * server startup (main.ts) -- never on a request-handling path, where
 * `isProductionSensitiveRuntime` is the correct call instead.
 */
export function assertKnownRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): PcaKnownRuntimeEnvironment {
  const raw = env.NODE_ENV;
  if (!isKnownRuntimeEnvironment(raw)) throw new UnknownRuntimeEnvironmentError(raw);
  return raw;
}
