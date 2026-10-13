/**
 * PCA product-completion programme, Writer P0-D (/security/audit): the
 * authenticated HTTP surface for authorized Parent family members to read
 * their own device's opaque audit-event envelopes. Active family
 * Administrator/Viewer roles come from the Parent session; the separate
 * proof-of-possession device session binds ciphertext delivery to one
 * recipient device. Encrypted content remains opaque until handled by the
 * client-side decryption boundary.
 *
 * This route returns OPAQUE fields only (envelopeId/encryptedPayloadB64/
 * nonceB64/keyEpoch/generatedAtUtc) -- never a FamilyAuditRecord field.
 * Decryption and rendering happen exclusively in parent-web, on a trusted
 * browser, exactly like ProtectionAlertPanel.tsx's existing
 * PENDING_TRUSTED_DECRYPTION pattern. This is NOT the plaintext audit-read
 * endpoint AUDIT_EVENT_MODEL explicitly rules out -- see
 * docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Buffer } from 'node:buffer';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import {
  decodeFamilyAuditEventCursor,
  encodeFamilyAuditEventCursor,
  type FamilyAuditEventEnvelope,
  type FamilyAuditEventLedger,
} from '../../familyrbac/FamilyAuditEventLedger.js';
import { isFamilyEpochNumber } from '../../familyepoch/bounds.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from '../../familyrbac/TrustSetRoleResolver.js';
import type { FamilyRole } from '../../familyrbac/types.js';
import { MAX_SERVER_CIPHERTEXT_FEED_ROWS } from '../../retention/serverCiphertextTtl.js';

const PARENT_DEVICE_ROLES: ReadonlySet<FamilyRole> = new Set(['OWNER', 'ADMINISTRATOR', 'VIEWER']);

export interface FamilyAuditEventRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- when omitted, this file registers nothing (mirrors registerFamilyMemberRoutes' own optional-feature convention). */
  familyAuditEventLedger?: FamilyAuditEventLedger;
  /** Optional for buildServer compatibility; the route fails closed with 503 until the shared service is injected. */
  deviceSessionService?: Pick<DeviceSessionService, 'requireActorDeviceInFamily'>;
  /** Required for delivery: binds the live session's exact DSK to accepted active Trust Set membership. */
  trustSetRoleResolver?: Pick<TrustSetRoleResolver, 'resolveActor'>;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
}

function readActorDeviceSessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || authorization.length <= 7 ||
      authorization.length > 4096 || /[\r\n]/.test(authorization)) {
    return null;
  }
  return authorization.slice(7);
}

function toEnvelopeDto(envelope: { envelopeId: string; keyEpoch: number; generatedAtUtc: Date; encryptedPayloadB64: string; nonceB64: string }): Record<string, unknown> {
  if (!isFamilyEpochNumber(envelope.keyEpoch)) {
    throw new Error('Family audit key epoch is outside the supported family epoch range.');
  }
  return {
    envelopeId: envelope.envelopeId,
    keyEpoch: envelope.keyEpoch,
    generatedAtUtc: envelope.generatedAtUtc.toISOString(),
    encryptedPayloadB64: envelope.encryptedPayloadB64,
    nonceB64: envelope.nonceB64,
  };
}

function compareEnvelopePosition(
  left: Pick<FamilyAuditEventEnvelope, 'generatedAtUtc' | 'envelopeId'>,
  right: Pick<FamilyAuditEventEnvelope, 'generatedAtUtc' | 'envelopeId'>,
): number {
  const byTime = left.generatedAtUtc.getTime() - right.generatedAtUtc.getTime();
  return byTime !== 0 ? byTime : Buffer.compare(Buffer.from(left.envelopeId, 'utf8'), Buffer.from(right.envelopeId, 'utf8'));
}

function isScopedOrderedPage(
  envelopes: unknown,
  familyId: string,
  parentDeviceId: string,
  keyEpoch: number,
  cursor: { generatedAtUtc: Date; envelopeId: string } | undefined,
): envelopes is FamilyAuditEventEnvelope[] {
  if (!Array.isArray(envelopes) || envelopes.length > MAX_SERVER_CIPHERTEXT_FEED_ROWS) return false;
  let previous = cursor;
  for (const value of envelopes) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const envelope = value as FamilyAuditEventEnvelope;
    if (envelope.familyId !== familyId || envelope.parentDeviceId !== parentDeviceId || envelope.keyEpoch !== keyEpoch ||
        typeof envelope.envelopeId !== 'string' || envelope.envelopeId.length < 1 ||
        Array.from(envelope.envelopeId).length > 200 || /[\uD800-\uDFFF]/u.test(envelope.envelopeId) ||
        !(envelope.generatedAtUtc instanceof Date) || !Number.isFinite(envelope.generatedAtUtc.getTime()) ||
        typeof envelope.encryptedPayloadB64 !== 'string' || envelope.encryptedPayloadB64.length < 1 ||
        typeof envelope.nonceB64 !== 'string' || envelope.nonceB64.length < 1) {
      return false;
    }
    if (previous && compareEnvelopePosition(envelope, previous) <= 0) return false;
    previous = envelope;
  }
  return true;
}

export function registerFamilyAuditEventRoutes(app: FastifyInstance, deps: FamilyAuditEventRoutesDeps): void {
  if (!deps.familyAuditEventLedger) return;
  const { parentAccountService, familyAuditEventLedger, deviceSessionService, trustSetRoleResolver } = deps;

  app.get('/api/parent/families/:familyId/audit-events', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'private, no-store');
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    let familyIdFromSession: string;
    let accountId: string;
    try {
      const session = await parentAccountService.readSession(token);
      if (!session.familyId) return reply.code(403).send({ error: 'family_scope_required' });
      familyIdFromSession = session.familyId;
      accountId = session.accountId;
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }

    const { familyId } = request.params as { familyId?: string };
    if (!familyId || familyId !== familyIdFromSession) {
      return reply.code(403).send({ error: 'family_scope_forbidden' });
    }
    let role;
    try {
      role = await parentAccountService.activeFamilyRole(accountId, familyId);
    } catch {
      return reply.code(503).send({ error: 'family_authority_unavailable' });
    }
    if (role !== 'ADMINISTRATOR' && role !== 'VIEWER') return reply.code(403).send({ error: 'forbidden' });

    if (!deviceSessionService) return reply.code(503).send({ error: 'device_session_unavailable' });
    const actorToken = readActorDeviceSessionToken(request);
    if (actorToken === null) return reply.code(401).send({ error: 'unauthorized' });

    let actorDeviceId: string;
    let actorDskKeyId: string;
    try {
      const identity = await deviceSessionService.requireActorDeviceInFamily(actorToken, familyId);
      if (!identity.deviceId || !identity.dskKeyId || identity.familyId !== familyId) return reply.code(401).send({ error: 'unauthorized' });
      actorDeviceId = identity.deviceId;
      actorDskKeyId = identity.dskKeyId;
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'unauthorized' });
      return reply.code(503).send({ error: 'device_session_unavailable' });
    }

    // A still-live device session is not proof that the device remains an
    // active member of the accepted Trust Set. Bind the session's exact DSK
    // before querying recipient ciphertext so a removed/rekeyed device cannot
    // continue draining its old queue.
    if (!trustSetRoleResolver) return reply.code(503).send({ error: 'family_authority_unavailable' });
    let actor;
    try {
      actor = await trustSetRoleResolver.resolveActor(familyId, actorDeviceId, actorDskKeyId);
    } catch {
      return reply.code(503).send({ error: 'family_authority_unavailable' });
    }
    if (isActorResolutionFailure(actor) || !actor || typeof actor !== 'object' || Array.isArray(actor) ||
      actor.familyId !== familyId || actor.deviceId !== actorDeviceId || actor.dskKeyId !== actorDskKeyId || !PARENT_DEVICE_ROLES.has(actor.role) ||
      !isFamilyEpochNumber(actor.trustSetEpoch, 1) || !isFamilyEpochNumber(actor.keyEpoch, 1)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const query = request.query as { cursor?: unknown };
    let cursor;
    if (query.cursor !== undefined) {
      cursor = decodeFamilyAuditEventCursor(query.cursor);
      if (!cursor) return reply.code(400).send({ error: 'invalid_cursor' });
    }

    // Each encrypted envelope is recipient-keyed. A family role grants the
    // family scope, but only the proof-of-possession session above identifies
    // which device may fetch its own ciphertext. The ledger's exact
    // (familyId, parentDeviceId, accepted keyEpoch) query is the binding boundary.
    // Recheck both Parent membership and the device's accepted Trust Set
    // snapshot after the asynchronous read: a role revocation or key rotation
    // during the ledger lookup must not receive a successful stale-scope read.
    let envelopes: FamilyAuditEventEnvelope[];
    try {
      envelopes = cursor
        ? await familyAuditEventLedger.listForParentDevice(familyId, actorDeviceId, actor.keyEpoch, { cursor })
        : await familyAuditEventLedger.listForParentDevice(familyId, actorDeviceId, actor.keyEpoch);
    } catch {
      return reply.code(503).send({ error: 'family_audit_unavailable' });
    }
    let currentRole;
    try {
      currentRole = await parentAccountService.activeFamilyRole(accountId, familyId);
    } catch {
      return reply.code(503).send({ error: 'family_authority_unavailable' });
    }
    if (currentRole !== 'ADMINISTRATOR' && currentRole !== 'VIEWER') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    let currentActor;
    try {
      currentActor = await trustSetRoleResolver.resolveActor(familyId, actorDeviceId, actorDskKeyId);
    } catch {
      return reply.code(503).send({ error: 'family_authority_unavailable' });
    }
    if (isActorResolutionFailure(currentActor) || !currentActor || typeof currentActor !== 'object' ||
        Array.isArray(currentActor) || currentActor.familyId !== familyId || currentActor.deviceId !== actorDeviceId || currentActor.dskKeyId !== actorDskKeyId ||
        !PARENT_DEVICE_ROLES.has(currentActor.role) ||
        !isFamilyEpochNumber(currentActor.trustSetEpoch, 1) || !isFamilyEpochNumber(currentActor.keyEpoch, 1)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (currentActor.trustSetEpoch !== actor.trustSetEpoch) {
      return reply.code(409).send({ error: 'authority_changed' });
    }
    if (currentActor.keyEpoch !== actor.keyEpoch) {
      return reply.code(409).send({ error: 'key_epoch_mismatch' });
    }
    // Treat the ledger adapter as a persistence boundary, not as a second
    // authorization decision. Verify its entire page still matches the live
    // recipient and accepted epoch, and that keyset ordering is strict before
    // any opaque payload or continuation cursor is serialized.
    if (!isScopedOrderedPage(envelopes, familyId, actorDeviceId, actor.keyEpoch, cursor)) {
      return reply.code(503).send({ error: 'family_audit_unavailable' });
    }
    try {
      // A full page always carries a continuation cursor. The follow-up may
      // be empty when the feed contains exactly one page; only a short page
      // establishes that no continuation request remains.
      const nextCursor = envelopes.length === MAX_SERVER_CIPHERTEXT_FEED_ROWS
        ? encodeFamilyAuditEventCursor(envelopes[envelopes.length - 1]!)
        : null;
      return reply.code(200).send({
        envelopes: envelopes.map(toEnvelopeDto),
        complete: nextCursor === null,
        nextCursor,
      });
    } catch {
      return reply.code(503).send({ error: 'family_audit_unavailable' });
    }
  });
}
