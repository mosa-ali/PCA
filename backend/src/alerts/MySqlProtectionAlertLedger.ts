import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import { familyEpochFromStorage, isFamilyEpochNumber } from '../familyepoch/bounds.js';
import type { ProtectionAlertEvent, ProtectionAlertTrigger } from './types.js';
import type { ProtectionAlertLedger, ProtectionAlertListOptions, RecordProtectionAlertResult } from './ProtectionAlertLedger.js';
import {
  computeServerCiphertextExpiry,
  isPersistableServerCiphertextWindow,
  resolveServerCiphertextFeedLimit,
  SERVER_CIPHERTEXT_TTL_MS,
} from '../retention/serverCiphertextTtl.js';
import { InvalidProtectionAlertInputError } from './ProtectionAlertGenerator.js';
import { isPlausibleEncryptedPayload, isPlausibleNonce, isPlausibleOpaqueId, PROTECTION_ALERT_POLICY } from './policy.js';

interface ProtectionAlertRow {
  alert_id: unknown;
  family_id: unknown;
  device_id: unknown;
  parent_device_id: unknown;
  trigger_type: unknown;
  key_epoch: unknown;
  generated_at_utc: unknown;
  encrypted_payload_b64: unknown;
  nonce_b64: unknown;
  expires_at: unknown;
}

export class ProtectionAlertStorageError extends Error {
  constructor() {
    super('Stored protection alert row is malformed.');
    this.name = 'ProtectionAlertStorageError';
  }
}

function hasValidBoundedId(value: unknown): value is string {
  return isPlausibleOpaqueId(value) && !/[\uD800-\uDFFF]/u.test(value);
}

export function protectionAlertFromStorage(value: unknown): ProtectionAlertEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProtectionAlertStorageError();
  const row = value as ProtectionAlertRow;
  if (!hasValidBoundedId(row.alert_id) || !hasValidBoundedId(row.family_id) ||
      (row.device_id !== null && !hasValidBoundedId(row.device_id)) || !hasValidBoundedId(row.parent_device_id) ||
      typeof row.trigger_type !== 'string' || !Object.hasOwn(PROTECTION_ALERT_POLICY, row.trigger_type) ||
      (PROTECTION_ALERT_POLICY[row.trigger_type as ProtectionAlertTrigger].requiresDeviceId && row.device_id === null) ||
      !isPlausibleEncryptedPayload(row.encrypted_payload_b64) || !isPlausibleNonce(row.nonce_b64) ||
      !(row.generated_at_utc instanceof Date) || !(row.expires_at instanceof Date) ||
      !isPersistableServerCiphertextWindow(row.generated_at_utc) || !Number.isFinite(row.expires_at.getTime()) ||
      row.expires_at.getTime() !== computeServerCiphertextExpiry(row.generated_at_utc).getTime()) {
    throw new ProtectionAlertStorageError();
  }
  let keyEpoch: number;
  try {
    keyEpoch = familyEpochFromStorage(row.key_epoch);
  } catch {
    throw new ProtectionAlertStorageError();
  }
  if (!isFamilyEpochNumber(keyEpoch)) throw new ProtectionAlertStorageError();
  return {
    alertId: row.alert_id,
    familyId: row.family_id,
    deviceId: row.device_id,
    parentDeviceId: row.parent_device_id,
    trigger: row.trigger_type as ProtectionAlertTrigger,
    keyEpoch,
    generatedAtUtc: new Date(row.generated_at_utc.getTime()),
    encryptedPayloadB64: row.encrypted_payload_b64,
    nonceB64: row.nonce_b64,
  };
}

function snapshotEvent(event: ProtectionAlertEvent): ProtectionAlertEvent {
  return { ...event, generatedAtUtc: new Date(event.generatedAtUtc.getTime()) };
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
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async record(event: ProtectionAlertEvent): Promise<RecordProtectionAlertResult> {
    // Snapshot before the first asynchronous boundary. A caller may reuse its
    // event object while expiry housekeeping is in flight; the row and any
    // duplicate comparison must stay bound to the event accepted here.
    const captured = snapshotEvent(event);
    if (!isPersistableServerCiphertextWindow(captured.generatedAtUtc)) {
      throw new InvalidProtectionAlertInputError('invalid generatedAtUtc');
    }
    if (!isFamilyEpochNumber(captured.keyEpoch)) {
      throw new Error('Protection alert key epoch is outside the supported family epoch range.');
    }
    // Best-effort housekeeping on the write path, exactly as RelayService
    // purges around each relay operation. A failed purge must never fail an
    // alert: the expiry filter on the reads below is what actually enforces
    // the TTL, and this only stops expired ciphertext accumulating on disk.
    await this.purgeExpired(this.now()).catch(() => 0);
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO protection_alerts
             (alert_id, family_id, device_id, parent_device_id, trigger_type, key_epoch, generated_at_utc, encrypted_payload_b64, nonce_b64, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            captured.alertId,
            captured.familyId,
            captured.deviceId,
            captured.parentDeviceId,
            captured.trigger,
            captured.keyEpoch,
            captured.generatedAtUtc,
            captured.encryptedPayloadB64,
            captured.nonceB64,
            // Server policy, never a caller-supplied field: an alert is
            // retained only as long as it may still need collecting.
            computeServerCiphertextExpiry(captured.generatedAtUtc),
          ],
        ),
      );
      return { outcome: 'RECORDED' };
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const existing = await this.get(captured.alertId);
      return existing !== null && sameEvent(existing, captured) ? { outcome: 'IDEMPOTENT_MATCH' } : { outcome: 'CONFLICT' };
    }
  }

  async get(alertId: string): Promise<ProtectionAlertEvent | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionAlertRow>(conn, `SELECT * FROM protection_alerts WHERE alert_id = ?`, [alertId]),
    );
    return rows[0] ? protectionAlertFromStorage(rows[0]) : null;
  }

  async listForFamily(familyId: string, options: ProtectionAlertListOptions = {}): Promise<ProtectionAlertEvent[]> {
    const now = options.now ?? this.now();
    const limit = resolveServerCiphertextFeedLimit(options.limit);
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionAlertRow>(
        conn,
        // The inner query takes the NEWEST `limit` non-expired rows; the
        // outer one restores the ascending order this feed has always
        // returned. Capping oldest-first instead would let a backlog
        // starve the most recent alerts until they aged out.
        `SELECT * FROM (
           SELECT * FROM protection_alerts
            WHERE family_id = ? AND expires_at > ?
            ORDER BY generated_at_utc DESC, alert_id DESC
            LIMIT ?
         ) AS recent
         ORDER BY generated_at_utc ASC, alert_id ASC`,
        [familyId, now, limit],
      ),
    );
    return rows.map(protectionAlertFromStorage);
  }

  async listForParentDevice(
    familyId: string,
    parentDeviceId: string,
    keyEpoch: number,
    options: ProtectionAlertListOptions = {},
  ): Promise<ProtectionAlertEvent[]> {
    if (!isFamilyEpochNumber(keyEpoch, 1)) {
      throw new Error('Protection alert key epoch is outside the supported family epoch range.');
    }
    const now = options.now ?? this.now();
    const limit = resolveServerCiphertextFeedLimit(options.limit);
    const { rows } = await runInTransaction((conn) =>
      execute<ProtectionAlertRow>(
        conn,
        `SELECT * FROM (
           SELECT * FROM protection_alerts
            WHERE family_id = ? AND parent_device_id = ? AND expires_at > ?
              AND key_epoch = ?
            ORDER BY generated_at_utc DESC, alert_id DESC
            LIMIT ?
         ) AS recent
         ORDER BY generated_at_utc ASC, alert_id ASC`,
        [familyId, parentDeviceId, now, keyEpoch, limit],
      ),
    );
    return rows.map(protectionAlertFromStorage);
  }

  /** Purges by policy expiry and also removes rows whose expiry diverges from generatedAt. */
  async purgeExpired(now: Date): Promise<number> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `DELETE FROM protection_alerts
        WHERE expires_at <= ? OR generated_at_utc <= ?`, [now, new Date(now.getTime() - SERVER_CIPHERTEXT_TTL_MS)]),
    );
    return rowCount;
  }
}
