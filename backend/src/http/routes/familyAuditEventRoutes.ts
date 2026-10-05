/**
 * PCA product-completion programme, Writer P0-D (/security/audit): the
 * authenticated HTTP surface for authorized Parent family members to read
 * the family's opaque audit-event envelopes. Active family Administrator
 * and Viewer roles come from the Parent session; encrypted content remains
 * opaque until handled by the client-side decryption boundary.
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
import { parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import type { FamilyAuditEventLedger } from '../../familyrbac/FamilyAuditEventLedger.js';
import { isFamilyEpochNumber } from '../../familyepoch/bounds.js';

export interface FamilyAuditEventRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- when omitted, this file registers nothing (mirrors registerFamilyMemberRoutes' own optional-feature convention). */
  familyAuditEventLedger?: FamilyAuditEventLedger;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
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

export function registerFamilyAuditEventRoutes(app: FastifyInstance, deps: FamilyAuditEventRoutesDeps): void {
  if (!deps.familyAuditEventLedger) return;
  const { parentAccountService, familyAuditEventLedger } = deps;

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
    const role = await parentAccountService.activeFamilyRole(accountId! as never, familyId);
    if (role !== 'ADMINISTRATOR' && role !== 'VIEWER') return reply.code(403).send({ error: 'forbidden' });

    const envelopes = await familyAuditEventLedger.listForFamily(familyId);
    return reply.code(200).send({ envelopes: envelopes.map(toEnvelopeDto) });
  });
}
