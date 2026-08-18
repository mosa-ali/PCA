import { execute, runInTransaction } from '../../db/pool.js';
import type { PlatformAdminAlertEvent, PlatformAdminAlertPort } from './alertPort.js';

/**
 * PCA-ADD-PA-020: durable local half of the Platform Administration alert
 * boundary. It creates one pending inbox row for every other active
 * APP_OWNER, using only opaque admin IDs. A future external delivery worker
 * may claim these rows for email/SMS/paging; this adapter never stores raw
 * contact data and never claims that an external provider is configured.
 */
export class MySqlPlatformAdminAlertAdapter implements PlatformAdminAlertPort {
  async notifyAppOwners(event: PlatformAdminAlertEvent): Promise<void> {
    if (!event.sourceAdminId) return;

    await runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO platform_admin_security_alerts
           (alert_id, recipient_admin_id, source_admin_id, kind, occurred_at, correlation_id, delivery_state, delivered_at)
         SELECT UUID(), recipient.admin_id, ?, ?, ?, ?, 'PENDING', NULL
         FROM platform_admin_accounts recipient
         INNER JOIN platform_admin_role_assignments assignment
           ON assignment.admin_id = recipient.admin_id
          AND assignment.role = 'APP_OWNER'
          AND assignment.revoked_at IS NULL
         WHERE recipient.status = 'ACTIVE'
           AND recipient.admin_id <> ?
         ON DUPLICATE KEY UPDATE alert_id = alert_id`,
        [event.sourceAdminId, event.kind, event.occurredAt, event.correlationId, event.sourceAdminId],
      );
    });
  }
}
