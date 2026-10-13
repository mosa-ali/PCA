import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import { familyEpochFromStorage, isFamilyEpochNumber } from '../familyepoch/bounds.js';
import type {
  FamilyAuditEventEnvelope,
  FamilyAuditEventLedger,
  FamilyAuditEventListOptions,
  RecordFamilyAuditEventResult,
} from './FamilyAuditEventLedger.js';
import {
  computeServerCiphertextExpiry,
  isServerCiphertextExpired,
  isPersistableServerCiphertextWindow,
  resolveServerCiphertextFeedLimit,
  SERVER_CIPHERTEXT_TTL_MS,
} from '../retention/serverCiphertextTtl.js';

interface FamilyAuditEventRow {
  envelope_id: unknown;
  family_id: unknown;
  parent_device_id: unknown;
  key_epoch: unknown;
  generated_at_utc: unknown;
  encrypted_payload_b64: unknown;
  nonce_b64: unknown;
  expires_at: unknown;
}

const MAX_ENVELOPE_ID_LENGTH = 200;
const MAX_FAMILY_ID_LENGTH = 128;
const MAX_PARENT_DEVICE_ID_LENGTH = 200;
const MAX_ENCRYPTED_PAYLOAD_LENGTH = 4_194_304;
const MAX_NONCE_LENGTH = 64;

export class FamilyAuditEventStorageError extends Error {
  constructor() {
    super('Stored FamilyAudit envelope row is malformed.');
    this.name = 'FamilyAuditEventStorageError';
  }
}

function hasValidBoundedId(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= maximumLength &&
    !/[\uD800-\uDFFF]/u.test(value);
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

export function familyAuditEnvelopeFromStorage(value: unknown): FamilyAuditEventEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FamilyAuditEventStorageError();
  const row = value as FamilyAuditEventRow;
  if (!hasValidBoundedId(row.envelope_id, MAX_ENVELOPE_ID_LENGTH) ||
      !hasValidBoundedId(row.family_id, MAX_FAMILY_ID_LENGTH) ||
      !hasValidBoundedId(row.parent_device_id, MAX_PARENT_DEVICE_ID_LENGTH) ||
      typeof row.encrypted_payload_b64 !== 'string' || row.encrypted_payload_b64.length < 1 ||
      row.encrypted_payload_b64.length > MAX_ENCRYPTED_PAYLOAD_LENGTH || !isAscii(row.encrypted_payload_b64) ||
      typeof row.nonce_b64 !== 'string' || row.nonce_b64.length < 1 || row.nonce_b64.length > MAX_NONCE_LENGTH ||
      !isAscii(row.nonce_b64) || !(row.generated_at_utc instanceof Date) || !(row.expires_at instanceof Date) ||
      !isPersistableServerCiphertextWindow(row.generated_at_utc) || !Number.isFinite(row.expires_at.getTime()) ||
      row.expires_at.getTime() !== computeServerCiphertextExpiry(row.generated_at_utc).getTime()) {
    throw new FamilyAuditEventStorageError();
  }
  let keyEpoch: number;
  try {
    keyEpoch = familyEpochFromStorage(row.key_epoch);
  } catch {
    throw new FamilyAuditEventStorageError();
  }
  if (!isFamilyEpochNumber(keyEpoch)) throw new FamilyAuditEventStorageError();
  return {
    envelopeId: row.envelope_id,
    familyId: row.family_id,
    parentDeviceId: row.parent_device_id,
    keyEpoch,
    generatedAtUtc: new Date(row.generated_at_utc.getTime()),
    encryptedPayloadB64: row.encrypted_payload_b64,
    nonceB64: row.nonce_b64,
  };
}

function snapshotEnvelope(envelope: FamilyAuditEventEnvelope): FamilyAuditEventEnvelope {
  return { ...envelope, generatedAtUtc: new Date(envelope.generatedAtUtc.getTime()) };
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
    // Capture all accepted routing and payload fields before expiry
    // housekeeping yields. Callers may reuse or mutate their envelope while
    // cleanup is in flight; persistence and replay checks must use one value.
    const captured = snapshotEnvelope(envelope);
    if (!isPersistableServerCiphertextWindow(captured.generatedAtUtc)) {
      throw new RangeError('Family audit generatedAtUtc is outside the persistable MySQL DATETIME(3) retained-window range.');
    }
    if (!isFamilyEpochNumber(captured.keyEpoch)) {
      throw new Error('Family audit key epoch is outside the supported family epoch range.');
    }
    const now = this.now();
    if (isServerCiphertextExpired(captured.generatedAtUtc, now)) {
      throw new RangeError('Family audit event is already outside the server ciphertext retention window.');
    }
    // Best-effort housekeeping, exactly as RelayService purges around each
    // relay operation. The expiry filter on the reads is what enforces the
    // TTL; this only stops expired ciphertext accumulating on disk, so a
    // failure here must never fail the audit write itself.
    await this.purgeExpired(now).catch(() => 0);
    // The purge yields to MySQL. Sample the clock again before INSERT so a
    // row that crossed its retention boundary during cleanup is never
    // reported as queued while already invisible to subsequent feed reads.
    if (isServerCiphertextExpired(captured.generatedAtUtc, this.now())) {
      throw new RangeError('Family audit event is already outside the server ciphertext retention window.');
    }
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO family_audit_events
             (envelope_id, family_id, parent_device_id, key_epoch, generated_at_utc, encrypted_payload_b64, nonce_b64, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            captured.envelopeId,
            captured.familyId,
            captured.parentDeviceId,
            captured.keyEpoch,
            captured.generatedAtUtc,
            captured.encryptedPayloadB64,
            captured.nonceB64,
            // Server retention policy, never a caller-supplied field.
            computeServerCiphertextExpiry(captured.generatedAtUtc),
          ],
        ),
      );
      return { outcome: 'RECORDED' };
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const existing = await this.get(captured.envelopeId);
      return existing !== null && sameEnvelope(existing, captured) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    }
  }

  async get(envelopeId: string): Promise<FamilyAuditEventEnvelope | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(conn, `SELECT * FROM family_audit_events WHERE envelope_id = ?`, [envelopeId]),
    );
    return rows[0] ? familyAuditEnvelopeFromStorage(rows[0]) : null;
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
    return rows.map(familyAuditEnvelopeFromStorage);
  }

  async listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    keyEpoch: number,
    options: FamilyAuditEventListOptions = {},
  ): Promise<FamilyAuditEventEnvelope[]> {
    if (!isFamilyEpochNumber(keyEpoch, 1)) {
      throw new Error('Family audit key epoch is outside the supported family epoch range.');
    }
    const now = options.now ?? this.now();
    const limit = resolveServerCiphertextFeedLimit(options.limit);
    const cursorPredicate = options.cursor
      ? 'AND (generated_at_utc > ? OR (generated_at_utc = ? AND envelope_id > ?))'
      : '';
    const parameters = options.cursor
      ? [familyId, parentDeviceId, keyEpoch, now, options.cursor.generatedAtUtc, options.cursor.generatedAtUtc, options.cursor.envelopeId, limit]
      : [familyId, parentDeviceId, keyEpoch, now, limit];
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyAuditEventRow>(
        conn,
        `SELECT * FROM family_audit_events
          WHERE family_id = ? AND parent_device_id = ? AND key_epoch = ? AND expires_at > ?
            ${cursorPredicate}
          ORDER BY generated_at_utc ASC, envelope_id ASC
          LIMIT ?`,
        parameters,
      ),
    );
    return rows.map(familyAuditEnvelopeFromStorage);
  }

  /** Purges by policy expiry and also removes rows whose expiry diverges from the generated-at TTL. */
  async purgeExpired(now: Date): Promise<number> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `DELETE FROM family_audit_events
        WHERE expires_at <= ? OR generated_at_utc <= ?`, [now, new Date(now.getTime() - SERVER_CIPHERTEXT_TTL_MS)]),
    );
    return rowCount;
  }
}
