/**
 * PCA-PA-3B -- Price Book administration HTTP surface (mission Section 12).
 * Thin adapter over `billing/priceBook.ts`'s `PriceBookService` -- no new
 * pricing logic, no hardcoded price, no FX. RBAC/versioning/audit are all
 * already enforced inside that service (`MUTATE_PRICE_BOOK` ==
 * APP_OWNER/FINANCE_ADMIN only per `PCA-ADD-BILL-044`; `VIEW_PRICE_BOOK`
 * additionally allows PLATFORM_ADMIN/AUDITOR_READ_ONLY read visibility).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { BillingAuthorizationError } from '../../../billing/rbac.js';
import type { PriceBookService, PriceBookRow } from '../../../billing/priceBook.js';
import { PriceBookPublicationConflictError } from '../../../billing/priceBook.js';
import { isCommercialMarket } from '../../../billing/market.js';
import { isSupportedCurrency } from '../../../billing/currency.js';
import { dateToJson, moneyOrNullToJson } from '../../../platformadmin/api/dto.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminPriceBookRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  priceBookService: PriceBookService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 2 * 1024;
const DECIMAL_INTEGER_STRING = /^\d+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function priceBookToDto(row: PriceBookRow) {
  return {
    priceBookId: row.priceBookId,
    commercialMarket: row.commercialMarket,
    currencyCode: row.currencyCode,
    targetDeviceLimit: row.targetDeviceLimit,
    price: moneyOrNullToJson(row.price),
    priceBookVersion: row.priceBookVersion,
    status: row.status,
    effectiveFrom: dateToJson(row.effectiveFrom),
    effectiveTo: dateToJson(row.effectiveTo),
    createdByAdminId: row.createdByAdminId,
    createdAt: dateToJson(row.createdAt),
  };
}

export function registerPlatformAdminPriceBookRoutes(app: FastifyInstance, deps: PlatformAdminPriceBookRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-pricebook-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-pricebook-mutate' });

  app.get(
    '/platform-admin/billing/price-book',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const { commercialMarket, currencyCode, targetDeviceLimit, asOf } = query;
      if (typeof commercialMarket !== 'string' || !isCommercialMarket(commercialMarket)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof currencyCode !== 'string' || !isSupportedCurrency(currencyCode)) return reply.code(400).send({ error: 'invalid_request' });
      const target = typeof targetDeviceLimit === 'string' ? Number.parseInt(targetDeviceLimit, 10) : Number.NaN;
      if (!Number.isInteger(target) || target < 1) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      try {
        if (typeof asOf === 'string' && asOf === 'active') {
          const row = await deps.priceBookService.getActiveAt(commercialMarket, currencyCode, target, new Date(), roles);
          return reply.code(200).send({ item: row ? priceBookToDto(row) : null });
        }
        const rows = await deps.priceBookService.getHistory(commercialMarket, currencyCode, target, roles);
        return reply.code(200).send({ items: rows.map(priceBookToDto) });
      } catch (error) {
        if (error instanceof BillingAuthorizationError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.post(
    '/platform-admin/billing/price-book',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { commercialMarket, currencyCode, targetDeviceLimit, amountMinor } = body;
      if (typeof commercialMarket !== 'string' || !isCommercialMarket(commercialMarket)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof currencyCode !== 'string' || !isSupportedCurrency(currencyCode)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof targetDeviceLimit !== 'number' || !Number.isInteger(targetDeviceLimit) || targetDeviceLimit < 1) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof amountMinor !== 'string' || !DECIMAL_INTEGER_STRING.test(amountMinor)) return reply.code(400).send({ error: 'invalid_request' });
      let amount: bigint;
      try {
        amount = BigInt(amountMinor);
      } catch {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const roles = request.platformAdminRoles ?? [];
      const adminId = request.platformAdminId as string;
      try {
        const published = await deps.priceBookService.publishPrice(
          { commercialMarket, currencyCode, targetDeviceLimit, amountMinor: amount },
          { adminId, role: roles[0] ?? null },
          roles,
        );
        return reply.code(201).send(priceBookToDto(published));
      } catch (error) {
        if (error instanceof BillingAuthorizationError) return reply.code(403).send({ error: 'forbidden' });
        if (error instanceof PriceBookPublicationConflictError) return reply.code(409).send({ error: 'conflict' });
        if (error instanceof Error && /must (not be|be a)/.test(error.message)) return reply.code(400).send({ error: 'invalid_request' });
        throw error;
      }
    },
  );
}
