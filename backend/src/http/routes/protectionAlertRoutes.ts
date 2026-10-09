/**
 * PCA product-completion programme: active family Administrators and
 * Viewers can read opaque protection-alert envelopes queued for their
 * authenticated Parent browser device. The Parent session establishes family
 * and role scope; a verified device-session bearer narrows the queue to that
 * browser device. Encrypted payloads stay opaque at this route.
 *
 * This route returns the SAME fields ProtectionAlertEvent already exposes
 * as non-content routing metadata (alertId/deviceId/trigger/keyEpoch/
 * generatedAtUtc -- `trigger` is a closed event-category vocabulary, not a
 * readable family-data description, see alerts/types.ts's own doc comment)
 * plus the fully opaque encryptedPayloadB64/nonceB64 pair -- never any
 * decrypted alert CONTENT. Decryption of that opaque payload (if any ever
 * exists beyond the routing metadata) happens exclusively in parent-web, on
 * a trusted browser, exactly like ProtectionAlertPanel.tsx's existing
 * PENDING_TRUSTED_DECRYPTION pattern.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import type { ProtectionAlertLedger } from '../../alerts/ProtectionAlertLedger.js';
import type { ProtectionAlertEvent } from '../../alerts/types.js';
import { RuntimeSyncAuthError, type DeviceSessionService } from '../../runtime-sync/DeviceSessionService.js';

export interface ProtectionAlertRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional for older non-production composition sites; when absent, the registered route fails closed with 503. */
  deviceSessionService?: DeviceSessionService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- when omitted, this file registers nothing (mirrors registerFamilyAuditEventRoutes' own optional-feature convention). */
  protectionAlertLedger?: ProtectionAlertLedger;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
}

function toAlertDto(event: ProtectionAlertEvent): Record<string, unknown> {
  return {
    alertId: event.alertId,
    deviceId: event.deviceId,
    trigger: event.trigger,
    keyEpoch: event.keyEpoch,
    generatedAtUtc: event.generatedAtUtc.toISOString(),
    encryptedPayloadB64: event.encryptedPayloadB64,
    nonceB64: event.nonceB64,
  };
}

export function registerProtectionAlertRoutes(app: FastifyInstance, deps: ProtectionAlertRoutesDeps): void {
  if (!deps.protectionAlertLedger) return;
  const { parentAccountService, deviceSessionService, protectionAlertLedger } = deps;

  app.get('/api/parent/families/:familyId/protection-alerts', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const role = await parentAccountService.activeFamilyRole(accountId! as never, familyId);
    if (role !== 'ADMINISTRATOR' && role !== 'VIEWER') return reply.code(403).send({ error: 'forbidden' });
    if (!deviceSessionService) return reply.code(503).send({ error: 'not_configured' });

    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ') ||
        authorizationHeader.length <= 'Bearer '.length || authorizationHeader.length > 4096 || /[\r\n]/.test(authorizationHeader)) {
      return reply.code(401).send({ error: 'actor_device_session_required' });
    }
    let actorDeviceId: string;
    try {
      const identity = await deviceSessionService.requireActorDeviceInFamily(
        authorizationHeader.slice('Bearer '.length),
        familyId,
      );
      if (!identity.deviceId || identity.familyId !== familyId) {
        return reply.code(401).send({ error: 'actor_device_session_invalid' });
      }
      actorDeviceId = identity.deviceId;
    } catch (error) {
      if (error instanceof RuntimeSyncAuthError) return reply.code(401).send({ error: 'actor_device_session_invalid' });
      throw error;
    }

    const alerts = await protectionAlertLedger.listForParentDevice(familyId, actorDeviceId);
    return reply.code(200).send({ alerts: alerts.map(toAlertDto) });
  });
}
