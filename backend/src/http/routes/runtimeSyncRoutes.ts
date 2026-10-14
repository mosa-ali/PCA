import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EnvelopeAcceptanceContext } from '../../familyenvelope/FamilyEnvelopeVerifier.js';
import type { InboundReconnectService } from '../../runtime-sync/InboundReconnectService.js';
import { envelopeToRawFamilyEnvelope } from '../../runtime-sync/envelopeWireCodec.js';
import {
  RecipientAuthorizationUnavailableError,
  type OutboundBatchResult,
  type OutboundEnvelopeItem,
  type OutboundRelayService,
} from '../../runtime-sync/OutboundRelayService.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { RelayError } from '../../relay/RelayService.js';
import { RelayAuthorityChangedError, type RelayEnvelopeAuthoritySnapshot, type RelayRecipientAuthoritySnapshot } from '../../relay/RelayRepository.js';
import { hashSessionToken } from '../../auth/token.js';
import { InvalidRelayCursorError, MAX_RELAY_CURSOR_BYTES } from '../../runtime-sync/relayContinuation.js';
import type { DeviceSyncStatusTracker } from '../../runtime-sync/StatusService.js';
import { MAX_OUTBOUND_BATCH_SIZE } from '../../runtime-sync/policy.js';
import { MAX_RELAY_TTL_MS } from '../../relay/policy.js';
import { createRateLimiter } from '../rateLimit.js';
import {
  ProtectionStatusAuthorityChangedError,
  ProtectionStatusDeviceUnavailableError,
  ProtectionStatusStaleReportError,
  type DeviceProtectionStatusRecord,
  type DeviceProtectionStatusRepository,
  type ProtectionLevel,
} from '../../device/DeviceProtectionStatusRepository.js';
import type { ProtectionAlertProducer } from '../../alerts/ProtectionAlertProducer.js';
import type { TrustSetRoleResolver, ResolvedActor, ActorResolutionFailure } from '../../familyrbac/TrustSetRoleResolver.js';
import { isFamilyEpochNumber } from '../../familyepoch/bounds.js';
import {
  alertComposeFailureMessage,
  CONSOLE_ALERT_COMPOSE_FAILURE_LOGGER,
  type AlertComposeFailureLogger,
} from '../../alerts/AlertComposeFailureLogger.js';

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
    runtimeSyncDskKeyId?: string;
    runtimeSyncTrustSetEpoch?: number;
    runtimeSyncKeyEpoch?: number;
    runtimeSyncSessionIncarnation?: string;
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
  /** PCA-ADD-ENR-016/PCA-FR-145: optional. When supplied, POST /v1/runtime-sync/protection-status is registered. */
  deviceProtectionStatusRepository?: DeviceProtectionStatusRepository;
  /** PCA-ADD-ENR-020: optional. When supplied alongside deviceProtectionStatusRepository, a report that transitions a device INTO DEGRADED emits a PROTECTION_DEGRADED alert. */
  protectionStatusAlerting?: ProtectionStatusAlerting;
  /** FABLE-A013: bounded, best-effort observability for a swallowed compose/produce failure below. Defaults to a console-backed logger; never required, never changes the non-blocking outcome. */
  alertComposeFailureLogger?: AlertComposeFailureLogger;
  /** Current accepted Trust Set membership check for authenticated runtime-sync routes. Missing authority fails closed. */
  trustSetRoleResolver?: Pick<TrustSetRoleResolver, 'resolveActor'>;
}

const PROTECTION_LEVELS: ReadonlySet<string> = new Set(['STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED']);
const FAMILY_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD']);

const MAX_CIPHERTEXT_BASE64_LENGTH = 90_000; // headroom over relay's 64 KiB ciphertext cap once base64-inflated

/**
 * Transport ceiling for /v1/runtime-sync/outbound ONLY.
 *
 * This route deliberately does NOT inherit the global `GLOBAL_BODY_LIMIT_BYTES`
 * ceiling (buildServer.ts): its own contract accepts up to `MAX_OUTBOUND_BATCH_SIZE`
 * envelopes, each up to `MAX_CIPHERTEXT_BASE64_LENGTH` characters, so a
 * contract-legal batch is legitimately megabytes. Sized here from those two
 * constants plus headroom for JSON structure.
 *
 * Found by an independent adversarial review: when the global ceiling was
 * introduced this route silently dropped from Fastify's 1 MiB default to 256 KiB,
 * so a reconnect batch of as few as three maximum-size envelopes began failing
 * with 413 -- a runtime-sync break that presents as a client bug. This value is
 * strictly MORE permissive than the previous 1 MiB default, so it cannot regress
 * anything that worked before, while still being tighter than the route's own
 * loose `MAX_OUTBOUND_BATCH_SIZE * 4` input guard.
 *
 * Written as the expanded literal rather than the product expression, because
 * test/http/globalBodyLimit.test.mjs statically evaluates each declared
 * `MAX_*BODY_BYTES` expression from numeric literals only; an identifier-based
 * expression would be unparseable there and would have to be skipped, which is
 * exactly the blind spot that let this route's regression through in the first
 * place. The derivation is: 25 * 90_000 + 65_536.
 */
export const MAX_OUTBOUND_BODY_BYTES = 2315536;

// Challenge requests carry no body; permit only a small amount of parser
// overhead. Session proofs accept challengeId/signature strings up to 128 and
// 4096 characters respectively. 26 KiB accommodates their worst-case JSON
// escaping while remaining well below the global request ceiling.
const MAX_DEVICE_CHALLENGE_BODY_BYTES = 1024;
const MAX_DEVICE_SESSION_BODY_BYTES = 26 * 1024;

/** PCA-ADD-ENR-020: best-effort alert emission. A composition/delivery failure never blocks or reverses the status write. */
async function emitProtectionDegradedAlert(
  alerting: ProtectionStatusAlerting | undefined,
  familyId: string,
  deviceId: string,
  logger: AlertComposeFailureLogger = CONSOLE_ALERT_COMPOSE_FAILURE_LOGGER,
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
  } catch (error) {
    // Alerting is deliberately non-blocking -- see this function's own doc comment.
    // FABLE-A013: still observable, so an always-failing composer isn't silent forever.
    logger.warn('runtime_sync.protection_degraded_alert.compose_failed', {
      familyId,
      deviceId,
      trigger: 'PROTECTION_DEGRADED',
      error: alertComposeFailureMessage(error),
    });
  }
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

async function markPrivateResponseNoStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Device challenges, bearer credentials, family-scoped status, and opaque
  // relay payloads must not be retained by browser or intermediary caches.
  // Run this before rate limiting/auth so error responses receive it too.
  reply.header('Cache-Control', 'private, no-store');
}

function parseOutboundItem(raw: unknown): OutboundEnvelopeItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isNonEmptyString(candidate.messageId, 128)) return null;
  if (!isNonEmptyString(candidate.recipientDeviceId, 128)) return null;
  if (!isNonEmptyString(candidate.ciphertext, MAX_CIPHERTEXT_BASE64_LENGTH)) return null;
  if (!isNonEmptyString(candidate.messageType, 64)) return null;
  if (candidate.ttlMs !== undefined &&
      (typeof candidate.ttlMs !== 'number' || !Number.isSafeInteger(candidate.ttlMs) ||
        candidate.ttlMs <= 0 || candidate.ttlMs > MAX_RELAY_TTL_MS)) return null;

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
 * `runtimeSyncFamilyId` from a VERIFIED session token, then binds its exact
 * session DSK to the current accepted Trust Set -- route handlers never read
 * identity or authorization scope from the request body or params.
 */
function createRequireDeviceSession(
  deviceSessionService: DeviceSessionService,
  trustSetRoleResolver: RuntimeSyncRoutesDeps['trustSetRoleResolver'],
) {
  return async function requireDeviceSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4096) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    try {
      const identity = await deviceSessionService.validateSession(header.slice('Bearer '.length));
      if (!identity || typeof identity.familyId !== 'string' || identity.familyId.length === 0 ||
          typeof identity.deviceId !== 'string' || identity.deviceId.length === 0 ||
          typeof identity.dskKeyId !== 'string' || identity.dskKeyId.length === 0) {
        await reply.code(503).send({ error: 'authority_unavailable' });
        return;
      }
      if (!trustSetRoleResolver) {
        await reply.code(503).send({ error: 'authority_unavailable' });
        return;
      }
      let actor: ResolvedActor | ActorResolutionFailure;
      try {
        actor = await trustSetRoleResolver.resolveActor(identity.familyId, identity.deviceId, identity.dskKeyId);
      } catch {
        await reply.code(503).send({ error: 'authority_unavailable' });
        return;
      }
      if (typeof actor === 'string') {
        await reply.code(403).send({ error: 'device_not_authorized' });
        return;
      }
      if (typeof actor !== 'object' || actor === null || Array.isArray(actor) ||
          actor.familyId !== identity.familyId || actor.deviceId !== identity.deviceId || !FAMILY_ROLES.has(actor.role) ||
          !isNonEmptyString(actor.dskKeyId, 128) || actor.dskKeyId !== identity.dskKeyId ||
          !isFamilyEpochNumber(actor.trustSetEpoch, 1) ||
          !isFamilyEpochNumber(actor.keyEpoch, 1)) {
        await reply.code(503).send({ error: 'authority_unavailable' });
        return;
      }
      request.runtimeSyncDeviceId = identity.deviceId;
      request.runtimeSyncFamilyId = identity.familyId;
      request.runtimeSyncDskKeyId = identity.dskKeyId;
      request.runtimeSyncTrustSetEpoch = actor.trustSetEpoch;
      request.runtimeSyncKeyEpoch = actor.keyEpoch;
      request.runtimeSyncSessionIncarnation = hashSessionToken(header.slice('Bearer '.length));
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
  const requireDeviceSession = createRequireDeviceSession(deps.deviceSessionService, deps.trustSetRoleResolver);
  const challengeLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'runtime-sync-challenge' });
  const sessionLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'runtime-sync-session' });
  const outboundLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'runtime-sync-outbound' });
  const inboundLimiter = deps.rateLimiter({ windowMs: 60_000, max: 60, bucket: 'runtime-sync-inbound' });

  // Unauthenticated by design (proof of possession happens at /session) --
  // see DeviceSessionService.issueChallengeSafely's doc comment for why
  // this never leaks device existence/family/revocation status.
  app.post(
    '/v1/runtime-sync/devices/:deviceId/challenge',
    { bodyLimit: MAX_DEVICE_CHALLENGE_BODY_BYTES, onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, challengeLimiter] },
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
    { bodyLimit: MAX_DEVICE_SESSION_BODY_BYTES, onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, sessionLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { deviceId } = request.params as { deviceId: string };
      const body = request.body as { challengeId?: unknown; signature?: unknown };
      if (!isNonEmptyString(deviceId, 128) || !isNonEmptyString(body.challengeId, 128) || !isNonEmptyString(body.signature, 4096)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      try {
        const session = await deps.deviceSessionService.completeChallenge(deviceId, body.challengeId, body.signature);
        return reply.send({ sessionToken: session.rawToken, expiresAt: session.expiresAt.toISOString() });
      } catch (error) {
        if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'unauthorized' });
        throw error;
      }
    },
  );

  app.post(
    '/v1/runtime-sync/outbound',
    // Explicit, contract-sized bodyLimit -- see MAX_OUTBOUND_BODY_BYTES's own
    // comment: this route must NOT inherit the global ceiling, because a
    // legitimate batch of control/policy envelopes is larger than it.
    { bodyLimit: MAX_OUTBOUND_BODY_BYTES, onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, requireDeviceSession, outboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { items?: unknown };
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_OUTBOUND_BATCH_SIZE * 4) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const items = body.items.map(parseOutboundItem);
      if (items.some((item) => item === null)) return reply.code(400).send({ error: 'invalid_request' });

      // Authorize recipients lazily inside OutboundRelayService, after its
      // same-family/revoked/browser checks and only for items in the bounded
      // priority slice. That preserves CROSS_FAMILY_RECIPIENT semantics and
      // avoids unbounded Trust Set reads for items this batch will not send.
      const recipientAuthorization = new Map<string, RelayRecipientAuthoritySnapshot | false>();
      const authorizeRecipient = async (recipientDeviceId: string): Promise<false | RelayEnvelopeAuthoritySnapshot> => {
        let recipientSnapshot = recipientAuthorization.get(recipientDeviceId);
        if (recipientSnapshot === false) return false;
        if (!deps.trustSetRoleResolver) throw new RecipientAuthorizationUnavailableError();
        if (recipientSnapshot === undefined) {
          let recipientActor: ResolvedActor | ActorResolutionFailure;
          try {
            recipientActor = await deps.trustSetRoleResolver.resolveActor(
              request.runtimeSyncFamilyId as string,
              recipientDeviceId,
            );
          } catch {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (typeof recipientActor === 'string') {
            recipientAuthorization.set(recipientDeviceId, false);
            return false;
          }
          if (recipientActor === null || typeof recipientActor !== 'object' || Array.isArray(recipientActor) ||
              recipientActor.familyId !== request.runtimeSyncFamilyId || recipientActor.deviceId !== recipientDeviceId || !FAMILY_ROLES.has(recipientActor.role) ||
              !isNonEmptyString(recipientActor.dskKeyId, 128) ||
              !isFamilyEpochNumber(recipientActor.trustSetEpoch, 1) ||
              !isFamilyEpochNumber(recipientActor.keyEpoch, 1)) {
            throw new RecipientAuthorizationUnavailableError();
          }
          recipientSnapshot = {
            familyId: request.runtimeSyncFamilyId as string,
            dskKeyId: recipientActor.dskKeyId,
            trustSetEpoch: recipientActor.trustSetEpoch,
            keyEpoch: recipientActor.keyEpoch,
          };
          recipientAuthorization.set(recipientDeviceId, recipientSnapshot);
        }

        // The recipient lookup above may await durable epoch and device-key
        // reads. Re-resolve the sender after it so both authority snapshots
        // describe one accepted head; the MySQL floor lock below closes any
        // final gap before relay insertion.
        const senderDeviceId = request.runtimeSyncDeviceId as string;
        const senderFamilyId = request.runtimeSyncFamilyId as string;
        const senderDskKeyId = request.runtimeSyncDskKeyId as string;
        let senderActor: ResolvedActor | ActorResolutionFailure;
        try {
          senderActor = await deps.trustSetRoleResolver.resolveActor(senderFamilyId, senderDeviceId, senderDskKeyId);
        } catch {
          throw new RecipientAuthorizationUnavailableError();
        }
        if (typeof senderActor === 'string') return false;
        if (senderActor === null || typeof senderActor !== 'object' || Array.isArray(senderActor) ||
            senderActor.familyId !== senderFamilyId || senderActor.deviceId !== senderDeviceId || senderActor.dskKeyId !== senderDskKeyId ||
            !FAMILY_ROLES.has(senderActor.role) ||
            !isFamilyEpochNumber(senderActor.trustSetEpoch, 1) ||
            !isFamilyEpochNumber(senderActor.keyEpoch, 1)) {
          throw new RecipientAuthorizationUnavailableError();
        }
        if (senderActor.trustSetEpoch !== recipientSnapshot.trustSetEpoch ||
            senderActor.keyEpoch !== recipientSnapshot.keyEpoch) return false;
        return {
          familyId: senderFamilyId,
          trustSetEpoch: senderActor.trustSetEpoch,
          keyEpoch: senderActor.keyEpoch,
          sender: { deviceId: senderDeviceId, dskKeyId: senderDskKeyId },
          recipient: { deviceId: recipientDeviceId, dskKeyId: recipientSnapshot.dskKeyId },
        };
      };

      let result: OutboundBatchResult;
      try {
        result = await deps.outboundRelayService.submitBatch(
          request.runtimeSyncDeviceId as string,
          request.runtimeSyncFamilyId as string,
          items as OutboundEnvelopeItem[],
          authorizeRecipient,
        );
      } catch (error) {
        if (error instanceof RecipientAuthorizationUnavailableError) {
          return reply.code(503).send({ error: 'authority_unavailable' });
        }
        throw error;
      }
      return reply.send({
        results: result.results,
        droppedForBatchBound: result.droppedForBatchBound,
      });
    },
  );

  app.get(
    '/v1/runtime-sync/inbound',
    { onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const deviceId = request.runtimeSyncDeviceId as string;
      const familyId = request.runtimeSyncFamilyId as string;
      const dskKeyId = request.runtimeSyncDskKeyId as string;
      const trustSetEpoch = request.runtimeSyncTrustSetEpoch as number;
      const keyEpoch = request.runtimeSyncKeyEpoch as number;
      const query = request.query as { cursor?: unknown };
      if (query.cursor !== undefined && !isNonEmptyString(query.cursor, MAX_RELAY_CURSOR_BYTES)) {
        return reply.code(400).send({ error: 'invalid_cursor' });
      }
      if (typeof familyId !== 'string' || familyId.length === 0 || typeof dskKeyId !== 'string' || dskKeyId.length === 0 ||
          !isFamilyEpochNumber(trustSetEpoch, 1) || !isFamilyEpochNumber(keyEpoch, 1)) {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      deps.statusTracker.markSyncStart(deviceId);
      try {
        const outcome = await deps.inboundReconnectService.reconnectDrainForRecipient(
          deviceId,
          request.runtimeSyncFamilyId as string,
          (senderKeyId, nowUtc) => deps.resolveEnvelopeContext(senderKeyId, request.runtimeSyncFamilyId as string, nowUtc),
          new Date(),
          { sessionIncarnation: request.runtimeSyncSessionIncarnation as string, cursor: query.cursor as string | undefined },
          { familyId, dskKeyId, trustSetEpoch, keyEpoch },
        );
        // Envelope verification and receipt construction may take time after
        // the transactionally guarded relay reads. Recheck the exact session
        // device/DSK and accepted head before returning any ciphertext: a
        // membership/key rotation during that work must not receive a stale
        // response even though the page read itself was authorized.
        let currentRecipient: ResolvedActor | ActorResolutionFailure;
        try {
          currentRecipient = await deps.trustSetRoleResolver!.resolveActor(familyId, deviceId, dskKeyId);
        } catch {
          return reply.code(503).send({ error: 'authority_unavailable' });
        }
        if (typeof currentRecipient === 'string') {
          return reply.code(403).send({ error: 'device_not_authorized' });
        }
        if (currentRecipient === null || typeof currentRecipient !== 'object' || Array.isArray(currentRecipient) ||
            currentRecipient.familyId !== familyId || currentRecipient.deviceId !== deviceId || currentRecipient.dskKeyId !== dskKeyId ||
            !FAMILY_ROLES.has(currentRecipient.role) ||
            !isFamilyEpochNumber(currentRecipient.trustSetEpoch, 1) ||
            !isFamilyEpochNumber(currentRecipient.keyEpoch, 1)) {
          return reply.code(503).send({ error: 'authority_unavailable' });
        }
        if (currentRecipient.trustSetEpoch !== trustSetEpoch || currentRecipient.keyEpoch !== keyEpoch) {
          return reply.code(403).send({ error: 'device_not_authorized' });
        }
        // A bounded page is not a completed sync while more queue work is
        // pending, and rejected/unresolved records do not count as
        // convergence. The client may continue with nextCursor; only its
        // fully resolved final page can advance the successful-sync time.
        if (!outcome.hasMore && !outcome.hasUnresolved) {
          deps.statusTracker.markSyncSuccess(deviceId, new Date());
        }
        return reply.send({
          scope: { familyId: request.runtimeSyncFamilyId, recipientDeviceId: deviceId },
          applied: outcome.applied.map(envelopeToRawFamilyEnvelope),
          receipts: outcome.receipts.map((receipt) => ({
            messageId: receipt.messageId,
            outcome: receipt.outcome,
            atUtc: receipt.atUtc.toISOString(),
            reason: receipt.reason,
          })),
          unparseableMessageIds: outcome.unparseableMessageIds,
          droppedForListBound: outcome.droppedForListBound,
          hasMore: outcome.hasMore,
          nextCursor: outcome.nextCursor,
          hasUnresolved: outcome.hasUnresolved,
          sessionIncarnation: outcome.sessionIncarnation,
        });
      } catch (error) {
        if (error instanceof InvalidRelayCursorError) return reply.code(400).send({ error: 'invalid_cursor' });
        if (error instanceof RelayAuthorityChangedError) return reply.code(403).send({ error: 'device_not_authorized' });
        throw error;
      } finally {
        deps.statusTracker.markSyncEnd(deviceId);
      }
    },
  );

  app.post(
    '/v1/runtime-sync/inbound/:messageId/ack',
    { onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { messageId } = request.params as { messageId: string };
      if (!isNonEmptyString(messageId, 128)) return reply.code(400).send({ error: 'invalid_request' });
      const deviceId = request.runtimeSyncDeviceId as string;
      const familyId = request.runtimeSyncFamilyId as string;
      const dskKeyId = request.runtimeSyncDskKeyId as string;
      let currentActor: ResolvedActor | ActorResolutionFailure;
      try {
        currentActor = await deps.trustSetRoleResolver!.resolveActor(familyId, deviceId, dskKeyId);
      } catch {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (typeof currentActor === 'string') return reply.code(403).send({ error: 'device_not_authorized' });
      if (typeof currentActor !== 'object' || currentActor === null || Array.isArray(currentActor) ||
          currentActor.familyId !== familyId || currentActor.deviceId !== deviceId || currentActor.dskKeyId !== dskKeyId || !FAMILY_ROLES.has(currentActor.role) ||
          !isFamilyEpochNumber(currentActor.trustSetEpoch, 1) ||
          !isFamilyEpochNumber(currentActor.keyEpoch, 1)) {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      try {
        await deps.outboundRelayService.acknowledgeAsRecipient(deviceId, messageId, {
          familyId,
          dskKeyId,
          trustSetEpoch: currentActor.trustSetEpoch,
          keyEpoch: currentActor.keyEpoch,
        });
        return reply.send({ acknowledged: true });
      } catch (error) {
        if (error instanceof RelayAuthorityChangedError) return reply.code(403).send({ error: 'device_not_authorized' });
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
    { onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
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
      { onRequest: markPrivateResponseNoStore, preHandler: [deps.authAttemptLimiter, requireDeviceSession, inboundLimiter] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const rawBody: unknown = request.body;
        if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const body = rawBody as { protectionLevel?: unknown };
        if (typeof body.protectionLevel !== 'string' || !PROTECTION_LEVELS.has(body.protectionLevel)) {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        const deviceId = request.runtimeSyncDeviceId as string;
        const familyId = request.runtimeSyncFamilyId as string;
        const dskKeyId = request.runtimeSyncDskKeyId as string;
        // The pre-handler check prevents stale sessions from entering route
        // work. Re-resolve after body validation at the final write boundary
        // so a Trust Set removal/rotation during intervening work cannot
        // authorize a durable status report under an old DSK.
        let currentActor: ResolvedActor | ActorResolutionFailure;
        try {
          currentActor = await deps.trustSetRoleResolver!.resolveActor(familyId, deviceId, dskKeyId);
        } catch {
          return reply.code(503).send({ error: 'authority_unavailable' });
        }
        if (typeof currentActor === 'string') {
          return reply.code(403).send({ error: 'device_not_authorized' });
        }
        if (typeof currentActor !== 'object' || currentActor === null || Array.isArray(currentActor) ||
            currentActor.familyId !== familyId || currentActor.deviceId !== deviceId || currentActor.dskKeyId !== dskKeyId || !FAMILY_ROLES.has(currentActor.role) ||
            !isFamilyEpochNumber(currentActor.trustSetEpoch, 1) ||
            !isFamilyEpochNumber(currentActor.keyEpoch, 1)) {
          return reply.code(503).send({ error: 'authority_unavailable' });
        }
        const nextLevel = body.protectionLevel as ProtectionLevel;
        const authority = {
          dskKeyId,
          trustSetEpoch: currentActor.trustSetEpoch,
          keyEpoch: currentActor.keyEpoch,
        };
        // Capture the server receipt clock before any repository awaits. In
        // particular, alert-transition lookup latency must not change the
        // timestamp assigned to this report, and the client never supplies it.
        const receivedAt = new Date();
        const record = { deviceId, familyId, protectionLevel: nextLevel, updatedAt: receivedAt };
        // When transition alerts are enabled, read the prior single-row value
        // and persist this report atomically. Otherwise a concurrent pair of
        // DEGRADED reports could both observe the same non-DEGRADED status
        // and produce duplicate transition alerts.
        let previous: DeviceProtectionStatusRecord | null = null;
        try {
          previous = deps.protectionStatusAlerting
            ? await protectionStatusRepository.recordAndReadPrevious(record, authority)
            : (await protectionStatusRepository.upsert(record, authority), null);
        } catch (error) {
          if (error instanceof ProtectionStatusStaleReportError) {
            // A delayed report must not roll back stored state or emit a
            // transition alert. It is an accepted idempotent no-op.
            return reply.code(204).send();
          }
          if (error instanceof ProtectionStatusDeviceUnavailableError || error instanceof ProtectionStatusAuthorityChangedError) {
            return reply.code(403).send({ error: 'device_not_authorized' });
          }
          throw error;
        }
        if (nextLevel === 'DEGRADED' && previous?.protectionLevel !== 'DEGRADED') {
          await emitProtectionDegradedAlert(deps.protectionStatusAlerting, familyId, deviceId, deps.alertComposeFailureLogger);
        }
        return reply.code(204).send();
      },
    );
  }
}
