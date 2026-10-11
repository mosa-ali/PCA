import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { MAX_ACCEPTED_TRUST_SET_CANONICAL_BYTES, MAX_ORDINARY_TRUST_SET_REQUEST_CANONICAL_BYTES,
  OrdinaryTrustSetError, type OrdinaryTrustSetScope, type AcceptedTrustSetEpochDto,
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
const MAX_BODY_BYTES = 256 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalBase64(value: unknown, maxBytes: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4 * Math.ceil(maxBytes / 3) ||
      value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.length <= maxBytes && bytes.toString('base64') === value;
}

/** Explicit projection prevents internal acceptance/store metadata leaking through a future service DTO extension. */
function projectAcceptedEpoch(value: unknown): AcceptedTrustSetEpochDto | null {
  if (!isPlainObject(value)) return null;
  const { canonicalEpochBase64, signatureBase64, signerDeviceId, signerKeyId, trustSetEpoch, keyEpoch } = value;
  if (!isCanonicalBase64(canonicalEpochBase64, MAX_ACCEPTED_TRUST_SET_CANONICAL_BYTES) ||
      !isCanonicalBase64(signatureBase64, 64) || Buffer.from(signatureBase64, 'base64').length !== 64 ||
      !isPlausibleOpaqueId(signerDeviceId) || !isPlausibleOpaqueId(signerKeyId) ||
      !isFamilyEpochNumber(trustSetEpoch, 1) || !isFamilyEpochNumber(keyEpoch, 1)) {
    return null;
  }
  return { canonicalEpochBase64, signatureBase64, signerDeviceId, signerKeyId, trustSetEpoch, keyEpoch };
}

function sameAcceptedEpoch(left: AcceptedTrustSetEpochDto, right: AcceptedTrustSetEpochDto): boolean {
  return left.canonicalEpochBase64 === right.canonicalEpochBase64 &&
    left.signatureBase64 === right.signatureBase64 && left.signerDeviceId === right.signerDeviceId &&
    left.signerKeyId === right.signerKeyId && left.trustSetEpoch === right.trustSetEpoch &&
    left.keyEpoch === right.keyEpoch;
}

function acceptedRequestMatches(epoch: AcceptedTrustSetEpochDto, body: unknown): boolean {
  return isPlainObject(body) && epoch.canonicalEpochBase64 === body.canonicalEpochBase64 &&
    epoch.signatureBase64 === body.signatureBase64;
}

function doesNotExceedHead(epoch: AcceptedTrustSetEpochDto, head: AcceptedTrustSetEpochDto): boolean {
  return epoch.trustSetEpoch <= head.trustSetEpoch && epoch.keyEpoch <= head.keyEpoch &&
    (epoch.trustSetEpoch !== head.trustSetEpoch || sameAcceptedEpoch(epoch, head));
}

function projectSubmitResult(value: unknown, requestBody: unknown): OrdinaryTrustSetSubmitResult | null {
  if (!isPlainObject(value) || (value.outcome !== 'ACCEPTED' && value.outcome !== 'IDEMPOTENT_MATCH')) return null;
  const acceptedEpoch = projectAcceptedEpoch(value.acceptedEpoch);
  const acceptedHead = projectAcceptedEpoch(value.acceptedHead);
  if (acceptedEpoch === null || acceptedHead === null || !acceptedRequestMatches(acceptedEpoch, requestBody) ||
      !doesNotExceedHead(acceptedEpoch, acceptedHead)) return null;
  return { outcome: value.outcome, acceptedEpoch, acceptedHead };
}

function projectStatusResult(value: unknown, requestBody: unknown): OrdinaryTrustSetStatusResult | null {
  if (!isPlainObject(value) || typeof value.outcome !== 'string' ||
      !['ACCEPTED', 'NOT_ACCEPTED', 'CONFLICT'].includes(value.outcome)) return null;
  const acceptedHead = projectAcceptedEpoch(value.acceptedHead);
  const acceptedEpoch = value.acceptedEpoch === null ? null : projectAcceptedEpoch(value.acceptedEpoch);
  if (acceptedHead === null || (value.outcome === 'ACCEPTED') !== (acceptedEpoch !== null) ||
      (value.outcome !== 'ACCEPTED' && value.acceptedEpoch !== null) ||
      (acceptedEpoch !== null && (!acceptedRequestMatches(acceptedEpoch, requestBody) ||
        !doesNotExceedHead(acceptedEpoch, acceptedHead)))) return null;
  return { outcome: value.outcome as OrdinaryTrustSetStatusResult['outcome'], acceptedEpoch, acceptedHead };
}

function validBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'canonicalEpochBase64,signatureBase64') return false;
  const { canonicalEpochBase64, signatureBase64 } = body as Record<string, unknown>;
  return isCanonicalBase64(canonicalEpochBase64, MAX_ORDINARY_TRUST_SET_REQUEST_CANONICAL_BYTES) &&
    isCanonicalBase64(signatureBase64, 64) && Buffer.from(signatureBase64, 'base64').length === 64;
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
    if (!identity || !isPlausibleOpaqueId(identity.familyId) || !isPlausibleOpaqueId(identity.deviceId) ||
        !isPlausibleOpaqueId(identity.dskKeyId)) {
      await reply.code(503).send({ error: 'trust_set_unavailable' }); return null;
    }
    if (!isPlausibleOpaqueId(familyId) || familyId !== identity.familyId) {
      await reply.code(403).send({ error: 'forbidden' }); return null;
    }
    return { familyId: identity.familyId, deviceId: identity.deviceId, dskKeyId: identity.dskKeyId };
  }
  function failed(error: unknown, reply: FastifyReply) {
    if (error instanceof OrdinaryTrustSetError) {
      if (error.code === 'INVALID_REQUEST') return reply.code(400).send({ error: 'invalid_request' });
      if (error.code === 'EPOCH_NOT_FOUND') return reply.code(404).send({ error: 'trust_set_record_unavailable' });
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
      try {
        const result = await deps.ordinaryTrustSetService[operation](scope, request.body);
        const projected = operation === 'submit' ? projectSubmitResult(result, request.body) :
          projectStatusResult(result, request.body);
        return projected === null ? reply.code(503).send({ error: 'trust_set_unavailable' }) :
          reply.code(200).send(projected);
      }
      catch (error) { return failed(error, reply); }
    });
  }
  app.get(`${BASE}/head`, {
    preHandler: [deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'ordinary-trust-set-head' })],
  }, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return;
    if (!deps.ordinaryTrustSetService) return reply.code(503).send({ error: 'trust_set_unavailable' });
    try {
      const acceptedHead = projectAcceptedEpoch(await deps.ordinaryTrustSetService.head(scope));
      return acceptedHead === null ? reply.code(503).send({ error: 'trust_set_unavailable' }) :
        reply.code(200).send({ acceptedHead });
    }
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
      if (acceptedEpoch === null) return reply.code(404).send({ error: 'trust_set_record_unavailable' });
      const projected = projectAcceptedEpoch(acceptedEpoch);
      if (projected === null || projected.trustSetEpoch !== epoch) {
        return reply.code(503).send({ error: 'trust_set_unavailable' });
      }
      return reply.code(200).send({ acceptedEpoch: projected });
    } catch (error) { return failed(error, reply); }
  });
}
