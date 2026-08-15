/**
 * PCA-BILL-3 (Writer62, Round6) -- Settlement / Reconciliation core domain
 * service (SETTLEMENT_RECONCILIATION_V1). No RBAC/step-up here (that is
 * PlatformAdminSettlementService's job, mirroring
 * ComplimentaryEntitlementService / PlatformAdminComplimentaryGrantService's
 * split) -- this class is the plain domain authority: exact bigint
 * arithmetic, the reconciliation state machine, the double-attribution
 * guard, and FX-snapshot immutability.
 *
 * NO TOLERANCE CONCEPT: `computeStatus` compares differenceMinor to 0n
 * exactly -- no configured/currency-aware tolerance band exists in this
 * lane (no approved tolerance semantics were found in the current
 * architecture). This is a documented gap for future configurability, not
 * an invented default (ROUND6 assignment's explicit instruction).
 */
import { randomUUID } from 'node:crypto';
import { runInTransaction } from '../../db/pool.js';
import { subtractMoney } from '../money.js';
import type { Money } from '../money.js';
import type { PaymentRepository, PaymentTransactionRow } from '../payment.js';
import { insertPlatformAdminAuditEventRow } from '../../platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import type { PlatformAdminId, PlatformAdminRole } from '../../platformadmin/auth/types.js';
import type { SettlementRepository } from './SettlementRepository.js';
import {
  SettlementError,
} from './types.js';
import type {
  CreateSettlementAccountInput,
  OpenSettlementBatchInput,
  ReconciliationStatus,
  SettlementAccountHealthRow,
  SettlementAccountRecord,
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementDashboardSummary,
  SettlementUsdRollup,
} from './types.js';

/** Actor identity threaded through every mutation for audit attribution -- mirrors ComplimentaryEntitlementService's grantedByAdminId/insertPlatformAdminAuditEventRow pattern exactly. */
export interface SettlementActor {
  readonly adminId: PlatformAdminId;
  readonly role: PlatformAdminRole;
}

export interface AttributeTransactionRequest {
  readonly settlementBatchId: string;
  readonly paymentTransactionId: string;
  /** Required IFF the transaction's currency differs from the batch's settlement currency; forbidden otherwise. */
  readonly fx: {
    readonly recordedRate: string;
    readonly effectiveTimestamp: Date;
    readonly providerRef: string;
  } | null;
}

function computeStatus(differenceMinor: bigint): ReconciliationStatus {
  return differenceMinor === 0n ? 'MATCHED' : 'UNDER_INVESTIGATION';
}

const RATE_DECIMAL_PATTERN = /^\d{1,13}(\.\d{1,10})?$/;

export class SettlementService {
  constructor(
    private readonly repository: SettlementRepository,
    private readonly paymentRepository: PaymentRepository,
    // Injectable transaction runner -- defaults to the real MySQL
    // runInTransaction, but overridable by unit tests with an in-memory
    // fake (mirrors ComplimentaryEntitlementService's `runTx` constructor
    // parameter exactly), so this domain's arithmetic/state-machine logic
    // is testable without a live database.
    private readonly runTx: <T>(fn: (conn: import('mysql2/promise').PoolConnection) => Promise<T>) => Promise<T> = runInTransaction,
  ) {}

  async createAccount(input: CreateSettlementAccountInput, actor: SettlementActor, now: Date = new Date()): Promise<SettlementAccountRecord> {
    if (input.providerRef.length === 0 || input.providerRef.length > 128) throw new SettlementError('INVALID_INPUT', 'providerRef must be 1-128 characters.');
    if (input.displayLabel.length === 0 || input.displayLabel.length > 64) throw new SettlementError('INVALID_INPUT', 'displayLabel must be 1-64 characters.');
    return this.runTx(async (conn) => {
      const created = await this.repository.createAccount(conn, input, randomUUID(), now);
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTLEMENT_ACCOUNT_CREATED',
        actorAdminId: actor.adminId,
        actorRole: actor.role,
        targetRef: `settlement-account:${created.settlementAccountId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        // Non-secret operational metadata only -- never providerRef/displayLabel (avoid persisting even a masked banking reference into free-text audit metadata beyond what's already the row's own opaque id).
        metadata: { settlementCurrency: input.settlementCurrency },
      });
      return created;
    });
  }

  async listAccounts(): Promise<SettlementAccountRecord[]> {
    return this.runTx((conn) => this.repository.listAccounts(conn));
  }

  async getAccount(settlementAccountId: string): Promise<SettlementAccountRecord> {
    const account = await this.runTx((conn) => this.repository.getAccountById(conn, settlementAccountId));
    if (!account) throw new SettlementError('NOT_FOUND', `SettlementAccount ${settlementAccountId} not found.`);
    return account;
  }

  async setAccountStatus(settlementAccountId: string, status: 'ACTIVE' | 'INACTIVE', actor: SettlementActor, now: Date = new Date()): Promise<SettlementAccountRecord> {
    return this.runTx(async (conn) => {
      const existing = await this.repository.lockAccountById(conn, settlementAccountId);
      if (!existing) throw new SettlementError('NOT_FOUND', `SettlementAccount ${settlementAccountId} not found.`);
      const updated = await this.repository.setAccountStatus(conn, settlementAccountId, status, now);
      if (!updated) throw new SettlementError('NOT_FOUND');
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTLEMENT_ACCOUNT_CHANGED',
        actorAdminId: actor.adminId,
        actorRole: actor.role,
        targetRef: `settlement-account:${settlementAccountId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { fromStatus: existing.status, toStatus: status },
      });
      return updated;
    });
  }

  /**
   * Opens (creates) a settlement batch header. `net = expectedGross - fees`
   * and `differenceMinor = received - net` are computed here, in exact
   * bigint arithmetic, exactly once, at open time -- never recomputed via
   * float, and never mutated afterward (only `resolveReconciliation`
   * transitions status, never these amount fields).
   */
  async openBatch(input: OpenSettlementBatchInput, actor: SettlementActor, now: Date = new Date()): Promise<SettlementBatchRecord> {
    if (input.periodEnd.getTime() <= input.periodStart.getTime()) throw new SettlementError('INVALID_INPUT', 'periodEnd must be after periodStart.');
    if (input.expectedGross.currencyCode !== input.settlementCurrency || input.fees.currencyCode !== input.settlementCurrency || input.received.currencyCode !== input.settlementCurrency) {
      throw new SettlementError('CURRENCY_MISMATCH', 'expectedGross/fees/received must all be denominated in the batch settlement currency.');
    }
    if (input.providerRef.length === 0 || input.providerRef.length > 128) throw new SettlementError('INVALID_INPUT', 'providerRef must be 1-128 characters.');

    return this.runTx(async (conn) => {
      const account = await this.repository.getAccountById(conn, input.settlementAccountRef);
      if (!account) throw new SettlementError('NOT_FOUND', `SettlementAccount ${input.settlementAccountRef} not found.`);
      if (account.status !== 'ACTIVE') throw new SettlementError('ACCOUNT_INACTIVE');
      if (account.settlementCurrency !== input.settlementCurrency) throw new SettlementError('CURRENCY_MISMATCH', 'Batch currency must match the settlement account currency.');

      let net: Money;
      try {
        net = subtractMoney(input.expectedGross, input.fees);
      } catch {
        throw new SettlementError('INVALID_INPUT', 'fees must not exceed expectedGross.');
      }
      const differenceMinor = input.received.amountMinor - net.amountMinor;
      const status = computeStatus(differenceMinor);

      const batch = await this.repository.openBatch(conn, input, randomUUID(), input.received.amountMinor, net.amountMinor, differenceMinor, status, now);
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTLEMENT_BATCH_CREATED',
        actorAdminId: actor.adminId,
        actorRole: actor.role,
        targetRef: `settlement-batch:${batch.settlementBatchId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { settlementAccountRef: input.settlementAccountRef, status, differenceMinor: differenceMinor.toString(10) },
      });
      return batch;
    });
  }

  async getBatch(settlementBatchId: string): Promise<SettlementBatchRecord> {
    const batch = await this.runTx((conn) => this.repository.getBatchById(conn, settlementBatchId));
    if (!batch) throw new SettlementError('NOT_FOUND', `SettlementBatch ${settlementBatchId} not found.`);
    return batch;
  }

  async listBatchesForAccount(settlementAccountRef: string): Promise<SettlementBatchRecord[]> {
    return this.runTx((conn) => this.repository.listBatchesForAccount(conn, settlementAccountRef));
  }

  async listAllBatches(): Promise<SettlementBatchRecord[]> {
    return this.runTx((conn) => this.repository.listAllBatches(conn));
  }

  async listItemsForBatch(settlementBatchId: string): Promise<SettlementBatchItemRecord[]> {
    return this.runTx((conn) => this.repository.listItemsForBatch(conn, settlementBatchId));
  }

  /**
   * Attributes an existing, unmodified PaymentTransactionRow
   * (billing/payment.ts) to a batch. Never mutates the transaction row --
   * only reads it (paymentRepository.findTransactionById) to snapshot its
   * amount/currency onto the new settlement_batch_items row.
   *
   * DOUBLE-ATTRIBUTION RACE: this method does NOT pre-check
   * isTransactionAlreadyAttributed and branch on it -- that check-then-act
   * pattern would itself be racy under concurrent callers. The actual
   * guarantee comes from repository.tryAttributeTransaction relying on the
   * DB's UNIQUE KEY (migration 0015); under N concurrent attempts to
   * attribute the SAME transaction (to the same or different batches),
   * exactly one INSERT commits and every other caller observes
   * applied=false here and gets ALREADY_ATTRIBUTED.
   */
  async attributeTransaction(request: AttributeTransactionRequest, actor: SettlementActor, now: Date = new Date()): Promise<SettlementBatchItemRecord> {
    return this.runTx(async (conn) => {
      const batch = await this.repository.getBatchById(conn, request.settlementBatchId);
      if (!batch) throw new SettlementError('NOT_FOUND', `SettlementBatch ${request.settlementBatchId} not found.`);

      const transaction: PaymentTransactionRow | null = await this.paymentRepository.findTransactionById(conn, request.paymentTransactionId);
      if (!transaction) throw new SettlementError('NOT_FOUND', `PaymentTransaction ${request.paymentTransactionId} not found.`);

      const crossCurrency = transaction.price.currencyCode !== batch.settlementCurrency;
      if (crossCurrency && !request.fx) throw new SettlementError('FX_SNAPSHOT_REQUIRED', 'An FX snapshot is required when the transaction currency differs from the batch settlement currency.');
      if (!crossCurrency && request.fx) throw new SettlementError('FX_SNAPSHOT_NOT_ALLOWED', 'An FX snapshot may only be recorded for a cross-currency attribution.');
      if (request.fx && !RATE_DECIMAL_PATTERN.test(request.fx.recordedRate)) throw new SettlementError('INVALID_INPUT', 'recordedRate must be an exact decimal string.');

      const itemId = randomUUID();
      const fxSnapshotId = request.fx ? randomUUID() : null;
      const result = await this.repository.tryAttributeTransaction(
        conn,
        {
          settlementBatchId: request.settlementBatchId,
          paymentTransactionId: request.paymentTransactionId,
          amount: transaction.price,
          fxSnapshot: request.fx
            ? { settlementCurrency: batch.settlementCurrency, recordedRate: request.fx.recordedRate, effectiveTimestamp: request.fx.effectiveTimestamp, providerRef: request.fx.providerRef }
            : null,
        },
        itemId,
        fxSnapshotId,
        now,
      );
      if (!result.applied || !result.item) throw new SettlementError('ALREADY_ATTRIBUTED', `PaymentTransaction ${request.paymentTransactionId} is already attributed to a settlement batch.`);
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTLEMENT_BATCH_ITEM_ATTRIBUTED',
        actorAdminId: actor.adminId,
        actorRole: actor.role,
        targetRef: `settlement-batch:${request.settlementBatchId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { paymentTransactionId: request.paymentTransactionId, crossCurrency },
      });
      return result.item;
    });
  }

  /**
   * UNDER_INVESTIGATION -> RESOLVED, requiring reason/actor/timestamp
   * (enforced by the caller passing them, and by migration 0015's
   * `settlement_batches_resolution_pair_check`). A batch already MATCHED
   * has nothing to resolve; a batch already RESOLVED (including by a
   * concurrent racer that won) reports NOT_UNDER_INVESTIGATION rather than
   * silently succeeding twice -- exactly one concurrent resolution attempt
   * ever wins, matching repository.tryResolveBatch's single conditional
   * UPDATE guard.
   */
  async resolveReconciliation(settlementBatchId: string, reason: string, actor: SettlementActor, now: Date = new Date()): Promise<SettlementBatchRecord> {
    if (reason.length === 0 || reason.length > 500) throw new SettlementError('INVALID_INPUT', 'resolutionReason must be 1-500 characters.');
    return this.runTx(async (conn) => {
      const existing = await this.repository.lockBatchById(conn, settlementBatchId);
      if (!existing) throw new SettlementError('NOT_FOUND', `SettlementBatch ${settlementBatchId} not found.`);
      if (existing.status !== 'UNDER_INVESTIGATION') throw new SettlementError('NOT_UNDER_INVESTIGATION');
      const result = await this.repository.tryResolveBatch(conn, settlementBatchId, reason, actor.adminId, now);
      if (!result.applied || !result.record) throw new SettlementError('NOT_UNDER_INVESTIGATION');
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTLEMENT_RECONCILIATION_RESOLVED',
        actorAdminId: actor.adminId,
        actorRole: actor.role,
        targetRef: `settlement-batch:${settlementBatchId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { reason, differenceMinor: result.record.differenceMinor.toString(10) },
      });
      return result.record;
    });
  }

  async dashboardSummary(): Promise<SettlementDashboardSummary> {
    return this.runTx((conn) => this.repository.dashboardSummary(conn));
  }

  /** PCA-ADD-PA-041 (Writer65): see SettlementAccountHealthRow's doc comment. */
  async accountHealthSummary(): Promise<SettlementAccountHealthRow[]> {
    return this.runTx((conn) => this.repository.accountHealthSummary(conn));
  }

  /**
   * PCA-ADD-BILL-020 (Writer65): records a one-time, immutable USD-
   * normalization rate for a non-USD batch. Rejects a USD batch outright
   * (it needs no rate, rate=1 is implicit) and rejects re-recording once a
   * rate already exists (ALREADY_ATTRIBUTED reused for "already has an
   * immutable value" -- same semantic this codebase already gives that
   * code for settlement_batch_items' one-time attribution).
   */
  async recordUsdNormalization(settlementBatchId: string, rate: string, actor: SettlementActor, now: Date = new Date()): Promise<SettlementBatchRecord> {
    if (!RATE_DECIMAL_PATTERN.test(rate)) throw new SettlementError('INVALID_INPUT', 'rate must be an exact decimal string.');
    return this.runTx(async (conn) => {
      const batch = await this.repository.lockBatchById(conn, settlementBatchId);
      if (!batch) throw new SettlementError('NOT_FOUND', `SettlementBatch ${settlementBatchId} not found.`);
      if (batch.settlementCurrency === 'USD') throw new SettlementError('INVALID_INPUT', 'A USD batch needs no USD-normalization rate.');
      const result = await this.repository.tryRecordUsdNormalization(conn, settlementBatchId, rate, actor.adminId, now);
      if (!result.applied || !result.record) throw new SettlementError('ALREADY_ATTRIBUTED', 'This batch already has a recorded USD-normalization rate.');
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTLEMENT_ACCOUNT_CHANGED',
        actorAdminId: actor.adminId,
        actorRole: actor.role,
        targetRef: `settlement-batch:${settlementBatchId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { usdNormalizedRate: rate },
      });
      return result.record;
    });
  }

  /** PCA-ADD-BILL-020 (Writer65): see SettlementUsdRollup's doc comment. */
  async usdRollup(): Promise<SettlementUsdRollup> {
    return this.runTx((conn) => this.repository.usdRollup(conn));
  }
}

export type { PaymentRepository };
