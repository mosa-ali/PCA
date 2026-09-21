import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isProductionSensitiveRuntime } from '../runtime/environment.js';

export const DEFAULT_PARENT_WEB_ORIGIN = 'http://localhost:4000';

/**
 * PCA full assessment finding P1-02. Before 2026-09-21 the resolver fell back
 * to `http://localhost:4000` unconditionally -- INCLUDING in production -- so an
 * unset or misspelled `PCA_PARENT_WEB_ORIGIN` silently pointed the single
 * credentialed CORS allowlist at localhost instead of failing loudly at boot.
 * This mirrors the fail-closed convention already used by
 * parentaccount/cookies.ts and parentaccount/verificationCode.ts.
 */
export class MissingParentWebOriginError extends Error {
  constructor() {
    super(
      'PCA_PARENT_WEB_ORIGIN must be set in production. Refusing to fall back to a localhost origin ' +
        'for credentialed CORS: a deployment that silently trusted http://localhost:4000 would treat a ' +
        'local, attacker-influenced origin as an authenticated caller of the family API.',
    );
    this.name = 'MissingParentWebOriginError';
  }
}

/** A production origin must be https; plaintext would expose credentialed family traffic to interception. */
export class InsecureProductionOriginError extends Error {
  constructor(variableName: string, value: string) {
    super(`${variableName} must be an https:// origin in production (got ${JSON.stringify(value)}).`);
    this.name = 'InsecureProductionOriginError';
  }
}

// Exactly the methods a browser client actually issues cross-origin against
// this boundary: parent-web sends GET/HEAD/POST/PATCH, plus DELETE for
// safe-zone deletion. PUT is deliberately absent from the PARENT set -- the
// only PUT routes in the service are platform-admin settings routes. Because
// the two consoles now have separately-named origins (see
// resolvePlatformAdminWebOrigin), each origin gets its OWN method allowlist
// rather than one shared set: granting the admin origin PUT must never also
// grant PUT to the parent origin. An allowlist entry with no cross-origin
// client is pure attack surface, so nothing beyond these two sets is granted.
const PARENT_ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);
const PLATFORM_ADMIN_ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
const ALLOWED_HEADERS = new Set(['accept', 'content-type', 'authorization', 'x-pca-csrf-token', 'x-pca-actor-device-id']);

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('PCA_PARENT_WEB_ORIGIN must be an absolute http(s) origin.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('PCA_PARENT_WEB_ORIGIN must be an absolute http(s) origin without a path or credentials.');
  }
  return parsed.origin;
}

/**
 * Resolves the ONE credentialed parent-console origin.
 *
 * Production fails closed (PCA full assessment finding P1-02): an absent or
 * blank `PCA_PARENT_WEB_ORIGIN` throws at boot instead of silently resolving to
 * localhost, and a non-https value is refused. Development/test keep the
 * deliberate localhost default so local work needs no configuration.
 */
export function resolveParentWebOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PCA_PARENT_WEB_ORIGIN;
  const productionSensitive = isProductionSensitiveRuntime(env);
  if (typeof configured !== 'string' || configured.trim() === '') {
    if (productionSensitive) throw new MissingParentWebOriginError();
    return DEFAULT_PARENT_WEB_ORIGIN;
  }
  const origin = normalizeOrigin(configured);
  if (productionSensitive && !origin.startsWith('https://')) {
    throw new InsecureProductionOriginError('PCA_PARENT_WEB_ORIGIN', origin);
  }
  return origin;
}

/**
 * Optional second credentialed origin for the Platform Administration console.
 *
 * Platform Admin is a SEPARATE authority plane: it authenticates with a Bearer
 * token and keeps its session in memory only (no cookie transport), so it needs
 * no CSRF companion and is unaffected by cookie-domain concerns. Its documented
 * target topology is `platform.pcasafe.com` -> console and `api.pcasafe.com` ->
 * API, which is cross-origin.
 *
 * Returning `null` when unset is deliberate and is NOT a silent-localhost
 * fallback: it means "same-origin deployment", which is the recommended default
 * (a reverse proxy serving console and `/platform-admin/*` from one origin needs
 * no CORS entry at all). A wildcard is never produced. Whether the deployed
 * topology is same-origin or cross-origin remains an owner decision; this
 * function makes the cross-origin case expressible without widening anything
 * else.
 */
export function resolvePlatformAdminWebOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.PCA_PLATFORM_ADMIN_WEB_ORIGIN;
  if (typeof configured !== 'string' || configured.trim() === '') return null;
  const origin = normalizeOrigin(configured);
  if (isProductionSensitiveRuntime(env) && !origin.startsWith('https://')) {
    throw new InsecureProductionOriginError('PCA_PLATFORM_ADMIN_WEB_ORIGIN', origin);
  }
  return origin;
}

function requestedHeadersAreAllowed(request: FastifyRequest): boolean {
  const requested = request.headers['access-control-request-headers'];
  if (typeof requested !== 'string' || requested.trim() === '') return true;
  return requested
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
    .every((header) => ALLOWED_HEADERS.has(header));
}

/**
 * Narrow browser transport boundary for the two consoles. This is an explicit
 * origin allowlist, never wildcard CORS: credentialed requests are accepted
 * only from the configured parent-web origin (and, when explicitly configured,
 * the Platform Administration origin), and preflights are rejected unless their
 * method and requested headers are known application headers.
 *
 * The two origins have deliberately SEPARATE method allowlists so that granting
 * the administration plane `PUT` can never also grant `PUT` to the parent plane.
 */
export function registerParentWebCors(
  app: FastifyInstance,
  allowedOrigin: string = resolveParentWebOrigin(),
  platformAdminOrigin: string | null = resolvePlatformAdminWebOrigin(),
): void {
  const parentOrigin = normalizeOrigin(allowedOrigin);
  const normalizedAdmin = platformAdminOrigin === null ? null : normalizeOrigin(platformAdminOrigin);
  const distinctAdminOrigin = normalizedAdmin !== null && normalizedAdmin !== parentOrigin ? normalizedAdmin : null;

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string') return;

    const isParentOrigin = origin === parentOrigin;
    const isAdminOrigin = distinctAdminOrigin !== null && origin === distinctAdminOrigin;
    if (!isParentOrigin && !isAdminOrigin) {
      if (request.method === 'OPTIONS') await reply.code(403).send({ error: 'forbidden' });
      return;
    }

    // Echo the origin that actually matched -- never a fixed or wildcard value.
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Vary', 'Origin');

    if (request.method !== 'OPTIONS') return;

    const allowedMethods = isAdminOrigin ? PLATFORM_ADMIN_ALLOWED_METHODS : PARENT_ALLOWED_METHODS;
    const requestedMethod = request.headers['access-control-request-method'];
    if (typeof requestedMethod === 'string' && !allowedMethods.has(requestedMethod.toUpperCase())) {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    if (!requestedHeadersAreAllowed(request)) {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    reply.header('Access-Control-Allow-Methods', [...allowedMethods].join(', '));
    reply.header('Access-Control-Allow-Headers', [...ALLOWED_HEADERS].join(', '));
    await reply.code(204).send();
  });
}
