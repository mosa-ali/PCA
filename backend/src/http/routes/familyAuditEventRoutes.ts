/**
 * PCA product-completion programme, Writer P0-D (/security/audit): the
 * authenticated HTTP surface a parent's OWN trusted browser device polls to
 * receive its family's opaque audit-event envelopes (FamilyAuditEventLedger).
 * Follows the SAME session/CSRF/actor-device conventions
 * familyMemberRoutes.ts/childPolicyRoutes.ts already established --
 * `actorDeviceId` is derived EXCLUSIVELY from a verified DeviceSessionService
 * bearer token, never a client-supplied field, and is used here as the
 * `parentDeviceId` key the ledger was written under (see
 * FamilyAuditEventProducer/MySqlOwnerParentDeviceResolver -- an envelope is
 * only ever queued for a family's real, resolved parent device, so a
 * caller's own verified device identity is the correct, and only, key to
 * read its own queue by).
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
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';
import type { FamilyAuditEventLedger } from '../../familyrbac/FamilyAuditEventLedger.js';

export interface FamilyAuditEventRoutesDeps {
  parentAccountService: ParentAccountService;
  deviceSessionService: DeviceSessionService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- when omitted, this file registers nothing (mirrors registerFamilyMemberRoutes' own optional-feature convention). */
  familyAuditEventLedger?: FamilyAuditEventLedger;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
}

function toEnvelopeDto(envelope: { envelopeId: string; keyEpoch: number; generatedAtUtc: Date; encryptedPayloadB64: string; nonceB64: string }): Record<string, unknown> {
  return {
    envelopeId: envelope.envelopeId,
    keyEpoch: envelope.keyEpoch,
    generatedAtUtc: envelope.generatedAtUtc.toISOString(),
    encryptedPayloadB64: envelope.encryptedPayloadB64,
    nonceB64: envelope.nonceB64,
  };
}

export function registerFamilyAuditEventRoutes(app: FastifyInstance, deps: FamilyAuditEventRoutesDeps): void {
  if (!deps.familyAuditEventLedger) return;
  const { parentAccountService, deviceSessionService, familyAuditEventLedger } = deps;

  app.get('/api/parent/families/:familyId/audit-events', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    let familyIdFromSession: string;
    try {
      const session = await parentAccountService.readSession(token);
      if (!session.familyId) return reply.code(403).send({ error: 'family_scope_required' });
      familyIdFromSession = session.familyId;
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }

    const { familyId } = request.params as { familyId?: string };
    if (!familyId || familyId !== familyIdFromSession) {
      return reply.code(403).send({ error: 'family_scope_forbidden' });
    }

    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') || authorizationHeader.length > 4096) {
      return reply.code(401).send({ error: 'actor_device_session_required' });
    }
    let actorDeviceId: string;
    try {
      const identity = await deviceSessionService.requireActorDeviceInFamily(authorizationHeader.slice('Bearer '.length), familyId);
      actorDeviceId = identity.deviceId;
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'actor_device_session_invalid' });
      throw error;
    }

    const envelopes = await familyAuditEventLedger.listForParentDevice(familyId, actorDeviceId);
    return reply.code(200).send({ envelopes: envelopes.map(toEnvelopeDto) });
  });
}
