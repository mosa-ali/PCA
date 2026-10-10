import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RuntimeSyncAuthError, type DeviceSessionIdentity, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { SafeZoneRepository } from '../../location/SafeZoneRepository.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from '../../familyrbac/TrustSetRoleResolver.js';
import { isPlausibleOpaqueId } from '../../familytrustset/policy.js';
import type { createRateLimiter } from '../rateLimit.js';

export interface SafeZoneDeliveryRoutesDeps {
  deviceSessionService: DeviceSessionService;
  trustSetRoleResolver?: Pick<TrustSetRoleResolver, 'resolveActor'>;
  safeZoneRepository?: Pick<SafeZoneRepository, 'listForRecipient'>;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_CURSOR_BYTES = 128;
const DELIVERY_RATE_LIMIT = { windowMs: 60_000, max: 30, bucket: 'safe-zone-delivery' } as const;
const FAMILY_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD']);

/**
 * Delivers only opaque, recipient-addressed Safe Zone envelopes. Family and
 * device scope come exclusively from the verified device-session token; no
 * caller-controlled family/device path or query parameter can widen access.
 * A successful fetch is not an application receipt and does not change the
 * stored PENDING_OFFLINE state.
 */
export function registerSafeZoneDeliveryRoutes(app: FastifyInstance, deps: SafeZoneDeliveryRoutesDeps): void {
  const deliveryLimiter = deps.rateLimiter(DELIVERY_RATE_LIMIT);
  app.get('/v1/runtime-sync/safe-zones', { preHandler: deliveryLimiter }, async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'private, no-store');
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4096) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    let identity: DeviceSessionIdentity;
    try {
      identity = await deps.deviceSessionService.validateSession(header.slice('Bearer '.length));
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'unauthorized' });
      return reply.code(503).send({ error: 'device_session_unavailable' });
    }
    if (!identity || !isPlausibleOpaqueId(identity.familyId) ||
      !isPlausibleOpaqueId(identity.deviceId) || !isPlausibleOpaqueId(identity.dskKeyId)) {
      return reply.code(503).send({ error: 'device_session_unavailable' });
    }
    if (!deps.safeZoneRepository) return reply.code(503).send({ error: 'not_configured' });
    if (!deps.trustSetRoleResolver) return reply.code(503).send({ error: 'family_authority_unavailable' });
    let actor;
    try {
      actor = await deps.trustSetRoleResolver.resolveActor(identity.familyId, identity.deviceId, identity.dskKeyId);
    } catch {
      return reply.code(503).send({ error: 'family_authority_unavailable' });
    }
    if (isActorResolutionFailure(actor) || !actor || typeof actor !== 'object' ||
      actor.deviceId !== identity.deviceId || !FAMILY_ROLES.has(actor.role) ||
      !Number.isSafeInteger(actor.trustSetEpoch) || actor.trustSetEpoch < 1 ||
      !Number.isSafeInteger(actor.keyEpoch) || actor.keyEpoch < 1) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const query = request.query as { cursor?: unknown };
    if (query.cursor !== undefined && (typeof query.cursor !== 'string' ||
      query.cursor.length === 0 || Buffer.byteLength(query.cursor, 'utf8') > MAX_CURSOR_BYTES ||
      !/^[A-Za-z0-9_-]+$/.test(query.cursor))) {
      return reply.code(400).send({ error: 'invalid_cursor' });
    }
    try {
      const page = await deps.safeZoneRepository.listForRecipient(
        identity.familyId,
        identity.deviceId,
        query.cursor as string | undefined,
      );
      return reply.code(200).send({ safeZones: page.safeZones.map((zone) => ({
        zoneId: zone.zoneId,
        ciphertextB64: zone.ciphertextB64,
        nonceB64: zone.nonceB64,
        keyEpoch: zone.keyEpoch,
        revision: zone.revision,
        deliveryState: zone.deliveryState,
        updatedAtUtc: zone.updatedAtUtc,
      })), nextCursor: page.nextCursor });
    } catch {
      return reply.code(503).send({ error: 'safe_zone_unavailable' });
    }
  });
}
