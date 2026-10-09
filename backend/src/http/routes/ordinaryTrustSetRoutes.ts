import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { OrdinaryTrustSetError, type OrdinaryTrustSetScope, type AcceptedTrustSetEpochDto,
  type OrdinaryTrustSetSubmitResult, type OrdinaryTrustSetStatusResult } from '../../familytrustset/OrdinaryTrustSetService.js';
import { isFamilyEpochNumber } from '../../familyepoch/bounds.js';
import { isPlausibleOpaqueId } from '../../familytrustset/policy.js';
import type { createRateLimiter } from '../rateLimit.js';

export interface OrdinaryTrustSetRouteService {
  submit(scope: OrdinaryTrustSetScope, body: unknown): Promise<OrdinaryTrustSetSubmitResult>;
  status(scope: OrdinaryTrustSetScope, body: unknown): Promise<OrdinaryTrustSetStatusResult>;
  head(scope: OrdinaryTrustSetScope): Promise<AcceptedTrustSetEpochDto>;
  epoch(scope: OrdinaryTrustSetScope, trustSetEpoch: number): Promise<AcceptedTrustSetEpochDto | null>;
}
export interface OrdinaryTrustSetRoutesDeps {
  deviceSessionService: Pick<DeviceSessionService, 'validateSession'>;
  ordinaryTrustSetService?: OrdinaryTrustSetRouteService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}
const BASE = '/api/device/families/:familyId/trust-set/epochs';
const MAX_BODY_BYTES = 352 * 1024;

function validBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'canonicalEpochBase64,signatureBase64') return false;
  const { canonicalEpochBase64, signatureBase64 } = body as Record<string, unknown>;
  return typeof canonicalEpochBase64 === 'string' && canonicalEpochBase64.length >= 4 && canonicalEpochBase64.length <= 349_528 &&
    typeof signatureBase64 === 'string' && signatureBase64.length === 88;
}

/** Device-session-only transport. Registration does not activate a verifier or confer Parent authority. */
export function registerOrdinaryTrustSetRoutes(app: FastifyInstance, deps: OrdinaryTrustSetRoutesDeps): void {
  async function authorize(request: FastifyRequest, reply: FastifyReply): Promise<OrdinaryTrustSetScope | null> {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length > 4096 ||
        authorization.length <= 7 || /[\r\n]/.test(authorization)) {
      await reply.code(401).send({ error: 'unauthorized' }); return null;
    }
    let identity;
    try { identity = await deps.deviceSessionService.validateSession(authorization.slice(7)); }
    catch (error) {
      await reply.code(error instanceof RuntimeSyncAuthError ? 401 : 503)
        .send({ error: error instanceof RuntimeSyncAuthError ? 'unauthorized' : 'trust_set_unavailable' });
      return null;
    }
    const { familyId } = request.params as { familyId?: unknown };
    if (!identity || !isPlausibleOpaqueId(identity.familyId) || !isPlausibleOpaqueId(identity.deviceId)) {
      await reply.code(503).send({ error: 'trust_set_unavailable' }); return null;
    }
    if (!isPlausibleOpaqueId(familyId) || familyId !== identity.familyId) {
      await reply.code(403).send({ error: 'forbidden' }); return null;
    }
    return { familyId: identity.familyId, deviceId: identity.deviceId };
  }
  function failed(error: unknown, reply: FastifyReply) {
    if (error instanceof OrdinaryTrustSetError) {
      if (error.code === 'INVALID_REQUEST') return reply.code(400).send({ error: 'invalid_request' });
      if (['DEVICE_NOT_ACTIVE', 'OWNER_REQUIRED', 'FAMILY_MISMATCH'].includes(error.code)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return reply.code(409).send({ error: error.code === 'CONFLICT' ? 'trust_set_conflict' : 'trust_set_rejected' });
    }
    return reply.code(503).send({ error: 'trust_set_unavailable' });
  }
  for (const operation of ['submit', 'status'] as const) {
    app.post(operation === 'submit' ? BASE : `${BASE}/status`, {
      bodyLimit: MAX_BODY_BYTES,
      preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: `ordinary-trust-set-${operation}` })],
    }, async (request, reply) => {
      const scope = await authorize(request, reply); if (!scope) return;
      if (!validBody(request.body)) return reply.code(400).send({ error: 'invalid_request' });
      if (!deps.ordinaryTrustSetService) return reply.code(503).send({ error: 'trust_set_unavailable' });
      try { return reply.code(200).send(await deps.ordinaryTrustSetService[operation](scope, request.body)); }
      catch (error) { return failed(error, reply); }
    });
  }
  app.get(`${BASE}/head`, {
    preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'ordinary-trust-set-head' })],
  }, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return;
    if (!deps.ordinaryTrustSetService) return reply.code(503).send({ error: 'trust_set_unavailable' });
    try { return reply.code(200).send({ acceptedHead: await deps.ordinaryTrustSetService.head(scope) }); }
    catch (error) { return failed(error, reply); }
  });
  app.get(`${BASE}/records/:trustSetEpoch`, {
    preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'ordinary-trust-set-record' })],
  }, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return;
    const raw = (request.params as { trustSetEpoch: string }).trustSetEpoch;
    const epoch = Number(raw);
    if (!/^[1-9][0-9]{0,9}$/.test(raw) || !isFamilyEpochNumber(epoch, 1)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    if (!deps.ordinaryTrustSetService) return reply.code(503).send({ error: 'trust_set_unavailable' });
    try {
      const acceptedEpoch = await deps.ordinaryTrustSetService.epoch(scope, epoch);
      return acceptedEpoch === null ? reply.code(404).send({ error: 'trust_set_record_unavailable' }) :
        reply.code(200).send({ acceptedEpoch });
    } catch (error) { return failed(error, reply); }
  });
}
