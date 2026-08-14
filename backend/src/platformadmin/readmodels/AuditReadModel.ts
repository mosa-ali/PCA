/**
 * PCA-PA-3B -- extended, bounded audit query (mission Section 17):
 * time/actor/event-type/target/result/pagination filters, read-only.
 * `PlatformAdminAuditService.queryForRole` (PCA-PA-1) already implements
 * the exact role-scoping rule this must preserve (`PCA-ADD-PA-046`: full
 * read is APP_OWNER/AUDITOR_READ_ONLY only, every other role sees only its
 * own actorAdminId's events) but only accepts `eventType`/`sinceOccurredAt`/
 * `limit` -- no `actor`/`target`/`result`/`until`/offset-pagination. This
 * module reimplements the SAME scoping rule (never loosens it) against the
 * SAME `platform_admin_audit_events` table with the fuller filter set the
 * mission requires, as a genuinely additive read path -- it never writes
 * to this append-only table (no INSERT/UPDATE/DELETE anywhere in this
 * file), preserving the DB-level append-only grant PCA-PA-1 already
 * enforces (migration 0005's table-level-grant-only design).
 */

import { execute, runInTransaction } from '../../db/pool.js';
import type { PageRequest, PageResult } from '../api/pagination.js';
import type { PlatformAdminId, PlatformAdminRole } from '../auth/types.js';

export interface AuditQueryFilter {
  readonly eventType?: string;
  readonly actorAdminId?: string;
  readonly targetRef?: string;
  readonly result?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  readonly sinceOccurredAt?: Date;
  readonly untilOccurredAt?: Date;
}

export interface AuditEventListRow {
  readonly eventId: string;
  readonly eventType: string;
  readonly actorAdminId: string | null;
  readonly actorRole: string | null;
  readonly targetRef: string | null;
  readonly result: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly metadata: Record<string, unknown> | null;
}

interface AuditRow {
  event_id: string;
  event_type: string;
  actor_admin_id: string | null;
  actor_role: string | null;
  target_ref: string | null;
  result: string;
  occurred_at: Date;
  correlation_id: string;
  metadata_json: unknown;
}

function toRow(r: AuditRow): AuditEventListRow {
  return {
    eventId: r.event_id,
    eventType: r.event_type,
    actorAdminId: r.actor_admin_id,
    actorRole: r.actor_role,
    targetRef: r.target_ref,
    result: r.result,
    occurredAt: r.occurred_at,
    correlationId: r.correlation_id,
    metadata:
      r.metadata_json === null || r.metadata_json === undefined
        ? null
        : typeof r.metadata_json === 'string'
          ? (JSON.parse(r.metadata_json) as Record<string, unknown>)
          : (r.metadata_json as Record<string, unknown>),
  };
}

export class AuditReadModel {
  async query(
    roles: readonly PlatformAdminRole[],
    callerAdminId: PlatformAdminId,
    filter: AuditQueryFilter,
    page: PageRequest,
  ): Promise<PageResult<AuditEventListRow>> {
    const unrestricted = roles.includes('APP_OWNER') || roles.includes('AUDITOR_READ_ONLY');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!unrestricted) {
      conditions.push('actor_admin_id = ?');
      params.push(callerAdminId);
    } else if (filter.actorAdminId) {
      conditions.push('actor_admin_id = ?');
      params.push(filter.actorAdminId);
    }
    if (filter.eventType) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.targetRef) {
      conditions.push('target_ref = ?');
      params.push(filter.targetRef);
    }
    if (filter.result) {
      conditions.push('result = ?');
      params.push(filter.result);
    }
    if (filter.sinceOccurredAt) {
      conditions.push('occurred_at >= ?');
      params.push(filter.sinceOccurredAt);
    }
    if (filter.untilOccurredAt) {
      conditions.push('occurred_at <= ?');
      params.push(filter.untilOccurredAt);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return runInTransaction(async (conn) => {
      const { rows: countRows } = await execute<{ total: number }>(
        conn,
        `SELECT COUNT(*) AS total FROM platform_admin_audit_events ${whereClause}`,
        params,
      );
      const { rows } = await execute<AuditRow>(
        conn,
        `SELECT event_id, event_type, actor_admin_id, actor_role, target_ref, result, occurred_at, correlation_id, metadata_json
         FROM platform_admin_audit_events
         ${whereClause}
         ORDER BY occurred_at DESC, event_id DESC
         LIMIT ? OFFSET ?`,
        [...params, page.limit, page.offset],
      );
      return { items: rows.map(toRow), total: Number(countRows[0]?.total ?? 0), limit: page.limit, offset: page.offset };
    });
  }
}
