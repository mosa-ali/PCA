/**
 * PCA-PA-3B -- GET /platform-admin/dashboard (mission Section 7).
 * Metadata-only KPI aggregates, VIEW_PLATFORM_DASHBOARD (ALLOW for every
 * role per Section 3.7). Billing-record summaries and settlement/reconciliation
 * fields remain separately gated: APP_OWNER/FINANCE_ADMIN/AUDITOR_READ_ONLY
 * receive the read-only financial subset, while PLATFORM_ADMIN/SUPPORT_ADMIN
 * receive only the non-financial operational/support subset.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { authorizeBillingOperation } from '../../../billing/rbac.js';
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
      const canViewBilling = authorizeBillingOperation(roles, 'VIEW_BILLING_RECORDS') === 'ALLOW';
      const canViewSettlement = authorizePlatformAdminOperation(roles, 'VIEW_SETTLEMENT_RECORDS') === 'ALLOW';
      // PCA-BILLING-READ-SPLIT-1 (security fix): `subscriptionsByStatus`,
      // `subscriptionsByPlanAndStatus` and `quotesByStatus` are aggregates
      // over `billing_subscriptions`/`billing_plans`/`billing_quotes` (see
      // DashboardReadModel's own SQL) -- billing records, not operational
      // metadata. They were previously left in the base object and so
      // reached PLATFORM_ADMIN and SUPPORT_ADMIN, for whom
      // VIEW_BILLING_RECORDS is DENY (billing/rbac.ts), contradicting this
      // route's own header ("PLATFORM_ADMIN/SUPPORT_ADMIN receive only the
      // non-financial operational/support subset"). They are now stripped
      // with the other restricted fields and re-added only on the
      // canViewBilling branch, exactly like the invoice/payment/refund
      // aggregates already were.
      const {
        settlementSummary: _settlementSummary,
        serviceHealth: _serviceHealth,
        invoicesByStatusAndCurrency: _invoicesByStatusAndCurrency,
        paymentAttemptsByStatusAndCurrency: _paymentAttemptsByStatusAndCurrency,
        refundsByCurrency: _refundsByCurrency,
        paymentSummaryByCurrency: _paymentSummaryByCurrency,
        openDisputes: _openDisputes,
        subscriptionsByStatus: _subscriptionsByStatus,
        subscriptionsByPlanAndStatus: _subscriptionsByPlanAndStatus,
        quotesByStatus: _quotesByStatus,
        ...dashboardWithoutRestrictedFields
      } = snapshot;
      const dashboardSubset = canViewBilling
        ? {
            ...dashboardWithoutRestrictedFields,
            invoicesByStatusAndCurrency: snapshot.invoicesByStatusAndCurrency,
            paymentAttemptsByStatusAndCurrency: snapshot.paymentAttemptsByStatusAndCurrency,
            refundsByCurrency: snapshot.refundsByCurrency,
            paymentSummaryByCurrency: snapshot.paymentSummaryByCurrency,
            openDisputes: snapshot.openDisputes,
            subscriptionsByStatus: snapshot.subscriptionsByStatus,
            subscriptionsByPlanAndStatus: snapshot.subscriptionsByPlanAndStatus,
            quotesByStatus: snapshot.quotesByStatus,
          }
        : (() => {
            const { stuckPaymentAttempts: _stuckPaymentAttempts, ...supportExceptionQueues } = snapshot.exceptionQueues;
            const { exceptionQueues: _exceptionQueues, ...nonFinancialDashboard } = dashboardWithoutRestrictedFields;
            return { ...nonFinancialDashboard, exceptionQueues: supportExceptionQueues };
          })();
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
          : (() => {
              const { exceptionQueues, ...withoutSettlement } = dashboardSubset;
              const { unresolvedReconciliations: _unresolvedReconciliations, ...nonSettlementExceptionQueues } = exceptionQueues;
              return { ...withoutSettlement, exceptionQueues: nonSettlementExceptionQueues };
            })()),
      });
    },
  );
}
