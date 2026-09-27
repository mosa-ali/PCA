/**
 * PCA product-completion programme: active family Administrators and
 * Viewers can read the family's opaque protection-alert envelopes through
 * their Parent session. Encrypted payloads stay opaque at this route.
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

export interface ProtectionAlertRoutesDeps {
  parentAccountService: ParentAccountService;
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
  const { parentAccountService, protectionAlertLedger } = deps;

  app.get('/api/parent/families/:familyId/protection-alerts', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const alerts = await protectionAlertLedger.listForFamily(familyId);
    return reply.code(200).send({ alerts: alerts.map(toAlertDto) });
  });
}
