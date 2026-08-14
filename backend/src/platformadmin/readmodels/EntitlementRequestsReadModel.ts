/**
 * PCA-PA-3B -- cross-family entitlement change-request list (mission
 * Section 10's "GET entitlement requests"). `ChangeRequestRepository`
 * (PCA-PA-2) only exposes `listForFamily`/`listOpenForFamily` -- no
 * global/cross-family list exists anywhere. This is a read-only additive
 * query against the same `entitlement_change_requests` table PCA-PA-2
 * already owns; it never writes to it (every mutation still goes through
 * `PlatformAdminEntitlementService`/`ChangeRequestService`).
 */

import { execute, runInTransaction } from '../../db/pool.js';
import type { PageRequest, PageResult } from '../api/pagination.js';
import type { EntitlementChangeRequestState, LimitType } from '../../entitlements/types.js';

export interface EntitlementRequestListRow {
  readonly requestId: string;
  readonly familyId: string;
  readonly limitType: LimitType;
  readonly currentLimitAtRequest: number;
  readonly targetLimit: number;
  readonly state: EntitlementChangeRequestState;
  readonly awaitingAdminQuote: boolean;
  readonly noChargeOverride: boolean;
  readonly quoteAmountMinor: string | null;
  readonly quoteCurrencyCode: string | null;
  readonly quoteExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface RequestRow {
  request_id: string;
  family_id: string;
  limit_type: string;
  current_limit_at_request: number;
  target_limit: number;
  state: string;
  awaiting_admin_quote: number;
  no_charge_override: number;
  quote_amount_minor: number | string | null;
  quote_currency_code: string | null;
  quote_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: RequestRow): EntitlementRequestListRow {
  return {
    requestId: r.request_id,
    familyId: r.family_id,
    limitType: r.limit_type as LimitType,
    currentLimitAtRequest: r.current_limit_at_request,
    targetLimit: r.target_limit,
    state: r.state as EntitlementChangeRequestState,
    awaitingAdminQuote: r.awaiting_admin_quote === 1,
    noChargeOverride: r.no_charge_override === 1,
    quoteAmountMinor: r.quote_amount_minor === null ? null : String(r.quote_amount_minor),
    quoteCurrencyCode: r.quote_currency_code,
    quoteExpiresAt: r.quote_expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class EntitlementRequestsReadModel {
  async list(page: PageRequest, filter: { state?: string; familyId?: string }): Promise<PageResult<EntitlementRequestListRow>> {
    return runInTransaction(async (conn) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.state) {
        conditions.push('state = ?');
        params.push(filter.state);
      }
      if (filter.familyId) {
        conditions.push('family_id = ?');
        params.push(filter.familyId);
      }
      const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows: countRows } = await execute<{ total: number }>(conn, `SELECT COUNT(*) AS total FROM entitlement_change_requests ${clause}`, params);
      const { rows } = await execute<RequestRow>(
        conn,
        `SELECT * FROM entitlement_change_requests ${clause} ORDER BY created_at DESC, request_id DESC LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      return { items: rows.map(toRow), total: Number(countRows[0]?.total ?? 0), limit: page.limit, offset: page.offset };
    });
  }
}
