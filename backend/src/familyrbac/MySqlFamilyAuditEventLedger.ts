import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type {
  FamilyAuditEventEnvelope,
  FamilyAuditEventLedger,
  FamilyAuditEventListOptions,
  RecordFamilyAuditEventResult,
} from './FamilyAuditEventLedger.js';
import {
  computeServerCiphertextExpiry,
  resolveServerCiphertextFeedLimit,
} from '../retention/serverCiphertextTtl.js';

interface FamilyAuditEventRow {
  envelope_id: string;
  family_id: string;
  parent_device_id: string;
  key_epoch: number;
  generated_at_utc: Date | string;
  encrypted_payload_b64: string;
  nonce_b64: string;
  expires_at: Date | string;
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
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async record(envelope: FamilyAuditEventEnvelope): Promise<RecordFamilyAuditEventResult> {
    // Best-effort housekeeping, exactly as RelayService purges around each
    // relay operation. The expiry filter on the reads is what enforces the
    // TTL; this only stops expired ciphertext accumulating on disk, so a
    // failure here must never fail the audit write itself.
    await this.purgeExpired(this.now()).catch(() => 0);
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO family_audit_events
             (envelope_id, family_id, parent_device_id, key_epoch, generated_at_utc, encrypted_payload_b64, nonce_b64, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            envelope.envelopeId,
            envelope.familyId,
            envelope.parentDeviceId,
            envelope.keyEpoch,
            envelope.generatedAtUtc,
            envelope.encryptedPayloadB64,
            envelope.nonceB64,
            // Server retention policy, never a caller-supplied field.
            computeServerCiphertextExpiry(envelope.generatedAtUtc),
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

  async listForFamily(familyId: string, options: FamilyAuditEventListOptions = {}): Promise<FamilyAuditEventEnvelope[]> {
    const now = options.now ?? this.now();
    const limit = resolveServerCiphertextFeedLimit(options.limit);
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(
        conn,
        // Inner query: the newest `limit` non-expired rows. Outer query:
        // the ascending order this feed has always returned. See
        // MySqlProtectionAlertLedger for why the cap is newest-first.
        `SELECT * FROM (
           SELECT * FROM family_audit_events
            WHERE family_id = ? AND expires_at > ?
            ORDER BY generated_at_utc DESC, envelope_id DESC
            LIMIT ?
         ) AS recent
         ORDER BY generated_at_utc ASC, envelope_id ASC`,
        [familyId, now, limit],
      ),
    );
    return rows.map(toEnvelope);
  }

  async listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    options: FamilyAuditEventListOptions = {},
  ): Promise<FamilyAuditEventEnvelope[]> {
    const now = options.now ?? this.now();
    const limit = resolveServerCiphertextFeedLimit(options.limit);
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(
        conn,
        `SELECT * FROM (
           SELECT * FROM family_audit_events
            WHERE family_id = ? AND parent_device_id = ? AND expires_at > ?
            ORDER BY generated_at_utc DESC, envelope_id DESC
            LIMIT ?
         ) AS recent
         ORDER BY generated_at_utc ASC, envelope_id ASC`,
        [familyId, parentDeviceId, now, limit],
      ),
    );
    return rows.map(toEnvelope);
  }

  /** Mirrors MySqlRelayRepository.purgeExpired exactly. */
  async purgeExpired(now: Date): Promise<number> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `DELETE FROM family_audit_events WHERE expires_at <= ?`, [now]),
    );
    return rowCount;
  }
}
