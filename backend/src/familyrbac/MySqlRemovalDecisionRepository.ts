import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import {
  RemovalDecisionError,
  type RemovalDecisionRecord,
  type RemovalDecisionRepository,
} from './RemovalDecisionAuthority.js';

interface RemovalDecisionRow {
  request_id: string;
  family_id: string;
  child_id: string;
  device_id: string;
  operation: RemovalDecisionRecord['operation'];
  protection_level: RemovalDecisionRecord['protectionLevel'];
  requested_at: Date | string;
  expires_at: Date | string;
  reason_category: RemovalDecisionRecord['reasonCategory'];
  protective_authority_applies: number | string;
  state: RemovalDecisionRecord['state'];
  decided_at: Date | string | null;
  decision_method: RemovalDecisionRecord['decisionMethod'];
  temporary_disable_until: Date | string | null;
  decided_by_device_id: string | null;
  decision_action_id: string | null;
  idempotency_key: string | null;
  decision_fingerprint: string | null;
}

const SELECT_COLUMNS = `request_id, family_id, child_id, device_id, operation, protection_level,
  requested_at, expires_at, reason_category, protective_authority_applies, state,
  decided_at, decision_method, temporary_disable_until,
  decided_by_device_id, decision_action_id, idempotency_key, decision_fingerprint`;

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function toRecord(row: RemovalDecisionRow): RemovalDecisionRecord {
  if (Number(row.protective_authority_applies) !== 1) {
    throw new RemovalDecisionError('INVALID_STATE');
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
    decidedByDeviceId: row.decided_by_device_id,
    decisionActionId: row.decision_action_id,
    idempotencyKey: row.idempotency_key,
    decisionFingerprint: row.decision_fingerprint,
  };
}

function sameDecisionOutcome(a: RemovalDecisionRecord, b: RemovalDecisionRecord): boolean {
  return (
    a.state === b.state &&
    a.decisionMethod === b.decisionMethod &&
    (a.temporaryDisableUntil?.getTime() ?? null) === (b.temporaryDisableUntil?.getTime() ?? null) &&
    a.decisionActionId === b.decisionActionId &&
    a.idempotencyKey === b.idempotencyKey &&
    a.decisionFingerprint === b.decisionFingerprint
  );
}

/** Durable removal/disable decision state with an SQL compare-and-set transition for PCA-ADD-ENR-012/016/017/018. */
export class MySqlRemovalDecisionRepository implements RemovalDecisionRepository {
  async get(requestId: string): Promise<RemovalDecisionRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<RemovalDecisionRow>(
        conn,
        `SELECT ${SELECT_COLUMNS} FROM enrollment_protection_approval_requests WHERE request_id = ?`,
        [requestId],
      ),
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listForFamily(familyId: string): Promise<RemovalDecisionRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RemovalDecisionRow>(
        conn,
        `SELECT ${SELECT_COLUMNS}
         FROM enrollment_protection_approval_requests
         WHERE family_id = ?
         ORDER BY requested_at DESC, request_id DESC`,
        [familyId],
      ),
    );
    return rows.map(toRecord);
  }

  async create(record: RemovalDecisionRecord): Promise<void> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO enrollment_protection_approval_requests
             (request_id, family_id, child_id, device_id, operation, protection_level,
              requested_at, expires_at, reason_category, protective_authority_applies,
              state, decided_at, decision_method, temporary_disable_until,
              decided_by_device_id, decision_action_id, idempotency_key, decision_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.requestId,
            record.familyId,
            record.childId,
            record.deviceId,
            record.operation,
            record.protectionLevel,
            record.requestedAt,
            record.expiresAt,
            record.reasonCategory,
            record.protectiveAuthorityApplies ? 1 : 0,
            record.state,
            record.decidedAt,
            record.decisionMethod,
            record.temporaryDisableUntil,
            record.decidedByDeviceId,
            record.decisionActionId,
            record.idempotencyKey,
            record.decisionFingerprint,
          ],
        ),
      );
    } catch (error) {
      if (isDuplicateEntry(error)) throw new RemovalDecisionError('CONFLICT');
      throw error;
    }
  }

  async commitDecision(requestId: string, next: RemovalDecisionRecord): Promise<'APPLIED' | 'ALREADY_DECIDED' | 'CONFLICT'> {
    return runInTransaction(async (conn) => {
      const { rowCount } = await execute(
        conn,
        `UPDATE enrollment_protection_approval_requests
         SET state = ?, decided_at = ?, decision_method = ?, temporary_disable_until = ?,
             decided_by_device_id = ?, decision_action_id = ?, idempotency_key = ?, decision_fingerprint = ?
         WHERE request_id = ?
           AND state = 'PARENT_APPROVAL_REQUIRED'
           AND expires_at > ?`,
        [
          next.state,
          next.decidedAt,
          next.decisionMethod,
          next.temporaryDisableUntil,
          next.decidedByDeviceId,
          next.decisionActionId,
          next.idempotencyKey,
          next.decisionFingerprint,
          requestId,
          next.decidedAt,
        ],
      );
      if (rowCount > 0) return 'APPLIED';

      const { rows } = await execute<RemovalDecisionRow>(
        conn,
        `SELECT ${SELECT_COLUMNS}
         FROM enrollment_protection_approval_requests
         WHERE request_id = ?
         FOR UPDATE`,
        [requestId],
      );
      const current = rows[0] ? toRecord(rows[0]) : null;
      if (current !== null && current.state !== 'PARENT_APPROVAL_REQUIRED' && sameDecisionOutcome(current, next)) {
        return 'ALREADY_DECIDED';
      }
      return 'CONFLICT';
    });
  }

  async listAllowRemovalPendingDeviceRevocation(): Promise<RemovalDecisionRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RemovalDecisionRow>(
        conn,
        `SELECT ${SELECT_COLUMNS.split(',').map((c) => `r.${c.trim()}`).join(', ')}
         FROM enrollment_protection_approval_requests r
         JOIN devices d ON d.device_id = r.device_id AND d.family_id = r.family_id
         WHERE r.state = 'ALLOW_REMOVAL' AND r.operation = 'REMOVE_REVOKE_DEVICE' AND d.status != 'REVOKED'
         ORDER BY r.decided_at ASC`,
      ),
    );
    return rows.map(toRecord);
  }
}
