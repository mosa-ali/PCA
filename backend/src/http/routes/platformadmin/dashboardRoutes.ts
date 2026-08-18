/**
 * PCA-PA-3B -- GET /platform-admin/dashboard (mission Section 7).
 * Metadata-only KPI aggregates, VIEW_PLATFORM_DASHBOARD (ALLOW for every
 * role per Section 3.7). Settlement/reconciliation fields remain separately
 * gated by VIEW_SETTLEMENT_RECORDS: SUPPORT_ADMIN and PLATFORM_ADMIN receive
 * the support-safe dashboard subset, while AUDITOR_READ_ONLY retains its
 * explicit read-only settlement visibility.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { DashboardReadModel } from '../../../platformadmin/readmodels/DashboardReadModel.js';
import { moneyToJson } from '../../../billing/money.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminDashboardRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

export function registerPlatformAdminDashboardRoutes(app: FastifyInstance, deps: PlatformAdminDashboardRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-dashboard' });
  const readModel = new DashboardReadModel();

  app.get(
    '/platform-admin/dashboard',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'VIEW_PLATFORM_DASHBOARD') !== 'ALLOW') {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const snapshot = await readModel.build();
      const canViewSettlement = authorizePlatformAdminOperation(roles, 'VIEW_SETTLEMENT_RECORDS') === 'ALLOW';
      const { settlementSummary: _settlementSummary, serviceHealth: _serviceHealth, ...dashboardSubset } = snapshot;
      // settlementSummary carries real Money/bigint domain values (see
      // SettlementDashboardSummary) -- JSON.stringify cannot serialize a
      // bigint, so this is the one field that needs an explicit wire
      // mapping (moneyToJson, billing/money.ts's existing convention)
      // before the response leaves this route. Every other field is
      // already plain number/string/null, unchanged.
      return reply.code(200).send({
        ...(canViewSettlement
          ? {
              ...dashboardSubset,
              settlementSummary: {
                capability: snapshot.settlementSummary.capability,
                summary: snapshot.settlementSummary.summary
                  ? {
                      matchedBatchCount: snapshot.settlementSummary.summary.matchedBatchCount,
                      underInvestigationBatchCount: snapshot.settlementSummary.summary.underInvestigationBatchCount,
                      resolvedBatchCount: snapshot.settlementSummary.summary.resolvedBatchCount,
                      byCurrency: snapshot.settlementSummary.summary.byCurrency.map((row) => ({
                        currencyCode: row.currencyCode,
                        totalNet: moneyToJson(row.totalNet),
                        totalReceived: moneyToJson(row.totalReceived),
                        totalDifferenceMinor: row.totalDifferenceMinor,
                      })),
                    }
                  : null,
              },
              serviceHealth: snapshot.serviceHealth,
            }
          : dashboardSubset),
      });
    },
  );
}
