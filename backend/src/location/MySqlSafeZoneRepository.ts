import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import { familyEpochFromStorage, isFamilyEpochNumber } from '../familyepoch/bounds.js';
import { createSafeZoneDeliveryCursor, safeZoneCursorAfterZoneId, SafeZoneAuthorityChangedError, SafeZoneError, validateNewSafeZone, validateSafeZonePatch, type NewSafeZone, type SafeZone, type SafeZoneMutationAuthoritySnapshot, type SafeZonePatch, type SafeZoneRecipientPage, type SafeZoneRepository } from './SafeZoneRepository.js';

const SAFE_ZONE_DELIVERY_PAGE_SIZE = 16;

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

function snapshotAuthority(authority?: SafeZoneMutationAuthoritySnapshot): SafeZoneMutationAuthoritySnapshot | undefined {
  if (authority === undefined) return undefined;
  return {
    familyId: authority.familyId,
    trustSetEpoch: authority.trustSetEpoch,
    keyEpoch: authority.keyEpoch,
    actor: { deviceId: authority.actor.deviceId, dskKeyId: authority.actor.dskKeyId },
    recipient: { deviceId: authority.recipient.deviceId, dskKeyId: authority.recipient.dskKeyId },
  };
}

export class MySqlSafeZoneRepository implements SafeZoneRepository {
  constructor(private readonly now: () => Date = () => new Date()) {}

  private async assertMutationAuthority(
    conn: Parameters<Parameters<typeof runInTransaction>[0]>[0],
    familyId: string,
    recipientDeviceId: string,
    authority?: SafeZoneMutationAuthoritySnapshot,
  ): Promise<void> {
    if (authority === undefined) {
      if (process.env.NODE_ENV === 'test') return;
      throw new TypeError('MySQL Safe Zone mutation requires an accepted device authority snapshot.');
    }
    if (authority.familyId !== familyId || authority.recipient.deviceId !== recipientDeviceId ||
        typeof authority.actor.deviceId !== 'string' || authority.actor.deviceId.length === 0 ||
        typeof authority.actor.dskKeyId !== 'string' || authority.actor.dskKeyId.length === 0 ||
        typeof authority.recipient.dskKeyId !== 'string' || authority.recipient.dskKeyId.length === 0 ||
        !isFamilyEpochNumber(authority.trustSetEpoch, 1) || !isFamilyEpochNumber(authority.keyEpoch, 1)) {
      throw new TypeError('MySQL Safe Zone mutation authority snapshot is malformed.');
    }

    const { rows: floors } = await execute<{
      minimum_accepted_trust_set_epoch: number | string | bigint;
      minimum_accepted_key_epoch: number | string | bigint;
    }>(
      conn,
      `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
         FROM family_epoch_floors
        WHERE BINARY family_id = BINARY ?
        FOR UPDATE`,
      [familyId],
    );
    const floor = floors[0];
    if (!floor ||
        familyEpochFromStorage(floor.minimum_accepted_trust_set_epoch) !== authority.trustSetEpoch ||
        familyEpochFromStorage(floor.minimum_accepted_key_epoch) !== authority.keyEpoch) {
      throw new SafeZoneAuthorityChangedError();
    }

    const deviceIds = [...new Set([authority.actor.deviceId, authority.recipient.deviceId])].sort();
    const devicePredicate = deviceIds.map(() => 'BINARY d.device_id = BINARY ?').join(' OR ');
    const { rows: devices } = await execute<{ device_id: string }>(
      conn,
      `SELECT d.device_id
         FROM devices d
         JOIN families f ON BINARY f.family_id = BINARY d.family_id
        WHERE (${devicePredicate})
          AND BINARY d.family_id = BINARY ?
          AND d.status = 'ACTIVE'
          AND f.status = 'ACTIVE'
          AND f.deleted_at IS NULL
        ORDER BY BINARY d.device_id
        FOR UPDATE`,
      [...deviceIds, familyId],
    );
    if (devices.length !== deviceIds.length || deviceIds.some((deviceId) =>
      devices.filter((row) => row.device_id === deviceId).length !== 1)) {
      throw new SafeZoneAuthorityChangedError();
    }

    const requestedKeys = [
      { deviceId: authority.actor.deviceId, keyId: authority.actor.dskKeyId },
      { deviceId: authority.recipient.deviceId, keyId: authority.recipient.dskKeyId },
    ];
    const keysToLock = requestedKeys.filter((key, index) => requestedKeys.findIndex((candidate) =>
      candidate.deviceId === key.deviceId && candidate.keyId === key.keyId) === index)
      .sort((left, right) => left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 :
        left.keyId < right.keyId ? -1 : left.keyId > right.keyId ? 1 : 0);
    const keyPredicate = keysToLock.map(() => '(BINARY device_id = BINARY ? AND BINARY key_id = BINARY ?)').join(' OR ');
    const { rows: keys } = await execute<{ device_id: string; key_id: string }>(
      conn,
      `SELECT device_id, key_id
         FROM device_public_keys
        WHERE (${keyPredicate})
          AND key_purpose = 'DSK'
          AND status = 'ACTIVE'
        ORDER BY BINARY device_id, BINARY key_id
        FOR UPDATE`,
      keysToLock.flatMap((key) => [key.deviceId, key.keyId]),
    );
    if (keys.length !== keysToLock.length || keysToLock.some((key) =>
      keys.filter((row) => row.device_id === key.deviceId && row.key_id === key.keyId).length !== 1)) {
      throw new SafeZoneAuthorityChangedError();
    }
  }

  async list(familyId: string): Promise<SafeZone[]> {
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(
      conn,
      `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE BINARY family_id = BINARY ? ORDER BY BINARY zone_id`,
      [familyId],
    ));
    return rows.map(toSafeZone);
  }

  async listForRecipient(familyId: string, recipientEndpointId: string, keyEpoch: number, cursor?: string): Promise<SafeZoneRecipientPage> {
    if (!isFamilyEpochNumber(keyEpoch, 1)) throw new SafeZoneError('INVALID_INPUT');
    const afterZoneId = safeZoneCursorAfterZoneId(cursor, keyEpoch);
    const { rows } = await runInTransaction((conn) => afterZoneId === undefined
      ? execute<SafeZoneRow>(
        conn,
        `SELECT ${SELECT_COLUMNS} FROM safe_zones
          WHERE BINARY family_id = BINARY ? AND BINARY recipient_endpoint_id = BINARY ? AND key_epoch = ?
          ORDER BY BINARY zone_id LIMIT ?`,
        [familyId, recipientEndpointId, keyEpoch, SAFE_ZONE_DELIVERY_PAGE_SIZE + 1],
      )
      : execute<SafeZoneRow>(
        conn,
        `SELECT ${SELECT_COLUMNS} FROM safe_zones
          WHERE BINARY family_id = BINARY ? AND BINARY recipient_endpoint_id = BINARY ? AND key_epoch = ?
            AND BINARY zone_id > BINARY ?
          ORDER BY BINARY zone_id LIMIT ?`,
        [familyId, recipientEndpointId, keyEpoch, afterZoneId, SAFE_ZONE_DELIVERY_PAGE_SIZE + 1],
      ));
    const pageRows = rows.slice(0, SAFE_ZONE_DELIVERY_PAGE_SIZE);
    const hasMore = rows.length > SAFE_ZONE_DELIVERY_PAGE_SIZE;
    return {
      safeZones: pageRows.map(toSafeZone),
      nextCursor: hasMore ? createSafeZoneDeliveryCursor(keyEpoch, pageRows[pageRows.length - 1]!.zone_id) : null,
    };
  }

  async create(input: NewSafeZone, authority?: SafeZoneMutationAuthoritySnapshot): Promise<SafeZone> {
    // Snapshot first: validation and every SQL write must use exactly the
    // same tuple even if a caller reuses/mutates its request object while the
    // asynchronous connection/transaction setup is pending.
    const safeInput: NewSafeZone = {
      familyId: input.familyId,
      recipientEndpointId: input.recipientEndpointId,
      ciphertextB64: input.ciphertextB64,
      nonceB64: input.nonceB64,
      keyEpoch: input.keyEpoch,
    };
    const safeAuthority = snapshotAuthority(authority);
    validateNewSafeZone(safeInput);
    const zoneId = randomUUID();
    const now = new Date();
    if (safeAuthority !== undefined && safeInput.keyEpoch !== safeAuthority.keyEpoch) throw new SafeZoneAuthorityChangedError();
    await runInTransaction(async (conn) => {
      await this.assertMutationAuthority(conn, safeInput.familyId, safeInput.recipientEndpointId, safeAuthority);
      await execute(conn, `INSERT INTO safe_zones (zone_id, family_id, recipient_endpoint_id, ciphertext, nonce, key_epoch, revision, delivery_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING_OFFLINE', ?, ?)`, [zoneId, safeInput.familyId, safeInput.recipientEndpointId, Buffer.from(safeInput.ciphertextB64, 'base64url'), Buffer.from(safeInput.nonceB64, 'base64url'), safeInput.keyEpoch, now, now]);
    });
    const { rows } = await runInTransaction((conn) => execute<SafeZoneRow>(
      conn,
      `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ?`,
      [zoneId, safeInput.familyId],
    ));
    if (!rows[0]) throw new SafeZoneError('NOT_FOUND');
    return toSafeZone(rows[0]);
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch, authority?: SafeZoneMutationAuthoritySnapshot): Promise<SafeZone> {
    const safePatch: SafeZonePatch = { ...patch };
    const safeAuthority = snapshotAuthority(authority);
    validateSafeZonePatch(safePatch);
    if (safeAuthority !== undefined && safePatch.keyEpoch !== undefined && safePatch.keyEpoch !== safeAuthority.keyEpoch) {
      throw new SafeZoneAuthorityChangedError();
    }
    const row = await runInTransaction(async (conn) => {
      const { rows: targetRows } = await execute<Pick<SafeZoneRow, 'recipient_endpoint_id'>>(
        conn,
        `SELECT recipient_endpoint_id FROM safe_zones WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ?`,
        [zoneId, familyId],
      );
      if (!targetRows[0]) throw new SafeZoneError('NOT_FOUND');
      await this.assertMutationAuthority(conn, familyId, targetRows[0].recipient_endpoint_id, safeAuthority);
      // Serialize concurrent edits for the same family-owned row so keyEpoch
      // can never move backwards, even when two callers race.
      const current = await execute<Pick<SafeZoneRow, 'key_epoch'>>(
        conn,
        `SELECT key_epoch FROM safe_zones WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ? FOR UPDATE`,
        [zoneId, familyId],
      );
      if (!current.rows[0]) throw new SafeZoneError('NOT_FOUND');

      let currentKeyEpoch: number;
      try {
        currentKeyEpoch = familyEpochFromStorage(current.rows[0].key_epoch);
      } catch {
        throw new SafeZoneError('INVALID_INPUT');
      }
      if (!isFamilyEpochNumber(currentKeyEpoch, 1)) throw new SafeZoneError('INVALID_INPUT');
      if (safeAuthority !== undefined && safePatch.keyEpoch === undefined && currentKeyEpoch !== safeAuthority.keyEpoch) {
        throw new SafeZoneAuthorityChangedError();
      }
      if (safePatch.keyEpoch !== undefined && safePatch.keyEpoch < currentKeyEpoch) {
        throw new SafeZoneError('INVALID_INPUT');
      }

      // Sample the update time only after acquiring the row lock. A caller
      // queued behind another edit must not commit a later revision with a
      // timestamp captured before the winning transaction completed.
      const updatedAt = this.now();
      const nextKeyEpoch = safePatch.keyEpoch ?? currentKeyEpoch;
      const updated = await execute(
        conn,
        `UPDATE safe_zones
            SET ciphertext = ?, nonce = ?, key_epoch = ?, revision = revision + 1,
                delivery_state = 'PENDING_OFFLINE', updated_at = ?
          WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ? AND key_epoch = ?`,
        [
          Buffer.from(safePatch.ciphertextB64!, 'base64url'),
          Buffer.from(safePatch.nonceB64!, 'base64url'),
          nextKeyEpoch,
          updatedAt,
          zoneId,
          familyId,
          currentKeyEpoch,
        ],
      );
      if (updated.rowCount !== 1) throw new SafeZoneError('NOT_FOUND');

      const persisted = await execute<SafeZoneRow>(
        conn,
        `SELECT ${SELECT_COLUMNS} FROM safe_zones WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ?`,
        [zoneId, familyId],
      );
      if (!persisted.rows[0]) throw new SafeZoneError('NOT_FOUND');
      return persisted.rows[0];
    });
    return toSafeZone(row);
  }

  async remove(familyId: string, zoneId: string, authority?: SafeZoneMutationAuthoritySnapshot): Promise<boolean> {
    const safeAuthority = snapshotAuthority(authority);
    return runInTransaction(async (conn) => {
      const { rows: targetRows } = await execute<Pick<SafeZoneRow, 'recipient_endpoint_id'>>(
        conn,
        `SELECT recipient_endpoint_id FROM safe_zones WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ?`,
        [zoneId, familyId],
      );
      if (!targetRows[0]) return false;
      await this.assertMutationAuthority(conn, familyId, targetRows[0].recipient_endpoint_id, safeAuthority);
      const { rowCount } = await execute(
        conn,
        `DELETE FROM safe_zones WHERE BINARY zone_id = BINARY ? AND BINARY family_id = BINARY ?`,
        [zoneId, familyId],
      );
      return rowCount > 0;
    });
  }
}
