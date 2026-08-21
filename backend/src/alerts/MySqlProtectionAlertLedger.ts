import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { ProtectionAlertEvent, ProtectionAlertTrigger } from './types.js';
import type { ProtectionAlertLedger, RecordProtectionAlertResult } from './ProtectionAlertLedger.js';

interface ProtectionAlertRow {
  alert_id: string;
  family_id: string;
  device_id: string | null;
  parent_device_id: string;
  trigger_type: ProtectionAlertTrigger;
  key_epoch: number;
  generated_at_utc: Date | string;
  encrypted_payload_b64: string;
  nonce_b64: string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toEvent(row: ProtectionAlertRow): ProtectionAlertEvent {
  return {
    alertId: row.alert_id,
    familyId: row.family_id,
    deviceId: row.device_id,
    parentDeviceId: row.parent_device_id,
    trigger: row.trigger_type,
    keyEpoch: row.key_epoch,
    generatedAtUtc: toDate(row.generated_at_utc),
    encryptedPayloadB64: row.encrypted_payload_b64,
    nonceB64: row.nonce_b64,
  };
}

function sameEvent(a: ProtectionAlertEvent, b: ProtectionAlertEvent): boolean {
  return (
    a.familyId === b.familyId &&
    a.deviceId === b.deviceId &&
    a.parentDeviceId === b.parentDeviceId &&
    a.trigger === b.trigger &&
    a.keyEpoch === b.keyEpoch &&
    a.generatedAtUtc.getTime() === b.generatedAtUtc.getTime() &&
    a.encryptedPayloadB64 === b.encryptedPayloadB64 &&
    a.nonceB64 === b.nonceB64
  );
}

/**
 * Durable production implementation of ProtectionAlertLedger (PCA-ADD-ENR-020,
 * migration 0025). Same append-only, no-acknowledge-here, no-plaintext-read
 * contract as InMemoryProtectionAlertLedger -- this is purely a persistence
 * swap, not a behavior change. `record` is idempotent by alert_id, exactly
 * like the in-memory reference: a retried identical event is
 * IDEMPOTENT_MATCH, a different event reusing an alert_id is CONFLICT, never
 * a silent overwrite (mirrors MessageIdempotencyLedger's discipline, per
 * this table's own migration header).
 */
export class MySqlProtectionAlertLedger implements ProtectionAlertLedger {
  async record(event: ProtectionAlertEvent): Promise<RecordProtectionAlertResult> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO protection_alerts
             (alert_id, family_id, device_id, parent_device_id, trigger_type, key_epoch, generated_at_utc, encrypted_payload_b64, nonce_b64)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            event.alertId,
            event.familyId,
            event.deviceId,
            event.parentDeviceId,
            event.trigger,
            event.keyEpoch,
            event.generatedAtUtc,
            event.encryptedPayloadB64,
            event.nonceB64,
          ],
        ),
      );
      return { outcome: 'RECORDED' };
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const existing = await this.get(event.alertId);
      return existing !== null && sameEvent(existing, event) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    }
  }

  async get(alertId: string): Promise<ProtectionAlertEvent | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionAlertRow>(conn, `SELECT * FROM protection_alerts WHERE alert_id = ?`, [alertId]),
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async listForFamily(familyId: string): Promise<ProtectionAlertEvent[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionAlertRow>(
        conn,
        `SELECT * FROM protection_alerts WHERE family_id = ? ORDER BY generated_at_utc ASC, alert_id ASC`,
        [familyId],
      ),
    );
    return rows.map(toEvent);
  }

  async listForParentDevice(familyId: string, parentDeviceId: string): Promise<ProtectionAlertEvent[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionAlertRow>(
        conn,
        `SELECT * FROM protection_alerts WHERE family_id = ? AND parent_device_id = ? ORDER BY generated_at_utc ASC, alert_id ASC`,
        [familyId, parentDeviceId],
      ),
    );
    return rows.map(toEvent);
  }
}
