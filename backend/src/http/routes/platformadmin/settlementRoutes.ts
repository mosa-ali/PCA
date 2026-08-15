/**
 * PCA-BILL-3 (Writer62, Round6) -- Platform Administration HTTP surface for
 * Settlement / Reconciliation (SETTLEMENT_RECONCILIATION_V1). Composes
 * (never duplicates) `PlatformAdminSettlementService` for every RBAC/
 * step-up/business-rule decision -- this file is the HTTP adapter layer
 * only, mapping typed service errors to HTTP status codes exactly like
 * `complimentaryGrantRoutes.ts` already does for the sibling surface.
 *
 * Every GET response is built from `SettlementAccountView`/
 * `SettlementBatchView` DTOs that never carry a raw provider secret --
 * see PlatformAdminSettlementService's masked-view doc comment. This file
 * is NOT wired into buildServer.ts by this lane (mission: this lane owns
 * no edits to buildServer.ts/main.ts) -- see this lane's final report's
 * COORDINATOR_BINDING_REQUIRED wiring instructions.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAuthError } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminSettlementError } from '../../../platformadmin/settlement/PlatformAdminSettlementService.js';
import type { PlatformAdminSettlementService, SettlementAccountView, SettlementBatchView } from '../../../platformadmin/settlement/PlatformAdminSettlementService.js';
import { SettlementError } from '../../../billing/settlement/types.js';
import type { SettlementBatchItemRecord } from '../../../billing/settlement/types.js';
import { SUPPORTED_CURRENCIES } from '../../../billing/currency.js';
import type { CurrencyCode } from '../../../billing/currency.js';
import { moneyFromJson, moneyToJson } from '../../../billing/money.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface SettlementRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  platformAdminSettlementService: PlatformAdminSettlementService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 4 * 1024;
const ID_MAX_LENGTH = 64;
const PROVIDER_REF_MAX_LENGTH = 128;
const DISPLAY_LABEL_MAX_LENGTH = 64;
const REASON_MAX_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

function accountToDto(view: SettlementAccountView) {
  return {
    settlementAccountId: view.settlementAccountId,
    displayLabel: view.displayLabel,
    settlementCurrency: view.settlementCurrency,
    status: view.status,
    createdAt: dateToJson(view.createdAt),
    updatedAt: dateToJson(view.updatedAt),
  };
}

function batchToDto(view: SettlementBatchView) {
  return {
    settlementBatchId: view.settlementBatchId,
    settlementAccountRef: view.settlementAccountRef,
    settlementCurrency: view.settlementCurrency,
    periodStart: dateToJson(view.periodStart),
    periodEnd: dateToJson(view.periodEnd),
    expectedGross: moneyToJson(view.expectedGross),
    fees: moneyToJson(view.fees),
    net: moneyToJson(view.net),
    received: moneyToJson(view.received),
    differenceMinor: view.differenceMinor.toString(10),
    status: view.status,
    providerRef: view.providerRef,
    resolutionReason: view.resolutionReason,
    resolvedByAdminId: view.resolvedByAdminId,
    resolvedAt: dateToJson(view.resolvedAt),
    createdByAdminId: view.createdByAdminId,
    createdAt: dateToJson(view.createdAt),
    updatedAt: dateToJson(view.updatedAt),
  };
}

function itemToDto(item: SettlementBatchItemRecord) {
  return {
    settlementBatchItemId: item.settlementBatchItemId,
    settlementBatchId: item.settlementBatchId,
    paymentTransactionId: item.paymentTransactionId,
    amount: moneyToJson(item.amount),
    createdAt: dateToJson(item.createdAt),
  };
}

/** Every known error collapses to a status code without revealing WHICH check failed to an unauthorized/malformed caller -- same anti-oracle discipline complimentaryGrantRoutes.ts's mapKnownError documents. */
function mapKnownError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof PlatformAdminSettlementError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof PlatformAdminAuthError) {
    reply.code(403).send({ error: 'forbidden' });
    return true;
  }
  if (error instanceof SettlementError) {
    if (error.code === 'NOT_FOUND') {
      reply.code(404).send({ error: 'not_found' });
      return true;
    }
    if (error.code === 'ALREADY_ATTRIBUTED' || error.code === 'NOT_UNDER_INVESTIGATION') {
      reply.code(409).send({ error: error.code.toLowerCase() });
      return true;
    }
    reply.code(400).send({ error: 'invalid_request' });
    return true;
  }
  return false;
}

export function registerSettlementRoutes(app: FastifyInstance, deps: SettlementRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-settlement-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 30, bucket: 'platform-admin-settlement-mutate' });

  function actor(request: FastifyRequest) {
    return {
      adminId: request.platformAdminId as string,
      roles: request.platformAdminRoles ?? [],
      sessionId: request.platformAdminSessionId as string,
    };
  }

  function requireStepUpId(body: Record<string, unknown>, reply: FastifyReply): string | null {
    const { stepUpId } = body;
    if (typeof stepUpId !== 'string' || stepUpId.length === 0) {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return stepUpId;
  }

  // ---- Settlement Accounts ----

  app.get('/platform-admin/settlement/accounts', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const items = await deps.platformAdminSettlementService.listAccounts(actor(request));
      return reply.code(200).send({ items: items.map(accountToDto) });
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.get('/platform-admin/settlement/accounts/:accountId', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId?: string };
    if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const view = await deps.platformAdminSettlementService.getAccount(actor(request), accountId);
      return reply.code(200).send(accountToDto(view));
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.post('/platform-admin/settlement/accounts', { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
    const { providerRef, displayLabel, settlementCurrency } = body;
    if (typeof providerRef !== 'string' || providerRef.length === 0 || providerRef.length > PROVIDER_REF_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    if (typeof displayLabel !== 'string' || displayLabel.length === 0 || displayLabel.length > DISPLAY_LABEL_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    if (!isCurrencyCode(settlementCurrency)) return reply.code(400).send({ error: 'invalid_request' });
    const stepUpId = requireStepUpId(body, reply);
    if (stepUpId === null) return;
    try {
      const view = await deps.platformAdminSettlementService.createAccount(actor(request), { providerRef, displayLabel, settlementCurrency, stepUpId });
      return reply.code(201).send(accountToDto(view));
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.post(
    '/platform-admin/settlement/accounts/:accountId/status',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { accountId } = request.params as { accountId?: string };
      if (typeof accountId !== 'string' || accountId.length === 0 || accountId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { status } = body;
      if (status !== 'ACTIVE' && status !== 'INACTIVE') return reply.code(400).send({ error: 'invalid_request' });
      const stepUpId = requireStepUpId(body, reply);
      if (stepUpId === null) return;
      try {
        const view = await deps.platformAdminSettlementService.setAccountStatus(actor(request), accountId, { status, stepUpId });
        return reply.code(200).send(accountToDto(view));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Settlement Batches ----

  app.get('/platform-admin/settlement/batches', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.query as { accountId?: string };
    try {
      const items =
        typeof accountId === 'string' && accountId.length > 0
          ? await deps.platformAdminSettlementService.listBatchesForAccount(actor(request), accountId)
          : await deps.platformAdminSettlementService.listAllBatches(actor(request));
      return reply.code(200).send({ items: items.map(batchToDto) });
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.get('/platform-admin/settlement/batches/:batchId', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { batchId } = request.params as { batchId?: string };
    if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const view = await deps.platformAdminSettlementService.getBatch(actor(request), batchId);
      return reply.code(200).send(batchToDto(view));
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.get('/platform-admin/settlement/batches/:batchId/items', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { batchId } = request.params as { batchId?: string };
    if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const items = await deps.platformAdminSettlementService.listItemsForBatch(actor(request), batchId);
      return reply.code(200).send({ items: items.map(itemToDto) });
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.post('/platform-admin/settlement/batches', { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
    const { settlementAccountRef, settlementCurrency, periodStart, periodEnd, expectedGross, fees, received, providerRef } = body;
    if (typeof settlementAccountRef !== 'string' || settlementAccountRef.length === 0 || settlementAccountRef.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    if (!isCurrencyCode(settlementCurrency)) return reply.code(400).send({ error: 'invalid_request' });
    if (!isIsoDateString(periodStart) || !isIsoDateString(periodEnd)) return reply.code(400).send({ error: 'invalid_request' });
    if (typeof providerRef !== 'string' || providerRef.length === 0 || providerRef.length > PROVIDER_REF_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
    let expectedGrossMoney;
    let feesMoney;
    let receivedMoney;
    try {
      expectedGrossMoney = moneyFromJson(expectedGross as { amountMinor: string; currencyCode: CurrencyCode });
      feesMoney = moneyFromJson(fees as { amountMinor: string; currencyCode: CurrencyCode });
      receivedMoney = moneyFromJson(received as { amountMinor: string; currencyCode: CurrencyCode });
    } catch {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const stepUpId = requireStepUpId(body, reply);
    if (stepUpId === null) return;
    try {
      const view = await deps.platformAdminSettlementService.openBatch(actor(request), {
        settlementAccountRef,
        settlementCurrency,
        periodStart: new Date(periodStart as string),
        periodEnd: new Date(periodEnd as string),
        expectedGross: expectedGrossMoney,
        fees: feesMoney,
        received: receivedMoney,
        providerRef,
        stepUpId,
      });
      return reply.code(201).send(batchToDto(view));
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  app.post(
    '/platform-admin/settlement/batches/:batchId/items',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { batchId } = request.params as { batchId?: string };
      if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { paymentTransactionId, fx } = body;
      if (typeof paymentTransactionId !== 'string' || paymentTransactionId.length === 0 || paymentTransactionId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      let fxInput: { recordedRate: string; effectiveTimestamp: Date; providerRef: string } | null = null;
      if (fx !== null && fx !== undefined) {
        if (!isPlainObject(fx)) return reply.code(400).send({ error: 'invalid_request' });
        const { recordedRate, effectiveTimestamp, providerRef: fxProviderRef } = fx;
        if (typeof recordedRate !== 'string' || recordedRate.length === 0) return reply.code(400).send({ error: 'invalid_request' });
        if (!isIsoDateString(effectiveTimestamp)) return reply.code(400).send({ error: 'invalid_request' });
        if (typeof fxProviderRef !== 'string' || fxProviderRef.length === 0 || fxProviderRef.length > PROVIDER_REF_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
        fxInput = { recordedRate, effectiveTimestamp: new Date(effectiveTimestamp as string), providerRef: fxProviderRef };
      }
      const stepUpId = requireStepUpId(body, reply);
      if (stepUpId === null) return;
      try {
        const item = await deps.platformAdminSettlementService.attributeTransaction(actor(request), {
          settlementBatchId: batchId,
          paymentTransactionId,
          fx: fxInput,
          stepUpId,
        });
        return reply.code(201).send(itemToDto(item));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/settlement/batches/:batchId/resolve',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { batchId } = request.params as { batchId?: string };
      if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { reason } = body;
      if (typeof reason !== 'string' || reason.length === 0 || reason.length > REASON_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const stepUpId = requireStepUpId(body, reply);
      if (stepUpId === null) return;
      try {
        const view = await deps.platformAdminSettlementService.resolveReconciliation(actor(request), batchId, reason, stepUpId);
        return reply.code(200).send(batchToDto(view));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  // ---- Dashboard summary (COORDINATOR_BINDING_REQUIRED for DashboardReadModel.ts wiring; exposed standalone here so it is independently testable/usable) ----

  app.get('/platform-admin/settlement/dashboard-summary', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const summary = await deps.platformAdminSettlementService.dashboardSummary(actor(request));
      return reply.code(200).send({
        matchedBatchCount: summary.matchedBatchCount,
        underInvestigationBatchCount: summary.underInvestigationBatchCount,
        resolvedBatchCount: summary.resolvedBatchCount,
        byCurrency: summary.byCurrency.map((entry) => ({
          currencyCode: entry.currencyCode,
          totalNet: moneyToJson(entry.totalNet),
          totalReceived: moneyToJson(entry.totalReceived),
          totalDifferenceMinor: entry.totalDifferenceMinor,
        })),
      });
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  // ---- Account health summary (PCA-ADD-PA-041, Writer65) ----

  app.get('/platform-admin/settlement/account-health', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rows = await deps.platformAdminSettlementService.accountHealthSummary(actor(request));
      return reply.code(200).send({
        items: rows.map((row) => ({
          settlementAccountId: row.settlementAccountId,
          displayLabel: row.displayLabel,
          settlementCurrency: row.settlementCurrency,
          accountStatus: row.accountStatus,
          mostRecentBatch: row.mostRecentBatch
            ? { settlementBatchId: row.mostRecentBatch.settlementBatchId, status: row.mostRecentBatch.status, periodEnd: dateToJson(row.mostRecentBatch.periodEnd) }
            : null,
        })),
      });
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });

  // ---- USD-normalized cross-batch rollup (PCA-ADD-BILL-020, Writer65) ----

  app.post(
    '/platform-admin/settlement/batches/:batchId/usd-normalization',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { batchId } = request.params as { batchId?: string };
      if (typeof batchId !== 'string' || batchId.length === 0 || batchId.length > ID_MAX_LENGTH) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { rate } = body;
      if (typeof rate !== 'string' || rate.length === 0) return reply.code(400).send({ error: 'invalid_request' });
      const stepUpId = requireStepUpId(body, reply);
      if (stepUpId === null) return;
      try {
        const view = await deps.platformAdminSettlementService.recordUsdNormalization(actor(request), batchId, rate, stepUpId);
        return reply.code(200).send(batchToDto(view));
      } catch (error) {
        if (mapKnownError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get('/platform-admin/settlement/usd-rollup', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rollup = await deps.platformAdminSettlementService.usdRollup(actor(request));
      return reply.code(200).send({
        totalNetUsdMinor: rollup.totalNetUsdMinor,
        totalReceivedUsdMinor: rollup.totalReceivedUsdMinor,
        includedBatchCount: rollup.includedBatchCount,
        excludedForMissingRateBatchCount: rollup.excludedForMissingRateBatchCount,
      });
    } catch (error) {
      if (mapKnownError(error, reply)) return;
      throw error;
    }
  });
}
