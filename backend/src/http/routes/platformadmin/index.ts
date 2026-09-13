/**
 * PCA-PA-3B -- single entry point for every Platform Administration
 * operational/commercial route this lane owns (mission Section 24).
 *
 * This module does NOT register itself with `buildServer.ts` -- this lane
 * is forbidden from editing `backend/src/main.ts` /
 * `backend/src/http/buildServer.ts` (mission Section 24). A coordinator
 * wires this in by calling `registerPlatformAdminOperationalRoutes(app, deps)`
 * once from `buildServer.ts`, after `registerPlatformAdminAuthRoutes` (this
 * lane's routes assume `platformAdminAuthService` is already constructed)
 * and passing through the additional dependencies listed in
 * `PlatformAdminOperationalRoutesDeps` below -- see this lane's final
 * report's SHARED_INTEGRATION_REQUIRED for the exact wiring description.
 */
import type { FastifyInstance } from 'fastify';
import { registerPlatformAdminDashboardRoutes } from './dashboardRoutes.js';
import { registerPlatformAdminAccountsRoutes } from './accountsRoutes.js';
import { registerPlatformAdminEntitlementRoutes } from './entitlementRoutes.js';
import { registerPlatformAdminPriceBookRoutes } from './priceBookRoutes.js';
import { registerPlatformAdminPlanRoutes } from './planRoutes.js';
import { registerPlatformAdminBillingReadRoutes } from './billingReadRoutes.js';
import { registerPlatformAdminBillingAdminRoutes } from './billingAdminRoutes.js';
import { registerPlatformAdminAdminUserRoutes } from './adminUserRoutes.js';
import { registerPlatformAdminAuditRoutes } from './auditRoutes.js';
import { registerPlatformAdminSettingsRoutes } from './settingsRoutes.js';
import { registerPlatformAdminReleaseRoutes } from './releaseRoutes.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import type { PlatformAdminAccountService } from '../../../platformadmin/auth/PlatformAdminAccountService.js';
import type { PlatformAdminEntitlementService } from '../../../platformadmin/entitlements/PlatformAdminEntitlementService.js';
import type { ChangeRequestRepository } from '../../../entitlements/requests/ChangeRequestRepository.js';
import type { EntitlementRepository } from '../../../entitlements/EntitlementRepository.js';
import type { PriceBookService } from '../../../billing/priceBook.js';
import type { PlanService } from '../../../billing/plan.js';
import type { ReleaseService } from '../../../release/ReleaseService.js';
import type { PaymentMethodService } from '../../../billing/paymentMethod.js';
import type { SubscriptionService } from '../../../billing/subscription.js';
import type { DisputeService } from '../../../billing/dispute.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminOperationalRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  platformAdminAccountService: PlatformAdminAccountService;
  platformAdminEntitlementService: PlatformAdminEntitlementService;
  changeRequestRepository: ChangeRequestRepository;
  entitlementRepository: EntitlementRepository;
  priceBookService: PriceBookService;
  planService: PlanService;
  /** Release management (app/model/rule package metadata) -- see releaseRoutes.ts's own doc comment. */
  releaseService: ReleaseService;
  /** Billing admin write surface (add payment method, create/cancel subscription, open/resolve dispute) -- see billingAdminRoutes.ts's own doc comment. */
  paymentMethodService: PaymentMethodService;
  subscriptionService: SubscriptionService;
  disputeService: DisputeService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

export function registerPlatformAdminOperationalRoutes(app: FastifyInstance, deps: PlatformAdminOperationalRoutesDeps): void {
  registerPlatformAdminDashboardRoutes(app, { platformAdminAuthService: deps.platformAdminAuthService, rateLimiter: deps.rateLimiter });
  registerPlatformAdminAccountsRoutes(app, { platformAdminAuthService: deps.platformAdminAuthService, rateLimiter: deps.rateLimiter });
  registerPlatformAdminEntitlementRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    platformAdminEntitlementService: deps.platformAdminEntitlementService,
    changeRequestRepository: deps.changeRequestRepository,
    rateLimiter: deps.rateLimiter,
  });
  registerPlatformAdminPriceBookRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    priceBookService: deps.priceBookService,
    rateLimiter: deps.rateLimiter,
  });
  registerPlatformAdminPlanRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    planService: deps.planService,
    rateLimiter: deps.rateLimiter,
  });
  registerPlatformAdminBillingReadRoutes(app, { platformAdminAuthService: deps.platformAdminAuthService, rateLimiter: deps.rateLimiter });
  registerPlatformAdminBillingAdminRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    paymentMethodService: deps.paymentMethodService,
    subscriptionService: deps.subscriptionService,
    disputeService: deps.disputeService,
    rateLimiter: deps.rateLimiter,
  });
  registerPlatformAdminAdminUserRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    platformAdminAccountService: deps.platformAdminAccountService,
    rateLimiter: deps.rateLimiter,
  });
  registerPlatformAdminAuditRoutes(app, { platformAdminAuthService: deps.platformAdminAuthService, rateLimiter: deps.rateLimiter });
  registerPlatformAdminSettingsRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    platformAdminEntitlementService: deps.platformAdminEntitlementService,
    entitlementRepository: deps.entitlementRepository,
    rateLimiter: deps.rateLimiter,
  });
  registerPlatformAdminReleaseRoutes(app, {
    platformAdminAuthService: deps.platformAdminAuthService,
    releaseService: deps.releaseService,
    rateLimiter: deps.rateLimiter,
  });
}
