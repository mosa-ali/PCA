/**
 * PCA Billing Core -- Dispute (`PCA-ADD-BILL-010`). Provider-neutral status
 * vocabulary only -- no provider-specific enum value leaks into this
 * domain's semantics.
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import { requireBillingOperation } from './rbac.js';
import type { PlatformAdminRole } from '../platformadmin/auth/types.js';

export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'WON' | 'LOST';

export interface DisputeRow {
  readonly disputeId: string;
  readonly paymentTransactionId: string;
  readonly status: DisputeStatus;
  readonly evidenceSubmittedAt: Date | null;
  readonly evidenceDueAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface DisputeSqlRow {
  dispute_id: string;
  payment_transaction_id: string;
  status: string;
  evidence_submitted_at: Date | null;
  evidence_due_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: DisputeSqlRow): DisputeRow {
  return {
    disputeId: row.dispute_id,
    paymentTransactionId: row.payment_transaction_id,
    status: row.status as DisputeStatus,
    evidenceSubmittedAt: row.evidence_submitted_at,
    evidenceDueAt: row.evidence_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DisputeRepository {
  async open(conn: PoolConnection, paymentTransactionId: string, evidenceDueAt: Date | null, now: Date): Promise<DisputeRow> {
    const disputeId = randomUUID();
    await execute(
      conn,
      `INSERT INTO billing_disputes (dispute_id, payment_transaction_id, status, evidence_submitted_at, evidence_due_at, created_at, updated_at)
       VALUES (?, ?, 'OPEN', NULL, ?, ?, ?)`,
      [disputeId, paymentTransactionId, evidenceDueAt, now, now],
    );
    const { rows } = await execute<DisputeSqlRow>(conn, `SELECT * FROM billing_disputes WHERE dispute_id = ?`, [disputeId]);
    return toDomain(rows[0]);
  }

  async updateStatus(conn: PoolConnection, disputeId: string, status: DisputeStatus): Promise<void> {
    await execute(conn, `UPDATE billing_disputes SET status = ? WHERE dispute_id = ?`, [status, disputeId]);
  }

  async submitEvidence(conn: PoolConnection, disputeId: string, now: Date): Promise<void> {
    await execute(conn, `UPDATE billing_disputes SET status = 'UNDER_REVIEW', evidence_submitted_at = ? WHERE dispute_id = ?`, [now, disputeId]);
  }

  async findById(conn: PoolConnection, disputeId: string): Promise<DisputeRow | null> {
    const { rows } = await execute<DisputeSqlRow>(conn, `SELECT * FROM billing_disputes WHERE dispute_id = ?`, [disputeId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }
}

export class DisputeService {
  constructor(private readonly repository: DisputeRepository) {}

  async openDispute(paymentTransactionId: string, evidenceDueAt: Date | null, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<DisputeRow> {
    requireBillingOperation(roles, 'ADMINISTER_DISPUTE');
    return runInTransaction((conn) => this.repository.open(conn, paymentTransactionId, evidenceDueAt, now));
  }

  async submitEvidence(disputeId: string, roles: readonly PlatformAdminRole[], now: Date = new Date()): Promise<void> {
    requireBillingOperation(roles, 'ADMINISTER_DISPUTE');
    await runInTransaction((conn) => this.repository.submitEvidence(conn, disputeId, now));
  }

  async resolve(disputeId: string, status: 'WON' | 'LOST', roles: readonly PlatformAdminRole[]): Promise<void> {
    requireBillingOperation(roles, 'ADMINISTER_DISPUTE');
    await runInTransaction((conn) => this.repository.updateStatus(conn, disputeId, status));
  }

  async getDispute(disputeId: string, roles: readonly PlatformAdminRole[]): Promise<DisputeRow | null> {
    requireBillingOperation(roles, 'VIEW_BILLING_RECORDS');
    return runInTransaction((conn) => this.repository.findById(conn, disputeId));
  }
}
