/**
 * PCA-PA-3B -- Platform Administration settings HTTP surface (mission
 * Section 18): FREE_STARTER default configuration, commercial-market
 * country-mapping rules, and currency status. Composes existing
 * PCA-PA-2/Billing Core pieces verbatim (`EntitlementRepository.getDefaults`,
 * `PlatformAdminEntitlementService.updateFreeStarterDefaults`,
 * `MySqlMarketMappingRepository`, `billing/currency.ts`'s
 * `listCurrencyMetadata`).
 *
 * PCA-ADD-PA-043/044 (Writer65) UPDATE: the remaining named settings
 * categories (branding/support metadata, payment-provider configuration-
 * by-reference, notification settings, maintenance-mode, feature flags)
 * are now served below via `PlatformAdminSettingsService`, composing the
 * new `platform_admin_settings` table (migration 0016). PAYMENT_PROVIDER
 * is the one sensitive category -- every read of it returns
 * `MaskedSettingView` only (no raw value field exists on that type at
 * all), satisfying PCA-ADD-PA-044's write-only/masked-read rule.
 *
 * Read gate: `VIEW_SUPPORT_ACCOUNT_METADATA` (ALLOW for every role).
 * Mutation gate: `ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS`
 * (APP_OWNER/PLATFORM_ADMIN only per Section 3.7) for the market-mapping
 * upsert and every non-sensitive settings category;
 * `ADMINISTER_SENSITIVE_PLATFORM_SETTINGS` (APP_OWNER only) for
 * PAYMENT_PROVIDER; the FREE_STARTER defaults mutation reuses
 * `PlatformAdminEntitlementService.updateFreeStarterDefaults`'s own
 * internal `ADMINISTER_ENTITLEMENT_QUANTITY` gate unchanged.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import { PlatformAdminEntitlementError } from '../../../platformadmin/entitlements/PlatformAdminEntitlementService.js';
import type { PlatformAdminEntitlementService } from '../../../platformadmin/entitlements/PlatformAdminEntitlementService.js';
import type { EntitlementRepository } from '../../../entitlements/EntitlementRepository.js';
import { listCurrencyMetadata } from '../../../billing/currency.js';
import { MySqlMarketMappingRepository, isCommercialMarket } from '../../../billing/market.js';
import { runInTransaction } from '../../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../../../platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { dateToJson } from '../../../platformadmin/api/dto.js';
import { MySqlPlatformAdminSettingsRepository } from '../../../platformadmin/settings/PlatformAdminSettingsRepository.js';
import type { PlatformAdminSettingCategory } from '../../../platformadmin/settings/PlatformAdminSettingsRepository.js';
import { PlatformAdminSettingsService, PlatformAdminSettingsError } from '../../../platformadmin/settings/PlatformAdminSettingsService.js';
import type { createRateLimiter } from '../../rateLimit.js';

export interface PlatformAdminSettingsRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  platformAdminEntitlementService: PlatformAdminEntitlementService;
  entitlementRepository: EntitlementRepository;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

const MAX_BODY_BYTES = 1024;
const SETTINGS_MAX_BODY_BYTES = 8 * 1024;
const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/;
const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,126}[a-z0-9]$/;
const SETTINGS_CATEGORIES: readonly PlatformAdminSettingCategory[] = ['BRANDING', 'PAYMENT_PROVIDER', 'NOTIFICATION', 'MAINTENANCE', 'FEATURE_FLAG'];

function isSettingCategory(value: unknown): value is PlatformAdminSettingCategory {
  return typeof value === 'string' && (SETTINGS_CATEGORIES as readonly string[]).includes(value);
}

function mapSettingsError(error: unknown, reply: FastifyReply): boolean {
  if (error instanceof PlatformAdminSettingsError) {
    if (error.code === 'FORBIDDEN') {
      reply.code(403).send({ error: 'forbidden' });
      return true;
    }
    if (error.code === 'NOT_FOUND') {
      reply.code(404).send({ error: 'not_found' });
      return true;
    }
    reply.code(400).send({ error: 'invalid_request' });
    return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function registerPlatformAdminSettingsRoutes(app: FastifyInstance, deps: PlatformAdminSettingsRoutesDeps): void {
  const requirePlatformAdminSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const readLimiter = deps.rateLimiter({ windowMs: 60_000, max: 120, bucket: 'platform-admin-settings-read' });
  const mutateLimiter = deps.rateLimiter({ windowMs: 60_000, max: 20, bucket: 'platform-admin-settings-mutate' });
  const marketMappingRepository = new MySqlMarketMappingRepository();
  const settingsService = new PlatformAdminSettingsService(new MySqlPlatformAdminSettingsRepository());

  function requireView(request: FastifyRequest, reply: FastifyReply): boolean {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  app.get('/platform-admin/settings/free-starter-defaults', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireView(request, reply)) return;
    const defaults = await deps.entitlementRepository.getDefaults('FREE_STARTER');
    if (!defaults) return reply.code(404).send({ error: 'not_found' });
    return reply.code(200).send({
      tier: defaults.tier,
      parentMemberLimit: defaults.parentMemberLimit,
      managedDeviceLimit: defaults.managedDeviceLimit,
      updatedAt: dateToJson(defaults.updatedAt),
      updatedByAdminId: defaults.updatedByAdminId,
    });
  });

  app.put(
    '/platform-admin/settings/free-starter-defaults',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request, reply) => {
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { parentMemberLimit, managedDeviceLimit } = body;
      if (typeof parentMemberLimit !== 'number' || !Number.isInteger(parentMemberLimit) || parentMemberLimit < 0) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof managedDeviceLimit !== 'number' || !Number.isInteger(managedDeviceLimit) || managedDeviceLimit < 0) return reply.code(400).send({ error: 'invalid_request' });
      const roles = request.platformAdminRoles ?? [];
      const sessionId = request.platformAdminSessionId as string;
      const adminId = request.platformAdminId as string;
      try {
        await deps.platformAdminEntitlementService.updateFreeStarterDefaults({ adminId, roles, sessionId }, parentMemberLimit, managedDeviceLimit);
        return reply.code(200).send({ tier: 'FREE_STARTER', parentMemberLimit, managedDeviceLimit });
      } catch (error) {
        if (error instanceof PlatformAdminEntitlementError) return reply.code(403).send({ error: 'forbidden' });
        throw error;
      }
    },
  );

  app.get('/platform-admin/settings/currencies', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireView(request, reply)) return;
    return reply.code(200).send({ items: listCurrencyMetadata() });
  });

  app.get('/platform-admin/settings/market-mapping', { preHandler: [readLimiter, requirePlatformAdminSession] }, async (request, reply) => {
    if (!requireView(request, reply)) return;
    const rules = await marketMappingRepository.listRules();
    return reply.code(200).send({ items: rules });
  });

  app.put(
    '/platform-admin/settings/market-mapping',
    { bodyLimit: MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request, reply) => {
      const roles = request.platformAdminRoles ?? [];
      if (authorizePlatformAdminOperation(roles, 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS') !== 'ALLOW') return reply.code(403).send({ error: 'forbidden' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { countryCode, commercialMarket } = body;
      if (typeof countryCode !== 'string' || !COUNTRY_CODE_PATTERN.test(countryCode)) return reply.code(400).send({ error: 'invalid_request' });
      if (typeof commercialMarket !== 'string' || !isCommercialMarket(commercialMarket)) return reply.code(400).send({ error: 'invalid_request' });

      const adminId = request.platformAdminId as string;
      await runInTransaction(async (conn) => {
        await marketMappingRepository.upsertRule(conn, countryCode, commercialMarket);
        await insertPlatformAdminAuditEventRow(conn, {
          eventId: randomUUID(),
          eventType: 'SETTING_CHANGED',
          actorAdminId: adminId,
          actorRole: roles[0] ?? null,
          targetRef: `market_mapping:${countryCode.toUpperCase()}`,
          result: 'SUCCESS',
          occurredAt: new Date(),
          correlationId: randomUUID(),
          metadata: { countryCode: countryCode.toUpperCase(), commercialMarket },
        });
      });
      return reply.code(200).send({ countryCode: countryCode.toUpperCase(), commercialMarket });
    },
  );

  // ---- PCA-ADD-PA-043/044 (Writer65): remaining settings categories ----

  function settingsActor(request: FastifyRequest) {
    return { adminId: request.platformAdminId as string, roles: request.platformAdminRoles ?? [] };
  }

  app.get(
    '/platform-admin/settings/category/:category',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { category } = request.params as { category?: string };
      if (!isSettingCategory(category)) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const items = await settingsService.listByCategory(settingsActor(request), category);
        return reply.code(200).send({
          items: items.map((item) =>
            'maskedDisplay' in item
              ? { settingKey: item.settingKey, category: item.category, maskedDisplay: item.maskedDisplay, updatedAt: dateToJson(item.updatedAt), updatedByAdminId: item.updatedByAdminId }
              : { settingKey: item.settingKey, category: item.category, value: item.value, updatedAt: dateToJson(item.updatedAt), updatedByAdminId: item.updatedByAdminId },
          ),
        });
      } catch (error) {
        if (mapSettingsError(error, reply)) return;
        throw error;
      }
    },
  );

  app.get(
    '/platform-admin/settings/key/:settingKey',
    { preHandler: [readLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { settingKey } = request.params as { settingKey?: string };
      if (typeof settingKey !== 'string' || !SETTING_KEY_PATTERN.test(settingKey)) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const item = await settingsService.get(settingsActor(request), settingKey);
        if (!item) return reply.code(404).send({ error: 'not_found' });
        return reply.code(200).send(
          'maskedDisplay' in item
            ? { settingKey: item.settingKey, category: item.category, maskedDisplay: item.maskedDisplay, updatedAt: dateToJson(item.updatedAt), updatedByAdminId: item.updatedByAdminId }
            : { settingKey: item.settingKey, category: item.category, value: item.value, updatedAt: dateToJson(item.updatedAt), updatedByAdminId: item.updatedByAdminId },
        );
      } catch (error) {
        if (mapSettingsError(error, reply)) return;
        throw error;
      }
    },
  );

  app.put(
    '/platform-admin/settings/key/:settingKey',
    { bodyLimit: SETTINGS_MAX_BODY_BYTES, preHandler: [mutateLimiter, requirePlatformAdminSession] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { settingKey } = request.params as { settingKey?: string };
      if (typeof settingKey !== 'string' || !SETTING_KEY_PATTERN.test(settingKey)) return reply.code(400).send({ error: 'invalid_request' });
      const body = request.body;
      if (!isPlainObject(body)) return reply.code(400).send({ error: 'invalid_request' });
      const { category, value, maskedDisplay } = body;
      if (!isSettingCategory(category)) return reply.code(400).send({ error: 'invalid_request' });
      if (maskedDisplay !== undefined && maskedDisplay !== null && typeof maskedDisplay !== 'string') return reply.code(400).send({ error: 'invalid_request' });
      try {
        const item = await settingsService.put(settingsActor(request), settingKey, category, value, (maskedDisplay as string | null | undefined) ?? null);
        return reply.code(200).send(
          'maskedDisplay' in item
            ? { settingKey: item.settingKey, category: item.category, maskedDisplay: item.maskedDisplay, updatedAt: dateToJson(item.updatedAt), updatedByAdminId: item.updatedByAdminId }
            : { settingKey: item.settingKey, category: item.category, value: item.value, updatedAt: dateToJson(item.updatedAt), updatedByAdminId: item.updatedByAdminId },
        );
      } catch (error) {
        if (mapSettingsError(error, reply)) return;
        throw error;
      }
    },
  );
}
