import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Buffer } from 'node:buffer';
import { RuntimeSyncAuthError, type DeviceSessionIdentity, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { safeZoneCursorAfterZoneId, validateSafeZoneDeliveryCursor, type SafeZoneRepository } from '../../location/SafeZoneRepository.js';
import { isActorResolutionFailure, type ActorResolutionFailure, type ResolvedActor, type TrustSetRoleResolver } from '../../familyrbac/TrustSetRoleResolver.js';
import { isPlausibleOpaqueId } from '../../familytrustset/policy.js';
import type { DeviceChildBindingRepository } from '../../device/DeviceChildBindingRepository.js';
import type { ChildProfileRegistryRepository } from '../../childprofiles/ChildProfileRegistryRepository.js';
import type { createRateLimiter } from '../rateLimit.js';

export interface SafeZoneDeliveryRoutesDeps {
  deviceSessionService: DeviceSessionService;
  trustSetRoleResolver?: Pick<TrustSetRoleResolver, 'resolveActor'>;
  deviceChildBindingRepository?: Pick<DeviceChildBindingRepository, 'resolveBinding'>;
  childProfileRegistryRepository?: Pick<ChildProfileRegistryRepository, 'resolveMembership'>;
  safeZoneRepository?: Pick<SafeZoneRepository, 'listForRecipient'>;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const DELIVERY_RATE_LIMIT = { windowMs: 60_000, max: 30, bucket: 'safe-zone-delivery' } as const;
const MAX_SAFE_ZONE_DELIVERY_PAGE_ROWS = 16;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

function isCanonicalBase64Url(value: unknown, minimumBytes: number, maximumBytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length >= minimumBytes && decoded.length <= maximumBytes && decoded.toString('base64url') === value;
}

function isSafeZoneRecipientPage(page: unknown, familyId: string, deviceId: string, keyEpoch: number): boolean {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return false;
  const candidate = page as { safeZones?: unknown; nextCursor?: unknown };
  if (!Array.isArray(candidate.safeZones) || candidate.safeZones.length > MAX_SAFE_ZONE_DELIVERY_PAGE_ROWS ||
      !(candidate.nextCursor === null || typeof candidate.nextCursor === 'string')) return false;
  const seenZoneIds = new Set<string>();
  let previousZoneId: string | null = null;
  const rowsAreValid = candidate.safeZones.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const zone = value as Record<string, unknown>;
    const zoneId = zone.zoneId;
    const updatedAtUtc = zone.updatedAtUtc;
    const parsedUpdatedAt = typeof updatedAtUtc === 'string' ? new Date(updatedAtUtc) : null;
    if (zone.familyId !== familyId || zone.recipientEndpointId !== deviceId || zone.keyEpoch !== keyEpoch ||
      typeof zoneId !== 'string' || !OPAQUE_TOKEN.test(zoneId) || seenZoneIds.has(zoneId) ||
      (previousZoneId !== null && zoneId <= previousZoneId)) return false;
    if (!isCanonicalBase64Url(zone.ciphertextB64, 1, 65_535) || !isCanonicalBase64Url(zone.nonceB64, 12, 64) ||
        !Number.isSafeInteger(zone.revision) || (zone.revision as number) < 1 ||
        (zone.deliveryState !== 'PENDING_OFFLINE' && zone.deliveryState !== 'READY') ||
        parsedUpdatedAt === null || !Number.isFinite(parsedUpdatedAt.getTime()) || parsedUpdatedAt.toISOString() !== updatedAtUtc) {
      return false;
    }
    seenZoneIds.add(zoneId);
    previousZoneId = zoneId;
    return true;
  });
  if (!rowsAreValid) return false;
  // Android treats a continuation as a full fixed-size keyset page. Returning
  // a cursor with a short page makes the client reject the whole response and
  // can strand the delivery walk, so verify the repository contract here too.
  return candidate.nextCursor === null || candidate.safeZones.length === MAX_SAFE_ZONE_DELIVERY_PAGE_ROWS;
}

async function markPrivateResponseNoStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Run before the limiter and route handler so even throttling and auth
  // denials for recipient ciphertext cannot be retained by shared caches.
  reply.header('Cache-Control', 'private, no-store');
}

/**
 * Delivers only opaque, recipient-addressed Safe Zone envelopes. Family and
 * device scope come exclusively from the verified device-session token; no
 * caller-controlled family/device path or query parameter can widen access.
 * A successful fetch is not an application receipt and does not change the
 * stored PENDING_OFFLINE state.
 */
export function registerSafeZoneDeliveryRoutes(app: FastifyInstance, deps: SafeZoneDeliveryRoutesDeps): void {
  const deliveryLimiter = deps.rateLimiter(DELIVERY_RATE_LIMIT);
  app.get('/v1/runtime-sync/safe-zones', { preHandler: [markPrivateResponseNoStore, deliveryLimiter] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
    let actor: ResolvedActor | ActorResolutionFailure;
    try {
      actor = await deps.trustSetRoleResolver.resolveActor(identity.familyId, identity.deviceId, identity.dskKeyId);
    } catch {
      return reply.code(503).send({ error: 'family_authority_unavailable' });
    }
    if (isActorResolutionFailure(actor) || !actor || typeof actor !== 'object' ||
      actor.familyId !== identity.familyId || actor.deviceId !== identity.deviceId ||
      actor.dskKeyId !== identity.dskKeyId || actor.role !== 'CHILD' ||
      !Number.isSafeInteger(actor.trustSetEpoch) || actor.trustSetEpoch < 1 ||
      !Number.isSafeInteger(actor.keyEpoch) || actor.keyEpoch < 1) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!deps.deviceChildBindingRepository) return reply.code(503).send({ error: 'family_authority_unavailable' });
    if (!deps.childProfileRegistryRepository) return reply.code(503).send({ error: 'family_authority_unavailable' });
    const query = request.query as { cursor?: unknown };
    try {
      validateSafeZoneDeliveryCursor(query.cursor);
    } catch {
      return reply.code(400).send({ error: 'invalid_cursor' });
    }
    // The device must still have a single durable enrollment-to-child binding.
    // This does not authorize the read by itself: the accepted active CHILD
    // Trust Set projection above is also required for every delivery request.
    const capturedActor: ResolvedActor = actor;
    const resolveBoundProfileId = async (): Promise<string | null> => {
      try {
        const binding = await deps.deviceChildBindingRepository!.resolveBinding(identity.familyId, identity.deviceId);
        if (!binding || typeof binding !== 'object' || binding.outcome !== 'BOUND' ||
            typeof binding.childProfileId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(binding.childProfileId)) {
          await reply.code(403).send({ error: 'forbidden' });
          return null;
        }
        return binding.childProfileId;
      } catch {
        await reply.code(503).send({ error: 'family_authority_unavailable' });
        return null;
      }
    };
    const profileIsCurrentMember = async (childProfileId: string): Promise<boolean> => {
      try {
        const membership = await deps.childProfileRegistryRepository!.resolveMembership(identity.familyId, childProfileId);
        if (membership === 'MEMBER') return true;
        if (membership === 'NOT_MEMBER_OR_NOT_FOUND') {
          await reply.code(403).send({ error: 'forbidden' });
          return false;
        }
      } catch {
        await reply.code(503).send({ error: 'family_authority_unavailable' });
        return false;
      }
      await reply.code(503).send({ error: 'family_authority_unavailable' });
      return false;
    };
    const recheckAcceptedChildActor = async (): Promise<boolean> => {
      let current: ResolvedActor | ActorResolutionFailure;
      try {
        current = await deps.trustSetRoleResolver!.resolveActor(identity.familyId, identity.deviceId, identity.dskKeyId);
      } catch {
        await reply.code(503).send({ error: 'family_authority_unavailable' });
        return false;
      }
      if (isActorResolutionFailure(current) || !current || typeof current !== 'object' ||
          current.familyId !== identity.familyId || current.deviceId !== identity.deviceId ||
          current.dskKeyId !== identity.dskKeyId || current.role !== 'CHILD' ||
          !Number.isSafeInteger(current.trustSetEpoch) || current.trustSetEpoch < 1 ||
          !Number.isSafeInteger(current.keyEpoch) || current.keyEpoch < 1) {
        await reply.code(403).send({ error: 'forbidden' });
        return false;
      }
      if (current.trustSetEpoch !== capturedActor.trustSetEpoch) {
        await reply.code(409).send({ error: 'authority_changed' });
        return false;
      }
      if (current.keyEpoch !== capturedActor.keyEpoch) {
        await reply.code(409).send({ error: 'key_epoch_mismatch' });
        return false;
      }
      return true;
    };
    const boundChildProfileId = await resolveBoundProfileId();
    if (!boundChildProfileId || !(await profileIsCurrentMember(boundChildProfileId)) ||
        !(await recheckAcceptedChildActor())) return;
    try {
      const page = await deps.safeZoneRepository.listForRecipient(
        identity.familyId,
        identity.deviceId,
        capturedActor.keyEpoch,
        query.cursor as string | undefined,
      );
      const currentChildProfileId = await resolveBoundProfileId();
      if (!currentChildProfileId) return;
      if (currentChildProfileId !== boundChildProfileId) return reply.code(403).send({ error: 'forbidden' });
      if (!(await profileIsCurrentMember(currentChildProfileId)) || !(await recheckAcceptedChildActor())) return;
      // The repository query is scoped by family, recipient, and accepted
      // key epoch. Recheck that contract at the HTTP boundary before any
      // ciphertext is serialized, so a future repository regression cannot
      // turn a scoped device session into cross-recipient delivery.
      if (!isSafeZoneRecipientPage(page, identity.familyId, identity.deviceId, capturedActor.keyEpoch)) {
        return reply.code(503).send({ error: 'safe_zone_unavailable' });
      }
      if (page.nextCursor !== null) {
        if (typeof page.nextCursor !== 'string' || page.safeZones.length !== MAX_SAFE_ZONE_DELIVERY_PAGE_ROWS) {
          return reply.code(503).send({ error: 'safe_zone_unavailable' });
        }
        let cursorAfterZoneId: string | undefined;
        try { cursorAfterZoneId = safeZoneCursorAfterZoneId(page.nextCursor, capturedActor.keyEpoch); }
        catch { return reply.code(503).send({ error: 'safe_zone_unavailable' }); }
        if (cursorAfterZoneId === undefined || cursorAfterZoneId !== page.safeZones[page.safeZones.length - 1]!.zoneId) {
          return reply.code(503).send({ error: 'safe_zone_unavailable' });
        }
      }
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
