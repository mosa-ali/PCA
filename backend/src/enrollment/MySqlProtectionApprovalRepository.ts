import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import {
  ProtectionApprovalError,
  type ProtectionApprovalRepository,
  type ProtectionApprovalRequest,
} from './ProtectionApprovalService.js';

interface ProtectionApprovalRow {
  request_id: string;
  family_id: string;
  child_id: string;
  device_id: string;
  operation: ProtectionApprovalRequest['operation'];
  protection_level: ProtectionApprovalRequest['protectionLevel'];
  requested_at: Date | string;
  expires_at: Date | string;
  reason_category: ProtectionApprovalRequest['reasonCategory'];
  protective_authority_applies: number | string;
  state: ProtectionApprovalRequest['state'];
  decided_at: Date | string | null;
  decision_method: ProtectionApprovalRequest['decisionMethod'];
  temporary_disable_until: Date | string | null;
}

const SELECT_COLUMNS = `request_id, family_id, child_id, device_id, operation, protection_level,
  requested_at, expires_at, reason_category, protective_authority_applies, state,
  decided_at, decision_method, temporary_disable_until`;

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function toRequest(row: ProtectionApprovalRow): ProtectionApprovalRequest {
  if (Number(row.protective_authority_applies) !== 1) {
    throw new ProtectionApprovalError('INVALID_STATE');
  }
  return {
    requestId: row.request_id,
    familyId: row.family_id,
    childId: row.child_id,
    deviceId: row.device_id,
    operation: row.operation,
    protectionLevel: row.protection_level,
    requestedAt: toDate(row.requested_at),
    expiresAt: toDate(row.expires_at),
    reasonCategory: row.reason_category,
    // The schema CHECK constraint admits only 1. Keep the domain's literal
    // `true` type so a row cannot become an authority assertion from a
    // caller-supplied boolean or an unchecked database value.
    protectiveAuthorityApplies: true,
    state: row.state,
    decidedAt: row.decided_at === null ? null : toDate(row.decided_at),
    decisionMethod: row.decision_method,
    temporaryDisableUntil: row.temporary_disable_until === null ? null : toDate(row.temporary_disable_until),
  };
}

function sameDecision(a: ProtectionApprovalRequest, b: ProtectionApprovalRequest): boolean {
  return a.state === b.state
    && a.decisionMethod === b.decisionMethod
    && a.temporaryDisableUntil?.getTime() === b.temporaryDisableUntil?.getTime();
}

/** Durable approval state with an SQL compare-and-set transition for PCA-ADD-ENR-016/017. */
export class MySqlProtectionApprovalRepository implements ProtectionApprovalRepository {
  async get(requestId: string): Promise<ProtectionApprovalRequest | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionApprovalRow>(
        conn,
        `SELECT ${SELECT_COLUMNS} FROM enrollment_protection_approval_requests WHERE request_id = ?`,
        [requestId],
      ),
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listForFamily(familyId: string): Promise<ProtectionApprovalRequest[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionApprovalRow>(
        conn,
        `SELECT ${SELECT_COLUMNS}
         FROM enrollment_protection_approval_requests
         WHERE family_id = ?
         ORDER BY requested_at DESC, request_id DESC`,
        [familyId],
      ),
    );
    return rows.map(toRequest);
  }

  async create(request: ProtectionApprovalRequest): Promise<void> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO enrollment_protection_approval_requests
             (request_id, family_id, child_id, device_id, operation, protection_level,
              requested_at, expires_at, reason_category, protective_authority_applies,
              state, decided_at, decision_method, temporary_disable_until)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            request.requestId,
            request.familyId,
            request.childId,
            request.deviceId,
            request.operation,
            request.protectionLevel,
            request.requestedAt,
            request.expiresAt,
            request.reasonCategory,
            request.protectiveAuthorityApplies ? 1 : 0,
            request.state,
            request.decidedAt,
            request.decisionMethod,
            request.temporaryDisableUntil,
          ],
        ),
      );
    } catch (error) {
      if (isDuplicateEntry(error)) throw new ProtectionApprovalError('CONFLICT');
      throw error;
    }
  }

  async decide(requestId: string, next: ProtectionApprovalRequest): Promise<'APPLIED' | 'ALREADY_DECIDED' | 'CONFLICT'> {
    return runInTransaction(async (conn) => {
      const { rowCount } = await execute(
        conn,
        `UPDATE enrollment_protection_approval_requests
         SET state = ?, decided_at = ?, decision_method = ?, temporary_disable_until = ?
         WHERE request_id = ?
           AND state = 'PARENT_APPROVAL_REQUIRED'
           AND expires_at > ?`,
        [
          next.state,
          next.decidedAt,
          next.decisionMethod,
          next.temporaryDisableUntil,
          requestId,
          next.decidedAt,
        ],
      );
      if (rowCount > 0) return 'APPLIED';

      const { rows } = await execute<ProtectionApprovalRow>(
        conn,
        `SELECT ${SELECT_COLUMNS}
         FROM enrollment_protection_approval_requests
         WHERE request_id = ?
         FOR UPDATE`,
        [requestId],
      );
      const current = rows[0] ? toRequest(rows[0]) : null;
      if (current !== null && current.state !== 'PARENT_APPROVAL_REQUIRED' && sameDecision(current, next)) {
        return 'ALREADY_DECIDED';
      }
      return 'CONFLICT';
    });
  }
}
