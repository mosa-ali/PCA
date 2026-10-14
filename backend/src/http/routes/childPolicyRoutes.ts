/**
 * PCA product-completion programme, Writer P0-B: screen-time + apps policy
 * writes. Per docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
 * POLICY_WRITE_AUTHORITY section, this is a thin pre-check in front of the
 * existing envelope relay -- NOT a new plaintext policy store. This file
 * follows the SAME session/CSRF/actor-device-binding conventions
 * childRequestRoutes.ts and parentAccountRoutes.ts's Safe Zone routes
 * already established (see either file's own header comment for the full
 * rationale): `actorDeviceId` is derived EXCLUSIVELY from a verified
 * DeviceSessionService session token presented as `Authorization: Bearer
 * <token>`, never a client-supplied field.
 *
 * The request body is the existing signed FamilyEnvelope wire shape. This
 * route validates its structure and binds family/sender/recipient metadata,
 * but does not verify the envelope signature or decrypt/apply its opaque
 * payload. recipientDeviceId remains envelope-bound, and the route also
 * checks the existing durable enrollment binding (device -> bootstrap
 * attempt -> invitation) matches the requested child profile. There is no
 * direct child_profile_id column on devices; legacy, inactive, ambiguous,
 * or otherwise unbound devices fail closed. OutboundRelayService.submitBatch
 * independently verifies recipientDeviceId resolves to a real device in
 * the CALLER's own family (CROSS_FAMILY_RECIPIENT otherwise).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { CSRF_HEADER_NAME, csrfCookieName, parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { AuthorizationDecision, ParentActionAuthorizationService } from '../../familyrbac/ParentActionAuthorizationService.js';
import type { ActorResolutionFailure, ResolvedActor, TrustSetRoleResolver } from '../../familyrbac/TrustSetRoleResolver.js';
import type { DeviceChildBindingOutcome, DeviceChildBindingRepository } from '../../device/DeviceChildBindingRepository.js';
import {
  RecipientAuthorizationUnavailableError,
  type OutboundBatchResult,
  type OutboundRelayService,
} from '../../runtime-sync/OutboundRelayService.js';
import { parseFamilyEnvelope } from '../../familyenvelope/parse.js';
import { envelopeToRelayCiphertext } from '../../runtime-sync/envelopeWireCodec.js';
import type { RelayEnvelopeAuthoritySnapshot } from '../../relay/RelayRepository.js';
import { isFamilyEpochNumber } from '../../familyepoch/bounds.js';

const MAX_BODY_BYTES = 96 * 1024; // matches parentAccountRoutes.ts's MAX_SAFE_ZONE_BODY_BYTES order of magnitude
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/** The sender's accepted authority changed after Parent authorization but before relay persistence. */
class SenderAuthorityChangedError extends Error {
  constructor() {
    super('The policy sender authority changed before enqueue.');
    this.name = 'SenderAuthorityChangedError';
  }
}

/** Parent family membership was revoked or demoted after the initial request authorization. */
class ParentAuthorityChangedError extends Error {
  constructor() {
    super('The Parent account authority changed before enqueue.');
    this.name = 'ParentAuthorityChangedError';
  }
}

export interface ChildPolicyRoutesDeps {
  parentAccountService: ParentAccountService;
  deviceSessionService: DeviceSessionService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- omitting it fails the route closed with 503 (matching parentAccountRoutes.ts's Safe Zone `not_configured` convention), never a silent allow. */
  parentActionAuthorization?: Pick<ParentActionAuthorizationService, 'authorize'>;
  /** Binds policy writes to the exact DSK held by the current accepted Trust Set member entry. Omission fails closed. */
  trustSetRoleResolver?: Pick<TrustSetRoleResolver, 'resolveActor'>;
  /** Resolves the device's durable invitation-to-child binding. Omission fails closed. */
  deviceChildBindingRepository?: Pick<DeviceChildBindingRepository, 'resolveBinding'>;
  outboundRelayService: Pick<OutboundRelayService, 'submitBatch'>;
  now?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
}

function csrfOk(request: FastifyRequest): boolean {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies.get(csrfCookieName());
  const headerToken = request.headers[CSRF_HEADER_NAME];
  if (typeof cookieToken !== 'string' || cookieToken.length === 0) return false;
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;
  return cookieToken === headerToken;
}

const SCHEDULE_POLICY_ENVELOPE_FIELDS = new Set([
  'protocolMajor', 'protocolMinor', 'messageId', 'familyId', 'senderDeviceId',
  'recipientDeviceId', 'recipientGroup', 'senderKeyId', 'messageType',
  'trustSetEpoch', 'keyEpoch', 'sequenceOrNonce', 'issuedAt', 'expiresAt',
  'semanticVersion', 'correlationId', 'payload', 'signature',
]);

type ParsedFamilyEnvelope = NonNullable<ReturnType<typeof parseFamilyEnvelope>>;
type DevicePolicyEnvelope = Omit<ParsedFamilyEnvelope, 'messageType' | 'recipient'> & {
  messageType: 'POLICY_UPDATE';
  recipient: Extract<ParsedFamilyEnvelope['recipient'], { kind: 'DEVICE' }>;
};

function parseSchedulePolicyEnvelope(body: unknown): DevicePolicyEnvelope | null {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !SCHEDULE_POLICY_ENVELOPE_FIELDS.has(key))) {
    return null;
  }
  const envelope = parseFamilyEnvelope(body);
  if (!envelope || envelope.messageType !== 'POLICY_UPDATE' || envelope.recipient.kind !== 'DEVICE') {
    return null;
  }
  return { ...envelope, messageType: 'POLICY_UPDATE', recipient: envelope.recipient };
}

export function registerChildPolicyRoutes(app: FastifyInstance, deps: ChildPolicyRoutesDeps): void {
  const now = deps.now ?? (() => new Date());

  async function familySession(request: FastifyRequest, reply: FastifyReply): Promise<{ accountId: string; familyId: string } | null> {
    const token = readSessionCookie(request);
    if (token === null) {
      await reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    try {
      const session = await deps.parentAccountService.readSession(token);
      if (!session.familyId) {
        await reply.code(403).send({ error: 'family_scope_required' });
        return null;
      }
      const { familyId } = request.params as { familyId?: string };
      if (!familyId || familyId !== session.familyId) {
        await reply.code(403).send({ error: 'family_scope_forbidden' });
        return null;
      }
      return { accountId: session.accountId, familyId: session.familyId };
    } catch (error) {
      if (error instanceof ParentAccountError) {
        await reply.code(401).send({ error: 'unauthorized' });
        return null;
      }
      throw error;
    }
  }

  /** Same actor-identity-binding rationale as childRequestRoutes.ts's requireActorDevice -- see this file's own header comment. */
  async function requireActorDevice(request: FastifyRequest, reply: FastifyReply, familyId: string): Promise<{ deviceId: string; dskKeyId: string } | null> {
    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') || authorizationHeader.length > 4096) {
      await reply.code(401).send({ error: 'actor_device_session_required' });
      return null;
    }
    try {
      const identity = await deps.deviceSessionService.requireActorDeviceInFamily(authorizationHeader.slice('Bearer '.length), familyId);
      if (!identity.dskKeyId) {
        await reply.code(503).send({ error: 'authority_unavailable' });
        return null;
      }
      return { deviceId: identity.deviceId, dskKeyId: identity.dskKeyId };
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) {
        await reply.code(401).send({ error: 'actor_device_session_invalid' });
        return null;
      }
      // A storage/authentication dependency outage is not an invalid bearer
      // token. Keep it distinct so callers can retry instead of reporting a
      // misleading authentication failure or generic 500.
      await reply.code(503).send({ error: 'actor_device_session_unavailable' });
      return null;
    }
  }

  app.post(
    '/api/parent/families/:familyId/children/:childProfileId/schedule-policy',
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'private, no-store');
      const session = await familySession(request, reply);
      if (!session) return;
      if (!csrfOk(request)) return reply.code(403).send({ error: 'csrf_mismatch' });
      if (!deps.parentActionAuthorization) {
        if (await deps.parentAccountService.activeFamilyRole(session.accountId as never, session.familyId) !== 'ADMINISTRATOR') {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (!(await requireActorDevice(request, reply, session.familyId))) return;
        return reply.code(503).send({ error: 'not_configured' });
      }

      const { childProfileId } = request.params as { childProfileId?: string };
      if (!childProfileId || !OPAQUE_TOKEN.test(childProfileId)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const envelope = parseSchedulePolicyEnvelope(request.body);
      if (!envelope || envelope.familyId !== session.familyId) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      if (await deps.parentAccountService.activeFamilyRole(session.accountId as never, session.familyId) !== 'ADMINISTRATOR') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const actorDeviceId = await requireActorDevice(request, reply, session.familyId);
      if (!actorDeviceId) return;
      if (envelope.senderDeviceId !== actorDeviceId.deviceId || envelope.senderKeyId !== actorDeviceId.dskKeyId) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      // Device sessions are pinned to the DSK that proved possession at
      // issuance, but an old key can remain ACTIVE during an accepted-key
      // overlap. Bind that exact session key to the current accepted member
      // entry before authorizing or queuing a policy update.
      if (!deps.trustSetRoleResolver) return reply.code(503).send({ error: 'authority_unavailable' });
      let acceptedActor: ResolvedActor | ActorResolutionFailure;
      try {
        acceptedActor = await deps.trustSetRoleResolver.resolveActor(
          session.familyId,
          actorDeviceId.deviceId,
          actorDeviceId.dskKeyId,
        );
      } catch {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (typeof acceptedActor === 'string') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (acceptedActor === null || typeof acceptedActor !== 'object' || Array.isArray(acceptedActor) ||
          acceptedActor.familyId !== session.familyId ||
          acceptedActor.deviceId !== actorDeviceId.deviceId ||
          acceptedActor.dskKeyId !== actorDeviceId.dskKeyId ||
          !['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'].includes(acceptedActor.role) ||
          !isFamilyEpochNumber(acceptedActor.trustSetEpoch, 1) ||
          !isFamilyEpochNumber(acceptedActor.keyEpoch, 1)) {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }

      // The actor is resolved from the current accepted Trust Set, so the
      // signed envelope metadata must describe that same authority snapshot.
      // A stale or not-yet-accepted future epoch must never get a successful
      // queue receipt; the receiving device would reject it later, but the
      // server already has enough non-content metadata to fail it closed.
      if (envelope.trustSetEpoch !== acceptedActor.trustSetEpoch || envelope.keyEpoch !== acceptedActor.keyEpoch) {
        return reply.code(409).send({ error: 'authority_changed' });
      }

      // TRUE authority is the receiving device's own signed-envelope
      // verification against its own trust set -- this call is a pre-check
      // only (ParentActionAuthorizationService's own doc comment). The
      // production resolver returns NO_TRUST_SET while no accepted epoch
      // exists and also fails closed on read/decode errors; a server ACL
      // never stands in for family cryptographic authority.
      const issuedAt = now();
      let decision: AuthorizationDecision;
      try {
        decision = await deps.parentActionAuthorization.authorize({
          familyId: session.familyId,
          actorDeviceId: actorDeviceId.deviceId,
          actorDskKeyId: actorDeviceId.dskKeyId,
          operation: 'EDIT_CHILD_POLICY',
          targetScope: { kind: 'CHILD_PROFILE', id: childProfileId },
          issuedAt,
          expiresAt: new Date(issuedAt.getTime() + 60_000),
          stepUp: null,
          idempotencyKey: randomUUID(),
          actionId: randomUUID(),
        });
      } catch {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (decision.verdict !== 'ALLOW') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      // This endpoint targets a child profile, so its recipient must be an
      // ACTIVE CHILD in the current accepted Trust Set, at the envelope's
      // authority epochs, and bound to this exact profile by the durable
      // enrollment-attempt -> invitation relationship. Do these lookups only
      // after ParentAction authorization so a denied Parent cannot probe
      // device roles or child bindings through response differences.
      let acceptedRecipient: ResolvedActor | ActorResolutionFailure;
      try {
        acceptedRecipient = await deps.trustSetRoleResolver.resolveActor(
          session.familyId,
          envelope.recipient.recipientDeviceId,
        );
      } catch {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (typeof acceptedRecipient === 'string') {
        return reply.code(400).send({ error: 'invalid_recipient' });
      }
      if (acceptedRecipient === null || typeof acceptedRecipient !== 'object' || Array.isArray(acceptedRecipient) ||
          acceptedRecipient.familyId !== session.familyId ||
          acceptedRecipient.deviceId !== envelope.recipient.recipientDeviceId ||
          typeof acceptedRecipient.dskKeyId !== 'string' || acceptedRecipient.dskKeyId.length === 0 ||
          !isFamilyEpochNumber(acceptedRecipient.trustSetEpoch, 1) ||
          !isFamilyEpochNumber(acceptedRecipient.keyEpoch, 1)) {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (acceptedRecipient.role !== 'CHILD') return reply.code(400).send({ error: 'invalid_recipient' });
      if (acceptedRecipient.trustSetEpoch !== envelope.trustSetEpoch || acceptedRecipient.keyEpoch !== envelope.keyEpoch) {
        return reply.code(409).send({ error: 'authority_changed' });
      }

      if (!deps.deviceChildBindingRepository) return reply.code(503).send({ error: 'authority_unavailable' });
      let recipientBinding: DeviceChildBindingOutcome;
      try {
        recipientBinding = await deps.deviceChildBindingRepository.resolveBinding(
          session.familyId,
          envelope.recipient.recipientDeviceId,
        );
      } catch {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (recipientBinding === null || typeof recipientBinding !== 'object' || Array.isArray(recipientBinding) ||
          typeof recipientBinding.outcome !== 'string') {
        return reply.code(503).send({ error: 'authority_unavailable' });
      }
      if (recipientBinding.outcome !== 'BOUND' || recipientBinding.childProfileId !== childProfileId) {
        return reply.code(400).send({ error: 'invalid_recipient' });
      }

      // Do not turn an already-expired signed envelope into a successful
      // PENDING receipt. Recheck before recipient resolution for a truthful
      // route response, then pass the signed absolute expiry so the relay can
      // enforce it again after that asynchronous lookup and storage cleanup.
      const enqueueAt = now();
      const enqueueAtMs = enqueueAt instanceof Date ? enqueueAt.getTime() : Number.NaN;
      const remainingEnvelopeLifetimeMs = envelope.expiresAt.getTime() - enqueueAtMs;
      if (!Number.isFinite(enqueueAtMs)) return reply.code(503).send({ error: 'relay_unavailable' });
      if (remainingEnvelopeLifetimeMs <= 0) return reply.code(400).send({ error: 'expired' });
      // Keep the repository reference stable for the async enqueue callback.
      // The preflight above gives useful early errors; this second lookup is
      // the authority check immediately before relay persistence.
      const bindingRepository = deps.deviceChildBindingRepository;
      if (!bindingRepository) return reply.code(503).send({ error: 'authority_unavailable' });

      let result: OutboundBatchResult;
      try {
        result = await deps.outboundRelayService.submitBatch(actorDeviceId.deviceId, session.familyId, [
          {
            messageId: envelope.messageId,
            recipientDeviceId: envelope.recipient.recipientDeviceId,
            ciphertext: envelopeToRelayCiphertext(envelope),
            messageType: 'POLICY_UPDATE',
            enqueuedAtEpochMillis: envelope.issuedAt.getTime(),
            validUntil: envelope.expiresAt,
          },
        ], async (recipientDeviceId) => {
          let currentRecipient: ResolvedActor | ActorResolutionFailure;
          try {
            currentRecipient = await deps.trustSetRoleResolver!.resolveActor(session.familyId, recipientDeviceId);
          } catch {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (typeof currentRecipient === 'string') return false;
          if (currentRecipient === null || typeof currentRecipient !== 'object' || Array.isArray(currentRecipient) ||
              currentRecipient.familyId !== session.familyId ||
              currentRecipient.deviceId !== recipientDeviceId ||
              typeof currentRecipient.dskKeyId !== 'string' || currentRecipient.dskKeyId.length === 0 ||
              !['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'].includes(currentRecipient.role) ||
              !isFamilyEpochNumber(currentRecipient.trustSetEpoch, 1) ||
              !isFamilyEpochNumber(currentRecipient.keyEpoch, 1)) {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (currentRecipient.role !== 'CHILD' ||
              currentRecipient.trustSetEpoch !== envelope.trustSetEpoch ||
              currentRecipient.keyEpoch !== envelope.keyEpoch) return false;
          // Binding can change between request preflight and enqueue. Require
          // the same durable profile edge at the final authorization boundary;
          // receiver-side session and cryptographic checks remain authoritative
          // for delivery/application after this queue-eligibility decision.
          let currentBinding: DeviceChildBindingOutcome;
          try {
            currentBinding = await bindingRepository.resolveBinding(session.familyId, recipientDeviceId);
          } catch {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (currentBinding === null || typeof currentBinding !== 'object' || Array.isArray(currentBinding) ||
              typeof currentBinding.outcome !== 'string') {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (currentBinding.outcome !== 'BOUND' || currentBinding.childProfileId !== childProfileId) return false;

          // Parent authorization and the recipient/profile reads above may
          // yield to storage. Recheck the exact sender DSK/role/epoch after
          // those reads and immediately before submitOne persists the envelope;
          // a demoted or rotated sender must not receive a successful PENDING
          // receipt for an envelope authored under the older snapshot.
          let currentSender: ResolvedActor | ActorResolutionFailure;
          try {
            currentSender = await deps.trustSetRoleResolver!.resolveActor(
              session.familyId,
              actorDeviceId.deviceId,
              actorDeviceId.dskKeyId,
            );
          } catch {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (typeof currentSender === 'string') throw new SenderAuthorityChangedError();
          if (currentSender === null || typeof currentSender !== 'object' || Array.isArray(currentSender) ||
              currentSender.familyId !== session.familyId ||
              currentSender.deviceId !== actorDeviceId.deviceId ||
              currentSender.dskKeyId !== actorDeviceId.dskKeyId ||
              !['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'].includes(currentSender.role) ||
              !isFamilyEpochNumber(currentSender.trustSetEpoch, 1) ||
              !isFamilyEpochNumber(currentSender.keyEpoch, 1)) {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (currentSender.role !== acceptedActor.role ||
              currentSender.trustSetEpoch !== envelope.trustSetEpoch ||
              currentSender.keyEpoch !== envelope.keyEpoch) {
            throw new SenderAuthorityChangedError();
          }
          // The Parent account's family membership is a separate authority
          // from its browser device's Trust Set role. Parent authorization
          // and the recipient/binding checks above can yield to storage, so
          // recheck the live account role at the final relay eligibility
          // boundary as well. A still-OWNER browser device must not keep
          // authoring policy after its Parent account was demoted/revoked.
          let currentParentRole: string | null;
          try {
            currentParentRole = await deps.parentAccountService.activeFamilyRole(
              session.accountId as never,
              session.familyId,
            );
          } catch {
            throw new RecipientAuthorizationUnavailableError();
          }
          if (currentParentRole !== 'ADMINISTRATOR') throw new ParentAuthorityChangedError();

          const authority: RelayEnvelopeAuthoritySnapshot = {
            familyId: session.familyId,
            trustSetEpoch: envelope.trustSetEpoch,
            keyEpoch: envelope.keyEpoch,
            sender: { deviceId: currentSender.deviceId, dskKeyId: currentSender.dskKeyId },
            recipient: { deviceId: currentRecipient.deviceId, dskKeyId: currentRecipient.dskKeyId },
            parentAccountId: session.accountId,
          };
          return authority;
        });
      } catch (error) {
        if (error instanceof SenderAuthorityChangedError) {
          return reply.code(409).send({ error: 'authority_changed' });
        }
        if (error instanceof ParentAuthorityChangedError) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (error instanceof RecipientAuthorizationUnavailableError) {
          return reply.code(503).send({ error: 'authority_unavailable' });
        }
        // A thrown persistence/relay error has no accepted queue receipt. The
        // caller may retry the exact same signed envelope and message ID.
        return reply.code(503).send({ error: 'relay_unavailable' });
      }
      const outcome = result.results.find((item) => item.messageId === envelope.messageId)?.outcome;
      if (outcome === 'AUTHORITY_CHANGED') {
        return reply.code(409).send({ error: 'authority_changed' });
      }
      if (outcome === 'CROSS_FAMILY_RECIPIENT' || outcome === 'INVALID') {
        return reply.code(400).send({ error: 'invalid_recipient' });
      }
      if (outcome === 'CONFLICT') {
        return reply.code(409).send({ error: 'conflict' });
      }
      if (outcome === 'EXPIRED') return reply.code(400).send({ error: 'expired' });
      // A pending receipt is truthful only when the exact signed messageId
      // was accepted by the relay. Missing outcomes and batch-bound drops
      // leave the caller free to retry the same envelope without claiming
      // that the server queued it.
      if (outcome !== 'QUEUED') {
        return reply.code(503).send({ error: 'relay_unavailable' });
      }
      // This is queue acceptance only, never DELIVERED/APPLIED (see the
      // architecture's PENDING/DELIVERED/APPLIED semantics).
      return reply.code(202).send({ status: 'PENDING', messageId: envelope.messageId });
    },
  );
}
