/**
 * PCA product-completion programme: the authenticated PARENT-facing family
 * dashboard read, over parentpanel's DashboardAggregatorService (doc 18
 * Section 6). Follows the SAME plain parent-session-read convention
 * webRuleRoutes.ts's and eyeProtectionRoutes.ts's own GET routes already
 * establish (see either file's own header comment) -- this is NOT a
 * per-device queue read like familyAuditEventRoutes.ts/
 * protectionAlertRoutes.ts (no actor-device bearer token is required here),
 * because a dashboard card list is a family-scoped summary, not a
 * device-keyed opaque envelope queue.
 *
 * An active same-family Administrator or Viewer may read the FULL_FAMILY
 * dashboard summary. ParentAccountService resolves that role from active
 * Parent membership; child-only roles do not reach this Parent route.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { parseCookies, sessionCookieName } from '../../parentaccount/cookies.js';
import type { DashboardAggregatorService } from '../../parentpanel/DashboardAggregatorService.js';
import type { DashboardCard } from '../../parentpanel/types.js';

export interface DashboardRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- when omitted, this file registers nothing (mirrors registerFamilyAuditEventRoutes' own optional-feature convention). */
  dashboardAggregatorService?: Pick<DashboardAggregatorService, 'getDashboard'>;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(sessionCookieName()) ?? null;
}

function toCardDto(card: DashboardCard): Record<string, unknown> {
  return {
    kind: card.kind,
    capabilityState: card.capabilityState,
    lastAcknowledgedPolicyRevision: card.lastAcknowledgedPolicyRevision,
    pendingOrOfflineStatus: card.pendingOrOfflineStatus,
    summaryLabel: card.summaryLabel,
  };
}

export function registerDashboardRoutes(app: FastifyInstance, deps: DashboardRoutesDeps): void {
  if (!deps.dashboardAggregatorService) return;
  const { parentAccountService, dashboardAggregatorService } = deps;

  app.get('/api/parent/families/:familyId/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === null) return reply.code(401).send({ error: 'unauthorized' });
    let familyIdFromSession: string;
    let role: string | null;
    try {
      const session = await parentAccountService.readSession(token);
      if (!session.familyId) return reply.code(403).send({ error: 'family_scope_required' });
      familyIdFromSession = session.familyId;
      role = session.role;
    } catch (error) {
      if (error instanceof ParentAccountError) return reply.code(401).send({ error: 'unauthorized' });
      throw error;
    }

    const { familyId } = request.params as { familyId?: string };
    if (!familyId || familyId !== familyIdFromSession) {
      return reply.code(403).send({ error: 'family_scope_forbidden' });
    }
    if (role !== 'ADMINISTRATOR' && role !== 'VIEWER') return reply.code(403).send({ error: 'forbidden' });

    const cards = await dashboardAggregatorService.getDashboard(familyId, { kind: 'FULL_FAMILY' });
    return reply.code(200).send({ cards: cards.map(toCardDto) });
  });
}
