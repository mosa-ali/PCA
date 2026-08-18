import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const DEFAULT_PARENT_WEB_ORIGIN = 'http://localhost:4000';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS']);
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

export function resolveParentWebOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeOrigin(env.PCA_PARENT_WEB_ORIGIN ?? DEFAULT_PARENT_WEB_ORIGIN);
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
 * Narrow browser transport boundary for the parent console. This is an
 * explicit origin allowlist, never wildcard CORS: family cookies are only
 * accepted from the configured parent-web origin and preflight requests are
 * rejected unless their method and requested headers are known application
 * headers.
 */
export function registerParentWebCors(app: FastifyInstance, allowedOrigin = resolveParentWebOrigin()): void {
  const normalizedOrigin = normalizeOrigin(allowedOrigin);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string') return;

    if (origin !== normalizedOrigin) {
      if (request.method === 'OPTIONS') await reply.code(403).send({ error: 'forbidden' });
      return;
    }

    reply.header('Access-Control-Allow-Origin', normalizedOrigin);
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Vary', 'Origin');

    if (request.method !== 'OPTIONS') return;

    const requestedMethod = request.headers['access-control-request-method'];
    if (typeof requestedMethod === 'string' && !ALLOWED_METHODS.has(requestedMethod.toUpperCase())) {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    if (!requestedHeadersAreAllowed(request)) {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    reply.header('Access-Control-Allow-Methods', [...ALLOWED_METHODS].join(', '));
    reply.header('Access-Control-Allow-Headers', [...ALLOWED_HEADERS].join(', '));
    await reply.code(204).send();
  });
}
