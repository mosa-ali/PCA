import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import { familyEpochFromStorage, isFamilyEpochNumber, MAX_FAMILY_EPOCH } from '../familyepoch/bounds.js';
import { SafeZoneError, validateNewSafeZone, validateSafeZonePatch, type NewSafeZone, type SafeZone, type SafeZonePatch, type SafeZoneRepository } from './SafeZoneRepository.js';

interface SafeZoneRow {
  zone_id: string;
  family_id: string;
  recipient_endpoint_id: string;
  ciphertext: Buffer;
  nonce: Buffer;
  key_epoch: number | bigint | string;
  revision: number;
  delivery_state: 'PENDING_OFFLINE' | 'READY';
  created_at: Date;
  updated_at: Date;
}

function toSafeZone(row: SafeZoneRow): SafeZone {
  let keyEpoch: number;
  try {
    keyEpoch = familyEpochFromStorage(row.key_epoch);
  } catch {
    throw new SafeZoneError('INVALID_INPUT');
  }
  if (!isFamilyEpochNumber(keyEpoch, 1)) throw new SafeZoneError('INVALID_INPUT');
  return {
    zoneId: row.zone_id,
    familyId: row.family_id,
    recipientEndpointId: row.recipient_endpoint_id,
    ciphertextB64: row.ciphertext.toString('base64url'),
    nonceB64: row.nonce.toString('base64url'),
    keyEpoch,
    revision: row.revision,
    deliveryState: row.delivery_state,
    createdAtUtc: row.created_at.toISOString(),
    updatedAtUtc: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `zone_id, family_id, recipient_endpoint_id, ciphertext, nonce, key_epoch, revision, delivery_state, created_at, updated_at`;

export class MySqlSafeZoneRepository implements SafeZoneRepository {
  async list(familyId: string): Promise<SafeZone[]> {
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE family_id = ? ORDER BY zone_id`, [familyId]));
    return rows.map(toSafeZone);
  }

  async create(input: NewSafeZone): Promise<SafeZone> {
    validateNewSafeZone(input);
    const zoneId = randomUUID();
    const now = new Date();
    await runInTransaction((conn) => execute(conn, `INSERT INTO safe_zones (zone_id, family_id, recipient_endpoint_id, ciphertext, nonce, key_epoch, revision, delivery_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING_OFFLINE', ?, ?)`, [zoneId, input.familyId, input.recipientEndpointId, Buffer.from(input.ciphertextB64, 'base64url'), Buffer.from(input.nonceB64, 'base64url'), input.keyEpoch, now, now]));
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, input.familyId]));
    if (!rows[0]) throw new SafeZoneError('NOT_FOUND');
    return toSafeZone(rows[0]);
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone> {
    validateSafeZonePatch(patch);
    const now = new Date();
    const { rowCount } = await runInTransaction((conn) => execute(conn, `UPDATE safe_zones SET ciphertext = COALESCE(?, ciphertext), nonce = COALESCE(?, nonce), key_epoch = COALESCE(?, key_epoch), revision = revision + 1, delivery_state = 'PENDING_OFFLINE', updated_at = ? WHERE zone_id = ? AND family_id = ? AND key_epoch BETWEEN 1 AND ?`, [patch.ciphertextB64 === undefined ? null : Buffer.from(patch.ciphertextB64, 'base64url'), patch.nonceB64 === undefined ? null : Buffer.from(patch.nonceB64, 'base64url'), patch.keyEpoch ?? null, now, zoneId, familyId, MAX_FAMILY_EPOCH]));
    if (rowCount === 0) throw new SafeZoneError('NOT_FOUND');
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, familyId]));
    if (!rows[0]) throw new SafeZoneError('NOT_FOUND');
    return toSafeZone(rows[0]);
  }

  async remove(familyId: string, zoneId: string): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) => execute(conn, `DELETE FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, familyId]));
    return rowCount > 0;
  }
}
