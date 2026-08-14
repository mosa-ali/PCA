import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { execute, runInTransaction } from '../../db/pool.js';
import { validateAuditEvent } from './types.js';
import type { PlatformAdminAuditEvent, PlatformAdminAuditQueryFilter } from './types.js';
import type { PlatformAdminAuditRepository } from './AuditRepository.js';
import type { PlatformAdminId, PlatformAdminRole } from '../auth/types.js';

interface AuditEventRow extends RowDataPacket {
  event_id: string;
  event_type: string;
  actor_admin_id: string | null;
  actor_role: string | null;
  target_ref: string | null;
  result: string;
  occurred_at: Date;
  correlation_id: string;
  // mysql2 auto-parses a JSON-typed column into a JS value (object/array/etc)
  // rather than returning it as a raw string -- this field's runtime type is
  // therefore `unknown` (whatever the stored JSON decodes to), never
  // reliably `string`. See toDomain's handling below.
  metadata_json: unknown;
}

function toDomain(row: AuditEventRow): PlatformAdminAuditEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type as PlatformAdminAuditEvent['eventType'],
    actorAdminId: row.actor_admin_id,
    actorRole: row.actor_role as PlatformAdminAuditEvent['actorRole'],
    targetRef: row.target_ref,
    result: row.result as PlatformAdminAuditEvent['result'],
    occurredAt: row.occurred_at,
    correlationId: row.correlation_id,
    metadata:
      row.metadata_json === null || row.metadata_json === undefined
        ? null
        : typeof row.metadata_json === 'string'
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
          : (row.metadata_json as Record<string, unknown>),
  };
}

/**
 * Inserts one audit row on the given connection -- exported as a standalone
 * function (not only a class method) so other domains' repositories
 * (MySqlPlatformAdminAuthRepository) can write an audit row on the SAME
 * connection/transaction as their own mutation, without instantiating this
 * class or opening a second connection. This is the mechanism that
 * satisfies "audit write must be in the same transaction as the mutation,
 * never a separate best-effort call" for every mutating
 * PlatformAdminAccountService/PlatformAdminAuthService method.
 */
export async function insertPlatformAdminAuditEventRow(conn: PoolConnection, event: PlatformAdminAuditEvent): Promise<void> {
  const { metadataJson } = validateAuditEvent(event);
  await execute(
    conn,
    `INSERT INTO platform_admin_audit_events
       (event_id, event_type, actor_admin_id, actor_role, target_ref, result, occurred_at, correlation_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.eventId,
      event.eventType,
      event.actorAdminId,
      event.actorRole,
      event.targetRef,
      event.result,
      event.occurredAt,
      event.correlationId,
      metadataJson,
    ],
  );
}

export class MySqlPlatformAdminAuditRepository implements PlatformAdminAuditRepository {
  async insert(event: PlatformAdminAuditEvent): Promise<void> {
    await runInTransaction((conn) => insertPlatformAdminAuditEventRow(conn, event));
  }

  async insertWithinTransaction(conn: PoolConnection, event: PlatformAdminAuditEvent): Promise<void> {
    await insertPlatformAdminAuditEventRow(conn, event);
  }

  /**
   * PCA-ADD-PA-046: full read access is APP_OWNER/AUDITOR_READ_ONLY only;
   * every other role sees only its own actions. This is the documented
   * "own actions only" subset chosen for every non-owner/auditor role in
   * this PCA-PA-1 lane (Section 3.7's "own actions + relevant" -- the
   * "+ relevant" domain-subset extension beyond own-actions is left to a
   * later workstream, as documented in the implementation report).
   */
  async queryForRole(
    roles: PlatformAdminRole[],
    callerAdminId: PlatformAdminId,
    filter: PlatformAdminAuditQueryFilter,
  ): Promise<PlatformAdminAuditEvent[]> {
    const unrestricted = roles.includes('APP_OWNER') || roles.includes('AUDITOR_READ_ONLY');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!unrestricted) {
      conditions.push('actor_admin_id = ?');
      params.push(callerAdminId);
    }
    if (filter.eventType !== undefined) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.sinceOccurredAt !== undefined) {
      conditions.push('occurred_at >= ?');
      params.push(filter.sinceOccurredAt);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);

    const { rows } = await runInTransaction((conn) =>
      execute<AuditEventRow>(
        conn,
        `SELECT event_id, event_type, actor_admin_id, actor_role, target_ref, result, occurred_at, correlation_id, metadata_json
         FROM platform_admin_audit_events
         ${whereClause}
         ORDER BY occurred_at DESC
         LIMIT ${limit}`,
        params,
      ),
    );
    return rows.map(toDomain);
  }
}
