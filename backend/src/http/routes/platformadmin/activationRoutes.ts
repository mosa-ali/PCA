import type { FastifyInstance } from 'fastify';
import type { PlatformAdminActivationService } from '../../../platformadmin/auth/PlatformAdminActivationService.js';
import { PlatformAdminActivationError } from '../../../platformadmin/auth/PlatformAdminActivationService.js';
import type { createRateLimiter } from '../../rateLimit.js';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const TOTP_SHAPE = /^[0-9]{6}$/;
const MAX_BODY_BYTES = 2 * 1024;

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export function registerPlatformAdminActivationRoutes(app: FastifyInstance, deps: { platformAdminActivationService: PlatformAdminActivationService; rateLimiter: ReturnType<typeof createRateLimiter> }): void {
  const limiter = deps.rateLimiter({ windowMs: 60_000, max: 10, bucket: 'platform-admin-activation' });
  app.post('/platform-admin/activation/start', { bodyLimit: MAX_BODY_BYTES, preHandler: [limiter] }, async (request, reply) => {
    const body = request.body;
    if (!object(body) || typeof body.token !== 'string' || !TOKEN_SHAPE.test(body.token)) return reply.code(401).send({ error: 'activation_failed' });
    try { return reply.code(200).send(await deps.platformAdminActivationService.start(body.token)); }
    catch (error) { if (error instanceof PlatformAdminActivationError) return reply.code(401).send({ error: 'activation_failed' }); throw error; }
  });
  app.post('/platform-admin/activation/complete', { bodyLimit: MAX_BODY_BYTES, preHandler: [limiter] }, async (request, reply) => {
    const body = request.body;
    if (!object(body) || typeof body.token !== 'string' || !TOKEN_SHAPE.test(body.token) || typeof body.password !== 'string' || typeof body.totpCode !== 'string' || !TOTP_SHAPE.test(body.totpCode)) return reply.code(401).send({ error: 'activation_failed' });
    try { await deps.platformAdminActivationService.complete(body.token, body.password, body.totpCode); return reply.code(200).send({ status: 'COMPLETE' }); }
    catch (error) { if (error instanceof PlatformAdminActivationError) return reply.code(401).send({ error: 'activation_failed' }); throw error; }
  });
}
