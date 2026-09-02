/**
 * Parent-facing, READ-ONLY runtime-sync status surface.
 *
 * Complements runtimeSyncRoutes.ts's DEVICE-authenticated
 * `GET /v1/runtime-sync/status` (device session token, "how am I doing")
 * with a PARENT-session-authenticated equivalent scoped to one of the
 * caller's own family's devices ("how is my child's device doing"). This is
 * the real backend counterpart parent-web's
 * UnavailableParentRuntimeSyncClient placeholder
 * (parent-web/src/api/real/unavailableProviders.ts) was waiting on --
 * Dashboard/ChildOverview/ScreenTimePage/useReconnectSync all call this
 * data today.
 *
 * SCOPE: exposes ONLY the 3 read-only bookkeeping methods
 * ParentRuntimeSyncClient needs answered honestly today -- connection
 * status, last successful sync, pending delivery count/status. It
 * deliberately does NOT expose (and never will, from this route) the
 * mutating envelope methods (submitCiphertextEnvelope/listQueuedForEndpoint/
 * acknowledgeEnvelope) -- those require the parent-sdk's E2EE envelope
 * crypto, which stays gated on a human security review
 * (see unavailableProviders.ts's own file header) and is explicitly out of
 * scope here. Nothing this route returns is, or is derived from, ciphertext
 * or family plaintext -- only connection/delivery bookkeeping metadata.
 *
 * AUTHORIZATION -- identical layering to billingCheckoutRoutes.ts's
 * VIEW_OWN_BILLING_STATUS read route, never a new mechanism:
 *   1. requireServiceSession (fastifyAuthPlugin.ts) -- Bearer token OR the
 *      pca_family_session cookie, both validated through the same
 *      AuthService. A recognized service account only, nothing more.
 *   2. createRequireFamilyAuthorization(authzService, 'VIEW_DEVICE_SYNC_STATUS')
 *      (requireFamilyAuthorization.ts) -- this account holds an ACTIVE
 *      family-scope row for :familyId. Fails closed (403) on any ambiguous
 *      state (no scope row, revoked scope, malformed familyId) -- never a
 *      default allow.
 *   3. deviceRepository.findDeviceForFamily(familyId, deviceId) -- the SAME
 *      family-scoped device-ownership lookup OutboundRelayService already
 *      uses to close its own cross-family IDOR: a deviceId that exists but
 *      belongs to a DIFFERENT family is indistinguishable from one that does
 *      not exist at all (404 either way, never a distinguishing signal).
 *
 * DATA SOURCES (see each dependency's own doc comment for why none of this
 * is family-plaintext/ciphertext):
 *   - DeviceSyncStatusTracker.computeState/getLastSuccessfulSync
 *     (runtime-sync/StatusService.ts) -- the SAME shared, process-local
 *     "courtesy server-side view" instance registerRuntimeSyncRoutes uses;
 *     its own header names a parent dashboard as exactly this use case, and
 *     also documents a known best-effort limitation for a parent-observing
 *     caller (see computeState's own comment): it can never answer OFFLINE
 *     for a device it isn't itself receiving the request from.
 *   - RelayService.listQueuedForRecipient -- envelopes still queued (not yet
 *     acknowledged) for this device; only messageId/createdAt/expiresAt
 *     metadata is read here, ciphertext bytes are never touched or returned.
 *   - DeviceProtectionStatusRepository.findForDevice (optional, matches
 *     runtimeSyncRoutes.ts's own optionality) -- a plaintext protectionLevel
 *     enum + timestamp, surfaced as supplementary bookkeeping.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequireServiceSession } from '../../auth/fastifyAuthPlugin.js';
import { createRequireFamilyAuthorization } from '../requireFamilyAuthorization.js';
import { createRateLimiter } from '../rateLimit.js';
import type { AuthService } from '../../auth/AuthService.js';
import type { AuthzService } from '../../authz/AuthzService.js';
import type { DeviceRepository } from '../../device/DeviceRepository.js';
import type { DeviceSyncStatusTracker } from '../../runtime-sync/StatusService.js';
import type { RelayService } from '../../relay/RelayService.js';
import type { DeviceProtectionStatusRepository } from '../../device/DeviceProtectionStatusRepository.js';

const MAX_DEVICE_ID_LENGTH = 128;

export interface ParentRuntimeSyncRoutesDeps {
  authService: AuthService;
  authzService: AuthzService;
  deviceRepository: DeviceRepository;
  statusTracker: DeviceSyncStatusTracker;
  relayService: RelayService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
  /**
   * Optional, mirrors runtimeSyncRoutes.ts's own optionality for the same
   * dependency: when absent, the response's protectionLevel/
   * protectionUpdatedAtUtc fields are always null rather than a
   * partial/broken shape -- never a 503 for the read this route exists to
   * serve.
   */
  deviceProtectionStatusRepository?: DeviceProtectionStatusRepository;
}

export function registerParentRuntimeSyncRoutes(app: FastifyInstance, deps: ParentRuntimeSyncRoutesDeps): void {
  const requireServiceSession = createRequireServiceSession(deps.authService);
  const requireViewDeviceSyncStatus = createRequireFamilyAuthorization(deps.authzService, 'VIEW_DEVICE_SYNC_STATUS');
  const statusLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'parent-runtime-sync-status' });

  app.get(
    '/v1/families/:familyId/runtime-sync/devices/:deviceId/status',
    {
      preHandler: [deps.authAttemptLimiter, requireServiceSession, requireViewDeviceSyncStatus, statusLimiter],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { familyId, deviceId } = request.params as { familyId: string; deviceId: string };
      if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > MAX_DEVICE_ID_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      // Family-scoped device-ownership check -- same non-enumeration
      // posture as every other cross-family lookup in this codebase (see
      // this file's own header, item 3): a device belonging to a different
      // family must be indistinguishable from a device that does not exist.
      const device = await deps.deviceRepository.findDeviceForFamily(familyId, deviceId);
      if (!device) return reply.code(404).send({ error: 'not_found' });

      const now = new Date();
      const pendingEnvelopes = await deps.relayService.listQueuedForRecipient(deviceId);
      const pendingCount = pendingEnvelopes.length;
      const oldestQueuedAtUtc = pendingEnvelopes.reduce<Date | null>(
        (oldest, envelope) => (oldest === null || envelope.createdAt.getTime() < oldest.getTime() ? envelope.createdAt : oldest),
        null,
      );

      const connectionState = deps.statusTracker.computeState(deviceId, pendingCount > 0, now);
      const lastSuccessfulSyncAtUtc = deps.statusTracker.getLastSuccessfulSync(deviceId);

      const protectionRecord = deps.deviceProtectionStatusRepository
        ? await deps.deviceProtectionStatusRepository.findForDevice(familyId, deviceId)
        : null;

      return reply.send({
        deviceId,
        connectionState,
        lastSuccessfulSyncAtUtc: lastSuccessfulSyncAtUtc ? lastSuccessfulSyncAtUtc.toISOString() : null,
        pendingDelivery: {
          pendingCount,
          oldestQueuedAtUtc: oldestQueuedAtUtc ? oldestQueuedAtUtc.toISOString() : null,
        },
        protectionLevel: protectionRecord ? protectionRecord.protectionLevel : null,
        protectionUpdatedAtUtc: protectionRecord ? protectionRecord.updatedAt.toISOString() : null,
      });
    },
  );
}
