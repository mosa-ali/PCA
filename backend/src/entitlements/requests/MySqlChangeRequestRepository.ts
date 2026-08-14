import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../../db/pool.js';
import type { ChangeRequestRepository, CreateChangeRequestInput } from './ChangeRequestRepository.js';
import type { EntitlementChangeRequestRecord, EntitlementChangeRequestState, LimitType, OpaqueFamilyId, QuoteKind, QuoteSnapshot } from '../types.js';

interface RequestRow {
  request_id: string;
  family_id: string;
  limit_type: LimitType;
  current_limit_at_request: number;
  target_limit: number;
  state: EntitlementChangeRequestState;
  awaiting_admin_quote: number;
  no_charge_override: number;
  quote_kind: QuoteKind | null;
  quote_ref: string | null;
  quote_amount_minor: string | null;
  quote_currency_code: string | null;
  quote_price_book_version: string | null;
  quoted_at: Date | null;
  quote_expires_at: Date | null;
  decided_by_admin_id: string | null;
  decision_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: RequestRow): EntitlementChangeRequestRecord {
  const quote: QuoteSnapshot | null =
    row.quote_kind && row.quote_ref && row.quote_amount_minor !== null && row.quote_currency_code && row.quoted_at && row.quote_expires_at
      ? {
          quoteKind: row.quote_kind,
          quoteRef: row.quote_ref,
          amountMinor: BigInt(row.quote_amount_minor),
          currencyCode: row.quote_currency_code,
          priceBookVersion: row.quote_price_book_version,
          quotedAt: row.quoted_at,
          expiresAt: row.quote_expires_at,
        }
      : null;
  return {
    requestId: row.request_id,
    familyId: row.family_id,
    limitType: row.limit_type,
    currentLimitAtRequest: row.current_limit_at_request,
    targetLimit: row.target_limit,
    state: row.state,
    awaitingAdminQuote: row.awaiting_admin_quote === 1,
    noChargeOverride: row.no_charge_override === 1,
    quote,
    decidedByAdminId: row.decided_by_admin_id,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectById(conn: PoolConnection, requestId: string, forUpdate: boolean): Promise<EntitlementChangeRequestRecord | null> {
  const { rows } = await execute<RequestRow>(conn, `SELECT * FROM entitlement_change_requests WHERE request_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [requestId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

const OPEN_STATES: EntitlementChangeRequestState[] = ['PENDING', 'QUOTED', 'PAYMENT_PENDING'];

export class MySqlChangeRequestRepository implements ChangeRequestRepository {
  async getById(requestId: string): Promise<EntitlementChangeRequestRecord | null> {
    return runInTransaction((conn) => selectById(conn, requestId, false));
  }

  async lockById(conn: PoolConnection, requestId: string): Promise<EntitlementChangeRequestRecord | null> {
    return selectById(conn, requestId, true);
  }

  async listForFamily(familyId: OpaqueFamilyId): Promise<EntitlementChangeRequestRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RequestRow>(conn, `SELECT * FROM entitlement_change_requests WHERE family_id = ? ORDER BY created_at DESC`, [familyId]),
    );
    return rows.map(mapRow);
  }

  async listOpenForFamily(familyId: OpaqueFamilyId): Promise<EntitlementChangeRequestRecord[]> {
    const placeholders = OPEN_STATES.map(() => '?').join(', ');
    const { rows } = await runInTransaction((conn) =>
      execute<RequestRow>(
        conn,
        `SELECT * FROM entitlement_change_requests WHERE family_id = ? AND state IN (${placeholders}) ORDER BY created_at DESC`,
        [familyId, ...OPEN_STATES],
      ),
    );
    return rows.map(mapRow);
  }

  async create(conn: PoolConnection, input: CreateChangeRequestInput): Promise<EntitlementChangeRequestRecord> {
    await execute(
      conn,
      `INSERT INTO entitlement_change_requests
         (request_id, family_id, limit_type, current_limit_at_request, target_limit, state,
          awaiting_admin_quote, no_charge_override, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 0, 0, ?, ?)`,
      [input.requestId, input.familyId, input.limitType, input.currentLimitAtRequest, input.targetLimit, input.now, input.now],
    );
    await this.recordTransition(conn, input.requestId, null, 'PENDING', null, input.now);
    const created = await selectById(conn, input.requestId, false);
    if (!created) throw new Error(`entitlement_change_requests row missing for ${input.requestId} after create`);
    return created;
  }

  async recordTransition(conn: PoolConnection, requestId: string, fromState: EntitlementChangeRequestState | null, toState: EntitlementChangeRequestState, actorAdminId: string | null, now: Date): Promise<void> {
    await execute(
      conn,
      `INSERT INTO entitlement_change_request_transitions (transition_id, request_id, from_state, to_state, occurred_at, actor_admin_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), requestId, fromState, toState, now, actorAdminId],
    );
  }

  async attachQuote(conn: PoolConnection, requestId: string, quote: QuoteSnapshot, now: Date): Promise<EntitlementChangeRequestRecord | null> {
    const updated = await execute(
      conn,
      `UPDATE entitlement_change_requests
       SET state = 'QUOTED', awaiting_admin_quote = 0,
           quote_kind = ?, quote_ref = ?, quote_amount_minor = ?, quote_currency_code = ?,
           quote_price_book_version = ?, quoted_at = ?, quote_expires_at = ?, updated_at = ?
       WHERE request_id = ? AND state = 'PENDING'`,
      [quote.quoteKind, quote.quoteRef, quote.amountMinor.toString(), quote.currencyCode, quote.priceBookVersion, quote.quotedAt, quote.expiresAt, now, requestId],
    );
    if (updated.rowCount === 0) return null;
    await this.recordTransition(conn, requestId, 'PENDING', 'QUOTED', null, now);
    return selectById(conn, requestId, false);
  }

  async markAwaitingAdminQuote(conn: PoolConnection, requestId: string, now: Date): Promise<EntitlementChangeRequestRecord | null> {
    const updated = await execute(
      conn,
      `UPDATE entitlement_change_requests SET awaiting_admin_quote = 1, updated_at = ? WHERE request_id = ? AND state = 'PENDING'`,
      [now, requestId],
    );
    if (updated.rowCount === 0) return null;
    return selectById(conn, requestId, false);
  }

  async moveToPaymentPending(conn: PoolConnection, requestId: string, now: Date): Promise<EntitlementChangeRequestRecord | null> {
    const updated = await execute(
      conn,
      `UPDATE entitlement_change_requests SET state = 'PAYMENT_PENDING', updated_at = ? WHERE request_id = ? AND state = 'QUOTED'`,
      [now, requestId],
    );
    if (updated.rowCount === 0) return null;
    await this.recordTransition(conn, requestId, 'QUOTED', 'PAYMENT_PENDING', null, now);
    return selectById(conn, requestId, false);
  }

  async markApproved(conn: PoolConnection, requestId: string, fromStates: EntitlementChangeRequestState[], decidedByAdminId: string | null, noChargeOverride: boolean, now: Date): Promise<EntitlementChangeRequestRecord | null> {
    const before = await selectById(conn, requestId, false);
    const placeholders = fromStates.map(() => '?').join(', ');
    const updated = await execute(
      conn,
      `UPDATE entitlement_change_requests
       SET state = 'APPROVED', decided_by_admin_id = ?, no_charge_override = ?, updated_at = ?
       WHERE request_id = ? AND state IN (${placeholders})`,
      [decidedByAdminId, noChargeOverride ? 1 : 0, now, requestId, ...fromStates],
    );
    if (updated.rowCount === 0) return null;
    await this.recordTransition(conn, requestId, before?.state ?? null, 'APPROVED', decidedByAdminId, now);
    return selectById(conn, requestId, false);
  }

  async markDenied(conn: PoolConnection, requestId: string, fromStates: EntitlementChangeRequestState[], decidedByAdminId: string | null, reason: string, now: Date): Promise<EntitlementChangeRequestRecord | null> {
    const before = await selectById(conn, requestId, false);
    const placeholders = fromStates.map(() => '?').join(', ');
    const updated = await execute(
      conn,
      `UPDATE entitlement_change_requests
       SET state = 'DENIED', decided_by_admin_id = ?, decision_reason = ?, updated_at = ?
       WHERE request_id = ? AND state IN (${placeholders})`,
      [decidedByAdminId, reason, now, requestId, ...fromStates],
    );
    if (updated.rowCount === 0) return null;
    await this.recordTransition(conn, requestId, before?.state ?? null, 'DENIED', decidedByAdminId, now);
    return selectById(conn, requestId, false);
  }

  async markCancelled(conn: PoolConnection, requestId: string, fromStates: EntitlementChangeRequestState[], now: Date): Promise<EntitlementChangeRequestRecord | null> {
    const before = await selectById(conn, requestId, false);
    const placeholders = fromStates.map(() => '?').join(', ');
    const updated = await execute(
      conn,
      `UPDATE entitlement_change_requests SET state = 'CANCELLED', updated_at = ? WHERE request_id = ? AND state IN (${placeholders})`,
      [now, requestId, ...fromStates],
    );
    if (updated.rowCount === 0) return null;
    await this.recordTransition(conn, requestId, before?.state ?? null, 'CANCELLED', null, now);
    return selectById(conn, requestId, false);
  }
}
