/**
 * PCA-ADD-PA-043/044 (Writer65): the remaining Platform Administration
 * settings categories -- branding/support metadata, payment-provider
 * configuration-by-reference, notification settings, maintenance-mode
 * control, and Platform Administration/Billing feature flags -- built on
 * the generic `platform_admin_settings` table (migration 0016).
 *
 * PCA-ADD-PA-044 write-only/masked enforcement: `PAYMENT_PROVIDER` is the
 * one sensitive category here (settlement account configuration already
 * has its own masked surface, PlatformAdminSettlementService). Every read
 * of a `PAYMENT_PROVIDER` setting returns `MaskedSettingView` -- NO
 * `value`/`valueJson` field exists on that type at all (structurally, not
 * merely omitted at serialization time, mirroring
 * PlatformAdminSettlementService's `SettlementAccountView` precedent
 * exactly) -- only `maskedDisplay`/`updatedAt`/`updatedByAdminId`. The
 * write API still accepts the real value (an opaque provider reference,
 * never a raw secret, per PCA-ADD-BILL-025) and persists it -- it is
 * simply never read back in plaintext by this service again.
 *
 * RBAC (rbacPolicy.ts, both already-reserved operations, no new operation
 * added by this lane): `ADMINISTER_SENSITIVE_PLATFORM_SETTINGS`
 * (APP_OWNER-only) gates PAYMENT_PROVIDER mutation; every other category's
 * mutation reuses `ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS`
 * (APP_OWNER/PLATFORM_ADMIN), exactly like the existing market-mapping
 * mutation in settingsRoutes.ts. Every read reuses
 * `VIEW_SUPPORT_ACCOUNT_METADATA` (ALLOW for every role), matching this
 * file's sibling categories.
 */
import { randomUUID } from 'node:crypto';
import { authorizePlatformAdminOperation } from '../auth/rbacPolicy.js';
import type { PlatformAdminId, PlatformAdminRole } from '../auth/types.js';
import type { PlatformAdminSettingCategory, PlatformAdminSettingsRepository } from './PlatformAdminSettingsRepository.js';
import { insertPlatformAdminAuditEventRow } from '../audit/MySqlPlatformAdminAuditRepository.js';
import { runInTransaction } from '../../db/pool.js';

export interface PlatformAdminSettingsActor {
  readonly adminId: PlatformAdminId;
  readonly roles: PlatformAdminRole[];
}

export type PlatformAdminSettingsErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT';

export class PlatformAdminSettingsError extends Error {
  readonly code: PlatformAdminSettingsErrorCode;
  constructor(code: PlatformAdminSettingsErrorCode, message?: string) {
    super(message ?? `Platform Administration settings operation denied: ${code}`);
    this.name = 'PlatformAdminSettingsError';
    this.code = code;
  }
}

/** Full, non-masked view -- returned only for non-sensitive categories. */
export interface PlainSettingView {
  readonly settingKey: string;
  readonly category: PlatformAdminSettingCategory;
  readonly value: unknown;
  readonly updatedAt: Date;
  readonly updatedByAdminId: string;
}

/** Masked view -- NO value field at all. Returned for PAYMENT_PROVIDER (and any other category later marked sensitive). */
export interface MaskedSettingView {
  readonly settingKey: string;
  readonly category: PlatformAdminSettingCategory;
  readonly maskedDisplay: string;
  readonly updatedAt: Date;
  readonly updatedByAdminId: string;
}

const SENSITIVE_CATEGORIES: ReadonlySet<PlatformAdminSettingCategory> = new Set(['PAYMENT_PROVIDER']);

const KEY_PATTERN = /^[a-z][a-z0-9_.]{0,126}[a-z0-9]$/;
const MAX_VALUE_JSON_BYTES = 4096;
const MASKED_DISPLAY_MAX_LENGTH = 128;

function isSensitiveCategory(category: PlatformAdminSettingCategory): boolean {
  return SENSITIVE_CATEGORIES.has(category);
}

function validateKey(settingKey: string): void {
  if (!KEY_PATTERN.test(settingKey)) throw new PlatformAdminSettingsError('INVALID_INPUT', 'setting key must be lowercase dotted/underscored, 2-128 characters.');
}

function serializeValue(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new PlatformAdminSettingsError('INVALID_INPUT', 'value must be JSON-serializable.');
  }
  if (json === undefined || Buffer.byteLength(json, 'utf8') > MAX_VALUE_JSON_BYTES) {
    throw new PlatformAdminSettingsError('INVALID_INPUT', `value must serialize to at most ${MAX_VALUE_JSON_BYTES} bytes.`);
  }
  return json;
}

export class PlatformAdminSettingsService {
  constructor(
    private readonly repository: PlatformAdminSettingsRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly runTx: <T>(fn: (conn: import('mysql2/promise').PoolConnection) => Promise<T>) => Promise<T> = runInTransaction,
  ) {}

  private requireRead(actor: PlatformAdminSettingsActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') throw new PlatformAdminSettingsError('FORBIDDEN');
  }

  private requireMutate(actor: PlatformAdminSettingsActor, category: PlatformAdminSettingCategory): void {
    const operation = isSensitiveCategory(category) ? 'ADMINISTER_SENSITIVE_PLATFORM_SETTINGS' : 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS';
    if (authorizePlatformAdminOperation(actor.roles, operation) !== 'ALLOW') throw new PlatformAdminSettingsError('FORBIDDEN');
  }

  async get(actor: PlatformAdminSettingsActor, settingKey: string): Promise<PlainSettingView | MaskedSettingView | null> {
    this.requireRead(actor);
    const record = await this.runTx((conn) => this.repository.getRaw(conn, settingKey));
    if (!record) return null;
    if (record.isSensitive) {
      return { settingKey: record.settingKey, category: record.category, maskedDisplay: record.maskedDisplay ?? '(configured)', updatedAt: record.updatedAt, updatedByAdminId: record.updatedByAdminId };
    }
    return { settingKey: record.settingKey, category: record.category, value: JSON.parse(record.valueJson) as unknown, updatedAt: record.updatedAt, updatedByAdminId: record.updatedByAdminId };
  }

  async listByCategory(actor: PlatformAdminSettingsActor, category: PlatformAdminSettingCategory): Promise<Array<PlainSettingView | MaskedSettingView>> {
    this.requireRead(actor);
    const records = await this.runTx((conn) => this.repository.listByCategory(conn, category));
    return records.map((record) =>
      record.isSensitive
        ? { settingKey: record.settingKey, category: record.category, maskedDisplay: record.maskedDisplay ?? '(configured)', updatedAt: record.updatedAt, updatedByAdminId: record.updatedByAdminId }
        : { settingKey: record.settingKey, category: record.category, value: JSON.parse(record.valueJson) as unknown, updatedAt: record.updatedAt, updatedByAdminId: record.updatedByAdminId },
    );
  }

  /**
   * `maskedDisplay` is REQUIRED for a sensitive category (PA-044: an admin
   * must supply the masked label at write time -- this service never
   * derives one from the raw value) and FORBIDDEN otherwise (a non-
   * sensitive category has nothing to mask).
   */
  async put(actor: PlatformAdminSettingsActor, settingKey: string, category: PlatformAdminSettingCategory, value: unknown, maskedDisplay: string | null): Promise<PlainSettingView | MaskedSettingView> {
    validateKey(settingKey);
    this.requireMutate(actor, category);
    const sensitive = isSensitiveCategory(category);
    if (sensitive) {
      if (typeof maskedDisplay !== 'string' || maskedDisplay.length === 0 || maskedDisplay.length > MASKED_DISPLAY_MAX_LENGTH) {
        throw new PlatformAdminSettingsError('INVALID_INPUT', 'maskedDisplay is required for a sensitive category.');
      }
    } else if (maskedDisplay !== null) {
      throw new PlatformAdminSettingsError('INVALID_INPUT', 'maskedDisplay is only accepted for a sensitive category.');
    }
    const valueJson = serializeValue(value);
    const now = this.now();

    return this.runTx(async (conn) => {
      // PRIVILEGE-ESCALATION GUARD. requireMutate() above authorizes against
      // the category in the REQUEST BODY, while upsert's ON DUPLICATE KEY
      // UPDATE rewrites category and is_sensitive from those same request
      // values. Without the check below, an admin holding only
      // ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS could PUT an existing
      // PAYMENT_PROVIDER key with category:'BRANDING' and (a) pass the weaker
      // gate, (b) overwrite provider configuration that is APP_OWNER-only,
      // and (c) permanently flip is_sensitive to 0 so every later read
      // returns the value UNMASKED. An existing key's category is therefore
      // immutable, and touching a stored sensitive key always requires the
      // sensitive gate regardless of what the body claims. Read inside this
      // transaction so the decision cannot race a concurrent write.
      const existing = await this.repository.getRaw(conn, settingKey);
      if (existing) {
        this.requireMutate(actor, existing.category);
        if (existing.category !== category) {
          throw new PlatformAdminSettingsError('INVALID_INPUT', "an existing setting's category cannot be changed.");
        }
      }
      const record = await this.repository.upsert(conn, settingKey, category, valueJson, sensitive, maskedDisplay, actor.adminId);
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTING_CHANGED',
        actorAdminId: actor.adminId,
        actorRole: actor.roles[0] ?? null,
        targetRef: `platform-admin-setting:${settingKey}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        // Never the raw value for a sensitive category -- only the fact a change occurred and its masked label.
        metadata: sensitive ? { category, maskedDisplay } : { category },
      });
      return sensitive
        ? { settingKey: record.settingKey, category: record.category, maskedDisplay: record.maskedDisplay ?? '(configured)', updatedAt: record.updatedAt, updatedByAdminId: record.updatedByAdminId }
        : { settingKey: record.settingKey, category: record.category, value: JSON.parse(record.valueJson) as unknown, updatedAt: record.updatedAt, updatedByAdminId: record.updatedByAdminId };
    });
  }
}
