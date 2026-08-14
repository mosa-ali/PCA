/**
 * PCA Billing Core -- PriceBook (`PCA-ADD-BILL-002`/043/044).
 *
 * Publication (`publishPrice`) is transactional: it supersedes (RETIREs) any
 * currently-open ACTIVE row for the same commercial key
 * (commercialMarket, currencyCode, targetDeviceLimit) and inserts the new
 * one inside the SAME transaction. The DB-level invariant that makes
 * ambiguity structurally impossible -- not merely
 * application-conventionally avoided -- is
 * migrations/0007_billing_core.sql's `billing_price_books_open_active_key`
 * UNIQUE KEY (see that migration's own comment): two connections racing to
 * publish for the same key can never both land an open ACTIVE row. See
 * backend/test/db/billingCorePriceBookConcurrency.mysql.test.mjs for the
 * concurrency test (constraint 8).
 *
 * NO PRICE LITERAL IS EVER HARDCODED IN THIS FILE -- every amountMinor a
 * PriceBook row carries is supplied by the caller (an App
 * Owner/Finance-Admin-driven service/HTTP boundary, out of this lane's UI
 * scope), never a seeded/illustrative constant.
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt } from './money.js';
import type { Money } from './money.js';
import type { CurrencyCode } from './currency.js';
import { getCurrencyMetadata } from './currency.js';
import type { CommercialMarket } from './market.js';
import { isCommercialMarket } from './market.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';
import type { PlatformAdminAuditService } from '../platformadmin/audit/PlatformAdminAuditService.js';
import { buildBillingAuditEvent } from './audit.js';
import type { BillingAuditActor } from './audit.js';

export type PriceBookStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface PriceBookRow {
  readonly priceBookId: string;
  readonly commercialMarket: CommercialMarket;
  readonly currencyCode: CurrencyCode;
  readonly targetDeviceLimit: number;
  readonly price: Money;
  readonly priceBookVersion: number;
  readonly status: PriceBookStatus;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly createdByAdminId: string;
  readonly createdAt: Date;
}

export interface PublishPriceInput {
  readonly commercialMarket: CommercialMarket;
  readonly currencyCode: CurrencyCode;
  readonly targetDeviceLimit: number;
  readonly amountMinor: bigint;
}

interface PriceBookSqlRow {
  price_book_id: string;
  commercial_market: string;
  currency_code: string;
  target_device_limit: number;
  amount_minor: number | string;
  price_book_version: number;
  status: string;
  effective_from: Date;
  effective_to: Date | null;
  created_by_admin_id: string;
  created_at: Date;
}

function toDomain(row: PriceBookSqlRow): PriceBookRow {
  return {
    priceBookId: row.price_book_id,
    commercialMarket: row.commercial_market as CommercialMarket,
    currencyCode: row.currency_code as CurrencyCode,
    targetDeviceLimit: row.target_device_limit,
    price: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    priceBookVersion: row.price_book_version,
    status: row.status as PriceBookStatus,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdByAdminId: row.created_by_admin_id,
    createdAt: row.created_at,
  };
}

export class PriceBookRepository {
  /** Runs entirely within the given transaction connection: supersede-then-insert, see this file's header. */
  async publishWithinTransaction(conn: PoolConnection, input: PublishPriceInput, createdByAdminId: string, now: Date): Promise<PriceBookRow> {
    await execute(
      conn,
      `UPDATE billing_price_books
         SET status = 'RETIRED', effective_to = ?
       WHERE commercial_market = ? AND currency_code = ? AND target_device_limit = ?
         AND status = 'ACTIVE' AND effective_to IS NULL`,
      [now, input.commercialMarket, input.currencyCode, input.targetDeviceLimit],
    );

    const { rows: versionRows } = await execute<{ nextVersion: number }>(
      conn,
      `SELECT COALESCE(MAX(price_book_version), 0) + 1 AS nextVersion FROM billing_price_books
       WHERE commercial_market = ? AND currency_code = ? AND target_device_limit = ?`,
      [input.commercialMarket, input.currencyCode, input.targetDeviceLimit],
    );
    const nextVersion = versionRows[0].nextVersion;
    const priceBookId = randomUUID();

    await execute(
      conn,
      `INSERT INTO billing_price_books
         (price_book_id, commercial_market, currency_code, target_device_limit, amount_minor, price_book_version, status, effective_from, effective_to, created_by_admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)`,
      [
        priceBookId,
        input.commercialMarket,
        input.currencyCode,
        input.targetDeviceLimit,
        bigIntToSqlParam(input.amountMinor),
        nextVersion,
        now,
        createdByAdminId,
        now,
      ],
    );

    const { rows } = await execute<PriceBookSqlRow>(conn, `SELECT * FROM billing_price_books WHERE price_book_id = ?`, [priceBookId]);
    return toDomain(rows[0]);
  }

  /** The row that is authoritative at `asOf` for this commercial key, or null if none exists (constraint 9's REQUIRES_CUSTOM_QUOTE trigger condition). */
  async findActiveAt(
    conn: PoolConnection,
    commercialMarket: CommercialMarket,
    currencyCode: CurrencyCode,
    targetDeviceLimit: number,
    asOf: Date,
  ): Promise<PriceBookRow | null> {
    const { rows } = await execute<PriceBookSqlRow>(
      conn,
      `SELECT * FROM billing_price_books
       WHERE commercial_market = ? AND currency_code = ? AND target_device_limit = ?
         AND status = 'ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY price_book_version DESC LIMIT 1`,
      [commercialMarket, currencyCode, targetDeviceLimit, asOf, asOf],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findById(conn: PoolConnection, priceBookId: string): Promise<PriceBookRow | null> {
    const { rows } = await execute<PriceBookSqlRow>(conn, `SELECT * FROM billing_price_books WHERE price_book_id = ?`, [priceBookId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listHistory(conn: PoolConnection, commercialMarket: CommercialMarket, currencyCode: CurrencyCode, targetDeviceLimit: number): Promise<PriceBookRow[]> {
    const { rows } = await execute<PriceBookSqlRow>(
      conn,
      `SELECT * FROM billing_price_books
       WHERE commercial_market = ? AND currency_code = ? AND target_device_limit = ?
       ORDER BY price_book_version ASC`,
      [commercialMarket, currencyCode, targetDeviceLimit],
    );
    return rows.map(toDomain);
  }
}

export class PriceBookPublicationConflictError extends Error {
  constructor() {
    super('Price book publication conflict: another publication for this commercial key landed concurrently.');
    this.name = 'PriceBookPublicationConflictError';
  }
}

/**
 * Service layer: RBAC-gates mutation to APP_OWNER/FINANCE_ADMIN
 * (`PCA-ADD-BILL-044`), read to VIEW_PRICE_BOOK (APP_OWNER, PLATFORM_ADMIN,
 * FINANCE_ADMIN, AUDITOR_READ_ONLY -- see rbac.ts), and emits
 * PRICE_BOOK_CHANGED on every successful publish.
 */
export class PriceBookService {
  constructor(
    private readonly repository: PriceBookRepository,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async publishPrice(
    input: PublishPriceInput,
    actor: BillingAuditActor,
    roles: readonly PlatformAdminRole[],
    now: Date = new Date(),
  ): Promise<PriceBookRow> {
    requireBillingOperation(roles, 'MUTATE_PRICE_BOOK');
    if (!isCommercialMarket(input.commercialMarket)) throw new Error(`Invalid commercial market: ${input.commercialMarket}`);
    getCurrencyMetadata(input.currencyCode);
    if (!Number.isInteger(input.targetDeviceLimit) || input.targetDeviceLimit < 1) {
      throw new Error('targetDeviceLimit must be a positive integer.');
    }
    if (input.amountMinor < 0n) throw new Error('amountMinor must not be negative.');

    try {
      const published = await runInTransaction((conn) => this.repository.publishWithinTransaction(conn, input, actor.adminId, now));
      await this.auditService.record(
        buildBillingAuditEvent({
          eventType: 'PRICE_BOOK_CHANGED',
          actor,
          targetRef: `price_book:${published.priceBookId}`,
          occurredAt: now,
          metadata: {
            commercialMarket: input.commercialMarket,
            currencyCode: input.currencyCode,
            targetDeviceLimit: input.targetDeviceLimit,
            priceBookVersion: published.priceBookVersion,
          },
        }),
      );
      return published;
    } catch (error) {
      if (isDuplicateEntry(error)) throw new PriceBookPublicationConflictError();
      throw error;
    }
  }

  async getHistory(
    commercialMarket: CommercialMarket,
    currencyCode: CurrencyCode,
    targetDeviceLimit: number,
    roles: readonly PlatformAdminRole[],
  ): Promise<PriceBookRow[]> {
    requireBillingOperation(roles, 'VIEW_PRICE_BOOK');
    return runInTransaction((conn) => this.repository.listHistory(conn, commercialMarket, currencyCode, targetDeviceLimit));
  }

  async getActiveAt(
    commercialMarket: CommercialMarket,
    currencyCode: CurrencyCode,
    targetDeviceLimit: number,
    asOf: Date,
    roles: readonly PlatformAdminRole[],
  ): Promise<PriceBookRow | null> {
    requireBillingOperation(roles, 'VIEW_PRICE_BOOK');
    return runInTransaction((conn) => this.repository.findActiveAt(conn, commercialMarket, currencyCode, targetDeviceLimit, asOf));
  }
}
