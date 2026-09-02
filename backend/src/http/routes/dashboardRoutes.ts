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
 * A PARENT session always requests a FULL_FAMILY DashboardViewScope: this
 * route is the PARENT surface (not a CHILD's own transparency view, doc
 * 18's OWN_CHILD_ONLY scope, a distinct authentication surface this task
 * does not build), and familyrbac's real trust-set role resolver is not
 * wired anywhere in this codebase yet (main.ts's own
 * UnavailableTrustSetRoleResolver), so there is no source of a genuine
 * Owner/Administrator-vs-Viewer distinction to pick FULL_FAMILY vs.
 * READ_ONLY_FAMILY with. FULL_FAMILY is the correct default for a
 * plain-session READ (unlike a role-gated WRITE, over-scoping a read-only
 * card list is not a privilege escalation -- DashboardAggregatorService
 * itself still only ever returns UNAVAILABLE cards for a kind with no
 * registered provider, never fabricated content).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ParentAccountError, type ParentAccountService } from '../../parentaccount/ParentAccountService.js';
import { SESSION_COOKIE_NAME, parseCookies } from '../../parentaccount/cookies.js';
import type { DashboardAggregatorService } from '../../parentpanel/DashboardAggregatorService.js';
import type { DashboardCard } from '../../parentpanel/types.js';

export interface DashboardRoutesDeps {
  parentAccountService: ParentAccountService;
  /** Optional purely so existing buildServer() test callers that don't exercise this route need no change -- when omitted, this file registers nothing (mirrors registerFamilyAuditEventRoutes' own optional-feature convention). */
  dashboardAggregatorService?: Pick<DashboardAggregatorService, 'getDashboard'>;
}

function readSessionCookie(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
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

    const cards = await dashboardAggregatorService.getDashboard(familyId, { kind: 'FULL_FAMILY' });
    return reply.code(200).send({ cards: cards.map(toCardDto) });
  });
}
