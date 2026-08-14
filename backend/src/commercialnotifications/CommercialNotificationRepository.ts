/**
 * PCA-COMMERCIAL-NOTIFY-1 -- durable persistence for commercial
 * notifications (migrations/0012_commercial_notifications.sql).
 *
 * `recordIfNew` is the SOLE insertion path, relying entirely on the DB-level
 * UNIQUE(dedupe_key) constraint for idempotency -- never a
 * pre-check-then-insert (TOCTOU) pattern -- following the exact same
 * discipline as `billing/providerEvent.ts`'s `ProviderEventRepository.recordIfNew`
 * and `billing/refundOrchestration`'s `billing_refund_operations.idempotency_key`
 * (see test/db/commercialNotificationsConcurrency.mysql.test.mjs for the
 * real two-connection proof that exactly one of two concurrent calls for
 * the same dedupeKey succeeds).
 */

import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type {
  CommercialNotificationEventType,
  CommercialNotificationParams,
  CommercialNotificationRow,
  CommercialNotificationSupportRow,
  PublishCommercialNotificationInput,
} from './types.js';

export type RecordCommercialNotificationOutcome =
  | { readonly outcome: 'RECORDED'; readonly row: CommercialNotificationRow }
  | { readonly outcome: 'DUPLICATE'; readonly row: CommercialNotificationRow };

interface CommercialNotificationSqlRow {
  notification_id: string;
  account_ref: string;
  event_type: string;
  dedupe_key: string;
  resource_ref: string | null;
  message_key: string;
  params_json: string | null;
  created_at: Date;
  read_at: Date | null;
  acknowledged_at: Date | null;
}

function parseParams(paramsJson: string | null): CommercialNotificationParams | null {
  if (paramsJson === null) return null;
  // mysql2 returns JSON columns already parsed for most drivers, but this
  // codebase configures the connection without a custom typeCast, so guard
  // both shapes defensively rather than assuming one.
  if (typeof paramsJson !== 'string') return paramsJson as CommercialNotificationParams;
  return JSON.parse(paramsJson) as CommercialNotificationParams;
}

function toDomain(row: CommercialNotificationSqlRow): CommercialNotificationRow {
  return {
    notificationId: row.notification_id,
    accountRef: row.account_ref,
    eventType: row.event_type as CommercialNotificationEventType,
    dedupeKey: row.dedupe_key,
    resourceRef: row.resource_ref,
    messageKey: row.message_key,
    params: parseParams(row.params_json),
    createdAt: row.created_at,
    readAt: row.read_at,
    acknowledgedAt: row.acknowledged_at,
  };
}

function toSupportDomain(row: CommercialNotificationSqlRow): CommercialNotificationSupportRow {
  return {
    notificationId: row.notification_id,
    accountRef: row.account_ref,
    eventType: row.event_type as CommercialNotificationEventType,
    createdAt: row.created_at,
    readAt: row.read_at,
    acknowledgedAt: row.acknowledged_at,
  };
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export class CommercialNotificationRepository {
  /** The sole insertion path. On a dedupe_key collision, returns the ALREADY-recorded row (outcome: 'DUPLICATE') rather than throwing, so a retried publish call is a safe no-op from the caller's point of view. */
  async recordIfNew(input: PublishCommercialNotificationInput, now: Date): Promise<RecordCommercialNotificationOutcome> {
    const notificationId = randomUUID();
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO commercial_notifications
             (notification_id, account_ref, event_type, dedupe_key, resource_ref, message_key, params_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            notificationId,
            input.accountRef,
            input.eventType,
            input.dedupeKey,
            input.resourceRef,
            input.messageKey,
            input.params === null ? null : JSON.stringify(input.params),
            now,
          ],
        ),
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const existing = await this.findByDedupeKey(input.dedupeKey);
        if (!existing) throw new Error('Duplicate-key insert reported but existing row was not found.');
        return { outcome: 'DUPLICATE', row: existing };
      }
      throw error;
    }
    const row = await this.findById(notificationId);
    if (!row) throw new Error('Commercial notification insert did not persist.');
    return { outcome: 'RECORDED', row };
  }

  async findById(notificationId: string): Promise<CommercialNotificationRow | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<CommercialNotificationSqlRow>(conn, `SELECT * FROM commercial_notifications WHERE notification_id = ?`, [notificationId]),
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByDedupeKey(dedupeKey: string): Promise<CommercialNotificationRow | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<CommercialNotificationSqlRow>(conn, `SELECT * FROM commercial_notifications WHERE dedupe_key = ?`, [dedupeKey]),
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** Family-scoped list, newest first. `limit` is clamped to (0, MAX_LIST_LIMIT]. */
  async listByAccount(accountRef: string, limit: number = DEFAULT_LIST_LIMIT): Promise<CommercialNotificationRow[]> {
    const boundedLimit = Math.max(1, Math.min(limit, MAX_LIST_LIMIT));
    const { rows } = await runInTransaction((conn) =>
      execute<CommercialNotificationSqlRow>(
        conn,
        `SELECT * FROM commercial_notifications WHERE account_ref = ? ORDER BY created_at DESC, notification_id DESC LIMIT ?`,
        [accountRef, boundedLimit],
      ),
    );
    return rows.map(toDomain);
  }

  async countUnread(accountRef: string): Promise<number> {
    const { rows } = await runInTransaction((conn) =>
      execute<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM commercial_notifications WHERE account_ref = ? AND read_at IS NULL`, [accountRef]),
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Marks a single notification read, scoped to `accountRef` so one
   * family can never mark (or even affect the row-count outcome of) another
   * family's notification -- the caller distinguishes "not found" from
   * "not owned by this account" only by the boolean result (both map to
   * the same NOT_FOUND-shaped outcome upstream, never leaking existence).
   */
  async markRead(conn: PoolConnection, notificationId: string, accountRef: string, now: Date): Promise<boolean> {
    const { rowCount } = await execute(
      conn,
      `UPDATE commercial_notifications SET read_at = ? WHERE notification_id = ? AND account_ref = ? AND read_at IS NULL`,
      [now, notificationId, accountRef],
    );
    return rowCount > 0;
  }

  /** Idempotent alongside markRead: acknowledging an already-read notification is a no-op success, never an error. */
  async findReadRowScopedToAccount(conn: PoolConnection, notificationId: string, accountRef: string): Promise<CommercialNotificationRow | null> {
    const { rows } = await execute<CommercialNotificationSqlRow>(
      conn,
      `SELECT * FROM commercial_notifications WHERE notification_id = ? AND account_ref = ?`,
      [notificationId, accountRef],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** Acknowledge requires the row to already be read (migration 0012's acknowledged_after_read CHECK) -- sets read_at too if it was somehow not yet set, so this can serve as a combined "read+acknowledge" call. */
  async acknowledge(conn: PoolConnection, notificationId: string, accountRef: string, now: Date): Promise<boolean> {
    const { rowCount } = await execute(
      conn,
      `UPDATE commercial_notifications
         SET read_at = COALESCE(read_at, ?), acknowledged_at = ?
       WHERE notification_id = ? AND account_ref = ? AND acknowledged_at IS NULL`,
      [now, now, notificationId, accountRef],
    );
    return rowCount > 0;
  }

  /** Section 7 Platform Support View: event type/status/opaque account ref only -- no message_key, no params_json. */
  async listForSupport(accountRef: string, limit: number = DEFAULT_LIST_LIMIT): Promise<CommercialNotificationSupportRow[]> {
    const boundedLimit = Math.max(1, Math.min(limit, MAX_LIST_LIMIT));
    const { rows } = await runInTransaction((conn) =>
      execute<CommercialNotificationSqlRow>(
        conn,
        `SELECT notification_id, account_ref, event_type, created_at, read_at, acknowledged_at
           FROM commercial_notifications WHERE account_ref = ? ORDER BY created_at DESC, notification_id DESC LIMIT ?`,
        [accountRef, boundedLimit],
      ),
    );
    return rows.map(toSupportDomain);
  }

  /** Section 13 bounded retention: deletes rows older than `olderThan`, capped at `batchSize` per call so a large backlog cannot hold a long-running lock. Returns the number of rows deleted. */
  async pruneOlderThan(olderThan: Date, batchSize: number = 1000): Promise<number> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `DELETE FROM commercial_notifications WHERE created_at < ? LIMIT ?`, [olderThan, batchSize]),
    );
    return rowCount;
  }
}
