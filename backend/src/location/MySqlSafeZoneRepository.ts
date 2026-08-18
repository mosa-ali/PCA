import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import { SafeZoneError, type NewSafeZone, type SafeZone, type SafeZonePatch, type SafeZoneRepository } from './SafeZoneRepository.js';

interface SafeZoneRow {
  zone_id: string;
  family_id: string;
  recipient_endpoint_id: string;
  ciphertext: Buffer;
  nonce: Buffer;
  key_epoch: number;
  revision: number;
  delivery_state: 'PENDING_OFFLINE' | 'READY';
  created_at: Date;
  updated_at: Date;
}

function toSafeZone(row: SafeZoneRow): SafeZone {
  return {
    zoneId: row.zone_id,
    familyId: row.family_id,
    recipientEndpointId: row.recipient_endpoint_id,
    ciphertextB64: row.ciphertext.toString('base64url'),
    nonceB64: row.nonce.toString('base64url'),
    keyEpoch: row.key_epoch,
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
    const zoneId = randomUUID();
    const now = new Date();
    await runInTransaction((conn) => execute(conn, `INSERT INTO safe_zones (zone_id, family_id, recipient_endpoint_id, ciphertext, nonce, key_epoch, revision, delivery_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING_OFFLINE', ?, ?)`, [zoneId, input.familyId, input.recipientEndpointId, Buffer.from(input.ciphertextB64, 'base64url'), Buffer.from(input.nonceB64, 'base64url'), input.keyEpoch, now, now]));
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(conn, `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE zone_id = ? AND family_id = ?`, [zoneId, input.familyId]));
    if (!rows[0]) throw new SafeZoneError('NOT_FOUND');
    return toSafeZone(rows[0]);
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone> {
    const now = new Date();
    const { rowCount } = await runInTransaction((conn) => execute(conn, `UPDATE safe_zones SET ciphertext = COALESCE(?, ciphertext), nonce = COALESCE(?, nonce), key_epoch = COALESCE(?, key_epoch), revision = revision + 1, delivery_state = 'PENDING_OFFLINE', updated_at = ? WHERE zone_id = ? AND family_id = ?`, [patch.ciphertextB64 === undefined ? null : Buffer.from(patch.ciphertextB64, 'base64url'), patch.nonceB64 === undefined ? null : Buffer.from(patch.nonceB64, 'base64url'), patch.keyEpoch ?? null, now, zoneId, familyId]));
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
