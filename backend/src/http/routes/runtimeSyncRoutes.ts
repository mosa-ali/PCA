import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EnvelopeAcceptanceContext } from '../../familyenvelope/FamilyEnvelopeVerifier.js';
import type { InboundReconnectService } from '../../runtime-sync/InboundReconnectService.js';
import type { OutboundEnvelopeItem, OutboundRelayService } from '../../runtime-sync/OutboundRelayService.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { RelayError } from '../../relay/RelayService.js';
import type { DeviceSyncStatusTracker } from '../../runtime-sync/StatusService.js';
import { MAX_OUTBOUND_BATCH_SIZE } from '../../runtime-sync/policy.js';
import { createRateLimiter } from '../rateLimit.js';
import type { DeviceProtectionStatusRepository, ProtectionLevel } from '../../device/DeviceProtectionStatusRepository.js';
import type { ProtectionAlertProducer } from '../../alerts/ProtectionAlertProducer.js';

/**
 * PCA-ADD-ENR-020 alerting composition, scoped to the protection-status
 * route (mirrors familyrbac/RemovalDecisionAuthority.ts's
 * RemovalDecisionAlerting / invitation/InvitationService.ts's
 * InvitationAlerting precedent). Best-effort/optional: alert delivery
 * failure never blocks or reverses a device's status report.
 */
export interface ProtectionStatusAlerting {
  producer: ProtectionAlertProducer;
  alertsEnabled: boolean | (() => boolean);
  resolveParentDevices(familyId: string): Promise<Array<{ deviceId: string; keyEpoch: number }>>;
}

declare module 'fastify' {
  interface FastifyRequest {
    runtimeSyncDeviceId?: string;
    runtimeSyncFamilyId?: string;
  }
}

export interface ResolveEnvelopeContext {
  (senderKeyId: string, familyId: string, nowUtc: Date): EnvelopeAcceptanceContext;
}

export interface RuntimeSyncRoutesDeps {
  deviceSessionService: DeviceSessionService;
  outboundRelayService: OutboundRelayService;
  inboundReconnectService: InboundReconnectService;
  statusTracker: DeviceSyncStatusTracker;
  /**
   * FTS-owned resolution (senderPublicKey, epoch floor) this HTTP layer
   * does not implement -- see FamilyEnvelopeVerifier/InboundReconnectService
   * doc comments. Supplied by whichever composition root wires the Family
   * Trust Set workstream in; a route-level default that always fails
   * closed (see runtimeSyncRoutes.ts's buildServer wiring) is safe to use
   * until that's available.
   */
  resolveEnvelopeContext: ResolveEnvelopeContext;
  rateLimiter: ReturnType<typeof createRateLimiter>;
  authAttemptLimiter: ReturnType<ReturnType<typeof createRateLimiter>>;
  /**
   * PCA-ADD-ENR-016/PCA-FR-145: optional so every existing composition
   * that doesn't yet care about protective-authority status keeps working
   * unchanged. When supplied, POST /v1/runtime-sync/protection-status is
   * registered -- the one real, device-session-authenticated way a
   * device's self-reported protection level ever reaches the durable
   * store RealProtectiveAuthorityResolver reads (see that class's own
   * doc comment for the full chain).
   */
  deviceProtectionStatusRepository?: DeviceProtectionStatusRepository;
  /** PCA-ADD-ENR-020: optional. When supplied alongside deviceProtectionStatusRepository, a report that transitions a device INTO DEGRADED emits a PROTECTION_DEGRADED alert. */
  protectionStatusAlerting?: ProtectionStatusAlerting;
}

const PROTECTION_LEVELS: ReadonlySet<string> = new Set(['STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED']);

const MAX_CIPHERTEXT_BASE64_LENGTH = 90_000; // headroom over relay's 64 KiB ciphertext cap once base64-inflated

/** PCA-ADD-ENR-020: best-effort alert emission. A composition/delivery failure never blocks or reverses the status write. */
async function emitProtectionDegradedAlert(
  alerting: ProtectionStatusAlerting | undefined,
  familyId: string,
  deviceId: string,
): Promise<void> {
  if (!alerting) return;
  const alertsEnabled = typeof alerting.alertsEnabled === 'function' ? alerting.alertsEnabled() : alerting.alertsEnabled;
  if (!alertsEnabled) return;
  try {
    const parentDevices = await alerting.resolveParentDevices(familyId);
    for (const parentDevice of parentDevices) {
      await alerting.producer.produce({
        familyId,
        deviceId,
        parentDeviceId: parentDevice.deviceId,
        trigger: 'PROTECTION_DEGRADED',
        keyEpoch: parentDevice.keyEpoch,
        alertsEnabled: true,
      });
    }
  } catch {
    // Alerting is deliberately non-blocking -- see this function's own doc comment.
  }
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function parseOutboundItem(raw: unknown): OutboundEnvelopeItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isNonEmptyString(candidate.messageId, 128)) return null;
  if (!isNonEmptyString(candidate.recipientDeviceId, 128)) return null;
  if (!isNonEmptyString(candidate.ciphertext, MAX_CIPHERTEXT_BASE64_LENGTH)) return null;
  if (!isNonEmptyString(candidate.messageType, 64)) return null;
  if (candidate.ttlMs !== undefined && typeof candidate.ttlMs !== 'number') return null;

  let ciphertext: Buffer;
  try {
    ciphertext = Buffer.from(candidate.ciphertext, 'base64');
  } catch {
    return null;
  }
  if (ciphertext.toString('base64') !== candidate.ciphertext) return null;

  return {
    messageId: candidate.messageId,
    recipientDeviceId: candidate.recipientDeviceId,
    ciphertext,
    messageType: candidate.messageType,
    enqueuedAtEpochMillis: typeof candidate.enqueuedAtEpochMillis === 'number' ? candidate.enqueuedAtEpochMillis : Date.now(),
    ttlMs: candidate.ttlMs as number | undefined,
  };
}

/**
 * Every device session preHandler below binds `request.runtimeSyncDeviceId`/
 * `runtimeSyncFamilyId` from a VERIFIED session token -- route handlers
 * never read a device or family id from the request body or params for
 * authorization purposes (see OutboundRelayService's cross-family IDOR
 * closure doc comment).
 */
function createRequireDeviceSession(deviceSessionService: DeviceSessionService) {
  return async function requireDeviceSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4096) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    try {
      const identity = await deviceSessionService.validateSession(header.slice('Bearer '.length));
      request.runtimeSyncDeviceId = identity.deviceId;
      request.runtimeSyncFamilyId = identity.familyId;
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return;
      }
      throw error;
    }
  };
}

export function registerRuntimeSyncRoutes(app: FastifyInstance, deps: RuntimeSyncRoutesDeps): void {
  const requireDeviceSession = createRequireDeviceSession(deps.deviceSessionService);
  const challengeLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'runtime-sync-challenge' });
  const sessionLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'runtime-sync-session' });
  const outboundLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'runtime-sync-outbound' });
  const inboundLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'runtime-sync-inbound' });

  // Unauthenticated by design (proof of possession happens at /session) --
  // see DeviceSessionService.issueChallengeSafely's doc comment for why
  // this never leaks device existence/family/revocation status.
  app.post(
    '/v1/runtime-sync/devices/:deviceId/challenge',
    { preHandler: [deps.authAttemptLimiter, challengeLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { deviceId } = request.params as { deviceId: string };
      if (!isNonEmptyString(deviceId, 128)) return reply.code(400).send({ error: 'invalid_request' });
      const challenge = await deps.deviceSessionService.issueChallengeSafely(deviceId);
      return reply.send({
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    },
  );

  app.post(
    '/v1/runtime-sync/devices/:deviceId/session',
    { preHandler: [deps.authAttemptLimiter, sessionLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { challengeId?: unknown; signature?: unknown };
      if (!isNonEmptyString(body.challengeId, 128) || !isNonEmptyString(body.signature, 4096)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const session = await deps.deviceSessionService.completeChallenge(body.challengeId, body.signature);
        return reply.send({ sessionToken: session.rawToken, expiresAt: session.expiresAt.toISOString() });
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'unauthorized' });
        throw error;
      }
    },
  );

  app.post(
    '/v1/runtime-sync/outbound',
    { preHandler: [deps.authAttemptLimiter, requireDeviceSession, outboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { items?: unknown };
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_OUTBOUND_BATCH_SIZE * 4) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const items = body.items.map(parseOutboundItem);
      if (items.some((item) => item === null)) return reply.code(400).send({ error: 'invalid_request' });

      const result = await deps.outboundRelayService.submitBatch(
        request.runtimeSyncDeviceId as string,
        request.runtimeSyncFamilyId as string,
        items as OutboundEnvelopeItem[],
      );
      return reply.send({
        results: result.results,
        droppedForBatchBound: result.droppedForBatchBound,
      });
    },
  );

  app.get(
    '/v1/runtime-sync/inbound',
    { preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const deviceId = request.runtimeSyncDeviceId as string;
      deps.statusTracker.markSyncStart(deviceId);
      try {
        const outcome = await deps.inboundReconnectService.reconnectDrainForRecipient(
          deviceId,
          (senderKeyId, nowUtc) => deps.resolveEnvelopeContext(senderKeyId, request.runtimeSyncFamilyId as string, nowUtc),
          new Date(),
        );
        deps.statusTracker.markSyncSuccess(deviceId, new Date());
        return reply.send({
          applied: outcome.applied.map((envelope) => ({
            messageId: envelope.messageId,
            senderDeviceId: envelope.senderDeviceId,
            messageType: envelope.messageType,
            payload: envelope.payload.toString('base64'),
          })),
          receipts: outcome.receipts.map((receipt) => ({
            messageId: receipt.messageId,
            outcome: receipt.outcome,
            atUtc: receipt.atUtc.toISOString(),
            reason: receipt.reason,
          })),
          unparseableMessageIds: outcome.unparseableMessageIds,
          droppedForListBound: outcome.droppedForListBound,
        });
      } finally {
        deps.statusTracker.markSyncEnd(deviceId);
      }
    },
  );

  app.post(
    '/v1/runtime-sync/inbound/:messageId/ack',
    { preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { messageId } = request.params as { messageId: string };
      if (!isNonEmptyString(messageId, 128)) return reply.code(400).send({ error: 'invalid_request' });
      try {
        await deps.outboundRelayService.acknowledgeAsRecipient(request.runtimeSyncDeviceId as string, messageId);
        return reply.send({ acknowledged: true });
      } catch (error) {
        // Only a domain-level RelayError (unknown/not-this-recipient's/already
        // resolved messageId -- indistinguishable by design, see
        // OutboundRelayService.acknowledgeAsRecipient's doc comment) collapses
        // to a generic 404. Any other error (e.g. a genuine DB/infra failure)
        // must reach the global error handler as a 5xx, matching every other
        // route in this file -- swallowing it here would mask real incidents
        // as a client-facing 404.
        if (error instanceof RelayError) return reply.code(404).send({ error: 'not_found' });
        throw error;
      }
    },
  );

  app.get(
    '/v1/runtime-sync/status',
    { preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const deviceId = request.runtimeSyncDeviceId as string;
      const state = deps.statusTracker.computeState(deviceId, false, new Date());
      return reply.send({ connectionState: state });
    },
  );

  // PCA-ADD-ENR-016/PCA-FR-145: the one real way a device's protection
  // level ever reaches RealProtectiveAuthorityResolver -- see that
  // class's own doc comment. familyId/deviceId are ALWAYS taken from the
  // verified session (never the request body) -- a device can only ever
  // report its own status, never another device's.
  if (deps.deviceProtectionStatusRepository) {
    const protectionStatusRepository = deps.deviceProtectionStatusRepository;
    app.post(
      '/v1/runtime-sync/protection-status',
      { preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { protectionLevel?: unknown };
        if (typeof body.protectionLevel !== 'string' || !PROTECTION_LEVELS.has(body.protectionLevel)) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const deviceId = request.runtimeSyncDeviceId as string;
        const familyId = request.runtimeSyncFamilyId as string;
        const nextLevel = body.protectionLevel as ProtectionLevel;
        // Read before write: a transition INTO DEGRADED is only detectable
        // by diffing against the prior single-row-per-device value (the
        // table is an upsert, never a history log -- see this repository's
        // own doc comment) -- so the previous level must be captured before
        // it's overwritten below, not after.
        const previous = deps.protectionStatusAlerting ? await protectionStatusRepository.findForDevice(familyId, deviceId) : null;
        await protectionStatusRepository.upsert({ deviceId, familyId, protectionLevel: nextLevel, updatedAt: new Date() });
        if (nextLevel === 'DEGRADED' && previous?.protectionLevel !== 'DEGRADED') {
          await emitProtectionDegradedAlert(deps.protectionStatusAlerting, familyId, deviceId);
        }
        return reply.code(204).send();
      },
    );
  }
}
