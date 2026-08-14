/**
 * PCA Billing Core -- standard quote resolution and custom Quote
 * (`PCA-ADD-BILL-005A`/043, `PCA-ADD-PA-050`).
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { bigIntToSqlParam, money, sqlAmountMinorToBigInt } from './money.js';
import type { Money } from './money.js';
import type { CurrencyCode } from './currency.js';
import type { CommercialMarket } from './market.js';
import { PriceBookRepository } from './priceBook.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';
import type { PlatformAdminAuditService } from '../platformadmin/audit/PlatformAdminAuditService.js';
import { buildBillingAuditEvent } from './audit.js';
import type { BillingAuditActor } from './audit.js';

/** A stable, immutable price snapshot -- the shape resolveStandardQuote/issueCustomQuote both return, and the shape a PaymentAttempt copies verbatim (PCA-ADD-BILL-043). */
export interface PriceSnapshot {
  readonly targetDeviceLimit: number;
  readonly price: Money;
  readonly priceBookId: string | null;
  readonly priceBookVersion: number | null;
  readonly quoteId: string | null;
  readonly quotedAt: Date;
  readonly expiresAt: Date | null;
}

export type StandardQuoteResolution = { readonly kind: 'RESOLVED'; readonly snapshot: PriceSnapshot } | { readonly kind: 'REQUIRES_CUSTOM_QUOTE' };

export type QuoteStatus = 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'SUPERSEDED';

export interface QuoteRow {
  readonly quoteId: string;
  readonly increaseRequestRef: string | null;
  readonly commercialMarket: CommercialMarket;
  readonly targetDeviceLimit: number;
  readonly price: Money;
  readonly issuedByAdminId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly status: QuoteStatus;
}

export interface IssueCustomQuoteInput {
  readonly increaseRequestRef: string | null;
  readonly commercialMarket: CommercialMarket;
  readonly targetDeviceLimit: number;
  readonly amountMinor: bigint;
  readonly currencyCode: CurrencyCode;
  readonly expiresAt: Date;
}

interface QuoteSqlRow {
  quote_id: string;
  increase_request_ref: string | null;
  commercial_market: string;
  target_device_limit: number;
  amount_minor: number | string;
  currency_code: string;
  issued_by_admin_id: string;
  issued_at: Date;
  expires_at: Date;
  status: string;
}

function toDomain(row: QuoteSqlRow): QuoteRow {
  return {
    quoteId: row.quote_id,
    increaseRequestRef: row.increase_request_ref,
    commercialMarket: row.commercial_market as CommercialMarket,
    targetDeviceLimit: row.target_device_limit,
    price: money(sqlAmountMinorToBigInt(row.amount_minor), row.currency_code as CurrencyCode),
    issuedByAdminId: row.issued_by_admin_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    status: row.status as QuoteStatus,
  };
}

/** Default validity window for an App-Owner-issued custom quote (constraint 11: expired quotes must not remain payable). Callers may pass an explicit expiresAt instead. */
export const DEFAULT_QUOTE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

export class QuoteRepository {
  async insert(conn: PoolConnection, quoteId: string, input: IssueCustomQuoteInput, issuedByAdminId: string, issuedAt: Date): Promise<QuoteRow> {
    await execute(
      conn,
      `INSERT INTO billing_quotes
         (quote_id, increase_request_ref, commercial_market, target_device_limit, amount_minor, currency_code, issued_by_admin_id, issued_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        quoteId,
        input.increaseRequestRef,
        input.commercialMarket,
        input.targetDeviceLimit,
        bigIntToSqlParam(input.amountMinor),
        input.currencyCode,
        issuedByAdminId,
        issuedAt,
        input.expiresAt,
      ],
    );
    const row = await this.findById(conn, quoteId);
    if (!row) throw new Error('Quote insert did not persist.');
    return row;
  }

  async findById(conn: PoolConnection, quoteId: string): Promise<QuoteRow | null> {
    const { rows } = await execute<QuoteSqlRow>(conn, `SELECT * FROM billing_quotes WHERE quote_id = ?`, [quoteId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** Marks the quote CONSUMED -- only from ACTIVE, and only if unexpired at `now`. Returns false (no-op) otherwise, so a caller can distinguish "already consumed/expired" from success. */
  async tryConsume(conn: PoolConnection, quoteId: string, now: Date): Promise<boolean> {
    const { rowCount } = await execute(
      conn,
      `UPDATE billing_quotes SET status = 'CONSUMED' WHERE quote_id = ? AND status = 'ACTIVE' AND expires_at > ?`,
      [quoteId, now],
    );
    return rowCount > 0;
  }

  /** Sweeps ACTIVE-but-past-expiry quotes to EXPIRED. Called lazily by the service before a read/consume decision -- see QuoteService. */
  async expireDueQuotes(conn: PoolConnection, now: Date): Promise<number> {
    const { rowCount } = await execute(conn, `UPDATE billing_quotes SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at <= ?`, [now]);
    return rowCount;
  }
}

export class QuoteExpiredError extends Error {
  constructor() {
    super('Quote has expired and is no longer payable.');
    this.name = 'QuoteExpiredError';
  }
}

export class QuoteService {
  constructor(
    private readonly priceBookRepository: PriceBookRepository,
    private readonly quoteRepository: QuoteRepository,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  /**
   * `PCA-ADD-PA-050`'s standard path: a PriceBook lookup for
   * (commercialMarket, currencyCode, targetDeviceLimit) active at `asOf`. If
   * none exists, returns REQUIRES_CUSTOM_QUOTE -- Billing Core never invents
   * fallback pricing (constraint 9).
   */
  async resolveStandardQuote(
    commercialMarket: CommercialMarket,
    currencyCode: CurrencyCode,
    targetDeviceLimit: number,
    asOf: Date,
  ): Promise<StandardQuoteResolution> {
    const active = await runInTransaction((conn) => this.priceBookRepository.findActiveAt(conn, commercialMarket, currencyCode, targetDeviceLimit, asOf));
    if (!active) return { kind: 'REQUIRES_CUSTOM_QUOTE' };
    return {
      kind: 'RESOLVED',
      snapshot: {
        targetDeviceLimit,
        price: active.price,
        priceBookId: active.priceBookId,
        priceBookVersion: active.priceBookVersion,
        quoteId: null,
        quotedAt: asOf,
        expiresAt: null,
      },
    };
  }

  /** `PCA-ADD-PA-050`'s custom path -- restricted to APP_OWNER/FINANCE_ADMIN (constraint 10: never a family/parent-facing token). */
  async issueCustomQuote(
    input: IssueCustomQuoteInput,
    actor: BillingAuditActor,
    roles: readonly PlatformAdminRole[],
    now: Date = new Date(),
  ): Promise<QuoteRow> {
    requireBillingOperation(roles, 'ISSUE_QUOTE');
    if (input.expiresAt <= now) throw new Error('expiresAt must be in the future.');
    if (input.amountMinor < 0n) throw new Error('amountMinor must not be negative.');

    const quoteId = randomUUID();
    const quote = await runInTransaction((conn) => this.quoteRepository.insert(conn, quoteId, input, actor.adminId, now));
    await this.auditService.record(
      buildBillingAuditEvent({
        eventType: 'QUOTE_ISSUED',
        actor,
        targetRef: `quote:${quote.quoteId}`,
        occurredAt: now,
        metadata: {
          increaseRequestRef: input.increaseRequestRef,
          targetDeviceLimit: input.targetDeviceLimit,
          currencyCode: input.currencyCode,
        },
      }),
    );
    return quote;
  }

  /** Reads a quote, sweeping expiry first so a stale ACTIVE row is never returned as payable (constraint 11). */
  async getQuoteSnapshot(quoteId: string, now: Date = new Date()): Promise<PriceSnapshot> {
    return runInTransaction(async (conn) => {
      await this.quoteRepository.expireDueQuotes(conn, now);
      const quote = await this.quoteRepository.findById(conn, quoteId);
      if (!quote) throw new Error(`Quote not found: ${quoteId}`);
      if (quote.status === 'EXPIRED' || quote.expiresAt <= now) throw new QuoteExpiredError();
      return {
        targetDeviceLimit: quote.targetDeviceLimit,
        price: quote.price,
        priceBookId: null,
        priceBookVersion: null,
        quoteId: quote.quoteId,
        quotedAt: quote.issuedAt,
        expiresAt: quote.expiresAt,
      };
    });
  }

  /** Marks a quote CONSUMED within the SAME transaction a PaymentAttempt is created against it (constraint 12's immutability guarantee starts here) -- throws QuoteExpiredError if it cannot be consumed (already consumed, superseded, or expired). */
  async consumeWithinTransaction(conn: PoolConnection, quoteId: string, now: Date): Promise<void> {
    await this.quoteRepository.expireDueQuotes(conn, now);
    const consumed = await this.quoteRepository.tryConsume(conn, quoteId, now);
    if (!consumed) throw new QuoteExpiredError();
  }
}
