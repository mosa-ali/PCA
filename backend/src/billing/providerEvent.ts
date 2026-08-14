/**
 * PCA Billing Core -- ProviderEvent foundation (`PCA-ADD-BILL-011`/029).
 * Durable persistence only -- NO webhook signature verification is
 * implemented here (PCA-BILL-2's scope; providerContract.ts's
 * `verifyWebhook` has no implementation in this lane). The UNIQUE KEY on
 * (provider, provider_event_id) -- migrations/0007_billing_core.sql's
 * `billing_provider_events_provider_event_key` -- is the idempotency
 * primitive `PCA-ADD-BILL-031`/046 depend on: `recordIfNew` below is the
 * single insertion path, and exactly one of two concurrent calls for the
 * same (provider, providerEventId) succeeds
 * (backend/test/db/billingCoreProviderEventConcurrency.mysql.test.mjs).
 */

import { randomUUID } from 'node:crypto';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';

export type ProviderEventProcessingStatus = 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';

export interface ProviderEventRow {
  readonly providerEventRowId: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly receivedAt: Date;
  readonly processingStatus: ProviderEventProcessingStatus;
  readonly correlationRef: string | null;
}

export type RecordProviderEventOutcome = { readonly outcome: 'RECORDED'; readonly row: ProviderEventRow } | { readonly outcome: 'DUPLICATE' };

interface ProviderEventSqlRow {
  provider_event_row_id: string;
  provider: string;
  provider_event_id: string;
  received_at: Date;
  processing_status: string;
  correlation_ref: string | null;
}

function toDomain(row: ProviderEventSqlRow): ProviderEventRow {
  return {
    providerEventRowId: row.provider_event_row_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    receivedAt: row.received_at,
    processingStatus: row.processing_status as ProviderEventProcessingStatus,
    correlationRef: row.correlation_ref,
  };
}

export class ProviderEventRepository {
  /** The sole insertion path -- relies entirely on the DB-level UNIQUE(provider, provider_event_id) constraint for idempotency, never a pre-check-then-insert (TOCTOU) pattern. */
  async recordIfNew(provider: string, providerEventId: string, correlationRef: string | null, now: Date): Promise<RecordProviderEventOutcome> {
    const rowId = randomUUID();
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO billing_provider_events (provider_event_row_id, provider, provider_event_id, received_at, processing_status, correlation_ref)
           VALUES (?, ?, ?, ?, 'RECEIVED', ?)`,
          [rowId, provider, providerEventId, now, correlationRef],
        ),
      );
    } catch (error) {
      if (isDuplicateEntry(error)) return { outcome: 'DUPLICATE' };
      throw error;
    }
    return {
      outcome: 'RECORDED',
      row: { providerEventRowId: rowId, provider, providerEventId, receivedAt: now, processingStatus: 'RECEIVED', correlationRef },
    };
  }

  async findByProviderEventId(provider: string, providerEventId: string): Promise<ProviderEventRow | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProviderEventSqlRow>(conn, `SELECT * FROM billing_provider_events WHERE provider = ? AND provider_event_id = ?`, [provider, providerEventId]),
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async updateProcessingStatus(providerEventRowId: string, status: ProviderEventProcessingStatus): Promise<void> {
    await runInTransaction((conn) => execute(conn, `UPDATE billing_provider_events SET processing_status = ? WHERE provider_event_row_id = ?`, [status, providerEventRowId]));
  }
}

/** Thin service wrapper -- ProviderEvent persistence has no RBAC gate of its own (it is written by an internal provider-adapter integration point, not directly by a Platform Administration operator action), consistent with `PCA-ADD-BILL-011`'s "foundation" scope. */
export class ProviderEventService {
  constructor(private readonly repository: ProviderEventRepository) {}

  async record(provider: string, providerEventId: string, correlationRef: string | null, now: Date = new Date()): Promise<RecordProviderEventOutcome> {
    return this.repository.recordIfNew(provider, providerEventId, correlationRef, now);
  }
}
