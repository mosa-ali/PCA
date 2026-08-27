import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { FamilyAuditEventEnvelope, FamilyAuditEventLedger, RecordFamilyAuditEventResult } from './FamilyAuditEventLedger.js';

interface FamilyAuditEventRow {
  envelope_id: string;
  family_id: string;
  parent_device_id: string;
  key_epoch: number;
  generated_at_utc: Date | string;
  encrypted_payload_b64: string;
  nonce_b64: string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toEnvelope(row: FamilyAuditEventRow): FamilyAuditEventEnvelope {
  return {
    envelopeId: row.envelope_id,
    familyId: row.family_id,
    parentDeviceId: row.parent_device_id,
    keyEpoch: row.key_epoch,
    generatedAtUtc: toDate(row.generated_at_utc),
    encryptedPayloadB64: row.encrypted_payload_b64,
    nonceB64: row.nonce_b64,
  };
}

function sameEnvelope(a: FamilyAuditEventEnvelope, b: FamilyAuditEventEnvelope): boolean {
  return (
    a.familyId === b.familyId &&
    a.parentDeviceId === b.parentDeviceId &&
    a.keyEpoch === b.keyEpoch &&
    a.generatedAtUtc.getTime() === b.generatedAtUtc.getTime() &&
    a.encryptedPayloadB64 === b.encryptedPayloadB64 &&
    a.nonceB64 === b.nonceB64
  );
}

/**
 * Durable production implementation of FamilyAuditEventLedger (migration
 * 0028). Same append-only, no-acknowledge-here, no-plaintext-read contract
 * as InMemoryFamilyAuditEventLedger -- purely a persistence swap. `record`
 * is idempotent by envelope_id: a retried identical envelope is
 * IDEMPOTENT_MATCH, a different envelope reusing an id is CONFLICT, never a
 * silent overwrite. Mirrors alerts/MySqlProtectionAlertLedger.ts exactly.
 */
export class MySqlFamilyAuditEventLedger implements FamilyAuditEventLedger {
  async record(envelope: FamilyAuditEventEnvelope): Promise<RecordFamilyAuditEventResult> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO family_audit_events
             (envelope_id, family_id, parent_device_id, key_epoch, generated_at_utc, encrypted_payload_b64, nonce_b64)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            envelope.envelopeId,
            envelope.familyId,
            envelope.parentDeviceId,
            envelope.keyEpoch,
            envelope.generatedAtUtc,
            envelope.encryptedPayloadB64,
            envelope.nonceB64,
          ],
        ),
      );
      return { outcome: 'RECORDED' };
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const existing = await this.get(envelope.envelopeId);
      return existing !== null && sameEnvelope(existing, envelope) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    }
  }

  async get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(conn, `SELECT * FROM family_audit_events WHERE envelope_id = ?`, [envelopeId]),
    );
    return rows[0] ? toEnvelope(rows[0]) : null;
  }

  async listForFamily(familyId: string): Promise<FamilyAuditEventEnvelope[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(
        conn,
        `SELECT * FROM family_audit_events WHERE family_id = ? ORDER BY generated_at_utc ASC, envelope_id ASC`,
        [familyId],
      ),
    );
    return rows.map(toEnvelope);
  }

  async listForParentDevice(familyId: string, parentDeviceId: string): Promise<FamilyAuditEventEnvelope[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(
        conn,
        `SELECT * FROM family_audit_events WHERE family_id = ? AND parent_device_id = ? ORDER BY generated_at_utc ASC, envelope_id ASC`,
        [familyId, parentDeviceId],
      ),
    );
    return rows.map(toEnvelope);
  }
}
