import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';
import { RelayAuthorityChangedError, type AcknowledgeResult, type CreateEnvelopeResult, type RelayEnvelopeAuthoritySnapshot, type RelayRecipientAuthoritySnapshot, type RelayRepository } from './RelayRepository.js';
import type { MessageId, OpaqueDeviceId, RelayEnvelopeRecord } from './types.js';
import { familyEpochFromStorage, isFamilyEpochNumber } from '../familyepoch/bounds.js';
import { isPlausibleOpaqueId, MAX_CIPHERTEXT_BYTES } from './policy.js';
import { MAX_RELAY_SUPPLEMENT_RECORDS, validateRelayQueuePageInput, type RelayQueuePage, type RelayQueuePageInput, type RelayQueuedRecord, type RelayQueuePosition } from './queuePage.js';

type QueuedRow = Omit<RelayRow, 'ciphertext'> & { ciphertext: Buffer | null };

// Keep oversized/corrupt legacy ciphertext out of the bounded page buffer.
// Returning NULL is diagnostic only; no bytes are truncated or acknowledged.
const QUEUED_COLUMNS = `message_id, family_id, sender_device_id, recipient_device_id,
  CASE WHEN OCTET_LENGTH(ciphertext) <= ${MAX_CIPHERTEXT_BYTES} THEN ciphertext ELSE NULL END AS ciphertext,
  state, created_at, expires_at, acknowledged_at`;

function mapQueuedRow(row: QueuedRow): RelayQueuedRecord {
  return { ...mapRow({ ...row, ciphertext: row.ciphertext ?? Buffer.alloc(0) }), ciphertext: row.ciphertext };
}

interface RelayRow {
  message_id: string;
  family_id: string;
  sender_device_id: string;
  recipient_device_id: string;
  ciphertext: Buffer;
  state: RelayEnvelopeRecord['state'];
  created_at: Date;
  expires_at: Date;
  acknowledged_at: Date | null;
}

function mapRow(row: RelayRow): RelayEnvelopeRecord {
  return {
    messageId: row.message_id,
    familyId: row.family_id,
    senderDeviceId: row.sender_device_id,
    recipientDeviceId: row.recipient_device_id,
    ciphertext: row.ciphertext,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acknowledgedAt: row.acknowledged_at,
  };
}

function snapshotRecipientAuthority(authority: RelayRecipientAuthoritySnapshot | undefined): RelayRecipientAuthoritySnapshot | undefined {
  return authority === undefined ? undefined : { ...authority };
}

function validateRecipientReadAuthority(
  recipientDeviceId: string,
  familyId: string,
  authority: RelayRecipientAuthoritySnapshot | undefined,
  allowMissing: boolean,
): asserts authority is RelayRecipientAuthoritySnapshot | undefined {
  if (authority === undefined) {
    if (!allowMissing) throw new TypeError('MySQL relay read requires an accepted authority snapshot.');
    return;
  }
  if (typeof authority.familyId !== 'string' || authority.familyId.length === 0 || authority.familyId !== familyId ||
      typeof authority.dskKeyId !== 'string' || authority.dskKeyId.length === 0 ||
      !isFamilyEpochNumber(authority.trustSetEpoch, 1) || !isFamilyEpochNumber(authority.keyEpoch, 1) ||
      typeof recipientDeviceId !== 'string' || recipientDeviceId.length === 0) {
    throw new TypeError('Relay recipient read authority snapshot is malformed.');
  }
}

async function lockRecipientReadAuthority(
  conn: PoolConnection,
  recipientDeviceId: string,
  familyId: string,
  authority: RelayRecipientAuthoritySnapshot,
): Promise<void> {
  // Keep the accepted head, active device, and exact DSK stable through the
  // scoped read. This uses the same floor -> device -> key order as Trust Set
  // append, relay ACK, and outbound enqueue.
  const { rows: floors } = await execute<{
    minimum_accepted_trust_set_epoch: number | string | bigint;
    minimum_accepted_key_epoch: number | string | bigint;
  }>(
    conn,
    `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
       FROM family_epoch_floors
      WHERE family_id = ?
      FOR UPDATE`,
    [familyId],
  );
  const floor = floors[0];
  if (!floor ||
      familyEpochFromStorage(floor.minimum_accepted_trust_set_epoch) !== authority.trustSetEpoch ||
      familyEpochFromStorage(floor.minimum_accepted_key_epoch) !== authority.keyEpoch) {
    throw new RelayAuthorityChangedError();
  }

  const { rows: devices } = await execute<{ device_id: string }>(
    conn,
    `SELECT d.device_id
       FROM devices d
       JOIN families f ON f.family_id = d.family_id
      WHERE BINARY d.device_id = BINARY ?
        AND BINARY d.family_id = BINARY ?
        AND d.status = 'ACTIVE'
        AND f.status = 'ACTIVE'
        AND f.deleted_at IS NULL
      FOR UPDATE`,
    [recipientDeviceId, familyId],
  );
  if (devices.length !== 1 || devices[0]?.device_id !== recipientDeviceId) throw new RelayAuthorityChangedError();

  const { rows: keys } = await execute<{ key_id: string }>(
    conn,
    `SELECT key_id
       FROM device_public_keys
      WHERE BINARY device_id = BINARY ?
        AND BINARY key_id = BINARY ?
        AND key_purpose = 'DSK'
        AND status = 'ACTIVE'
      LIMIT 1
      FOR UPDATE`,
    [recipientDeviceId, authority.dskKeyId],
  );
  if (keys.length !== 1 || keys[0]?.key_id !== authority.dskKeyId) throw new RelayAuthorityChangedError();
}

export class MySqlRelayRepository implements RelayRepository {
  private readonly options: { allowMissingAuthorityForTests?: boolean };

  constructor(options: { allowMissingAuthorityForTests?: boolean } = {}) {
    if (options.allowMissingAuthorityForTests === true && process.env.NODE_ENV !== 'test') {
      throw new Error('Missing relay authority is permitted only in the test environment.');
    }
    this.options = options;
  }

  async purgeExpired(now: Date): Promise<number> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `DELETE FROM relay_envelopes WHERE expires_at <= ?`, [now]),
    );
    return rowCount;
  }

  /**
   * The INSERT is atomic at the statement level (InnoDB's primary-key
   * uniqueness check), so two concurrent submissions of the same messageId
   * cannot both "win" -- the loser gets a duplicate-entry error and falls
   * through to comparing against whatever the winner (or an earlier
   * submission) actually stored.
   */
  async createOrMatchEnvelope(record: RelayEnvelopeRecord, authority?: RelayEnvelopeAuthoritySnapshot): Promise<CreateEnvelopeResult> {
    if (authority === undefined && this.options.allowMissingAuthorityForTests !== true) {
      throw new TypeError('MySQL relay enqueue requires an accepted authority snapshot.');
    }
    return runInTransaction(async (conn) => {
      if (authority !== undefined) {
        if (authority.familyId !== record.familyId ||
            authority.sender.deviceId !== record.senderDeviceId ||
            authority.recipient.deviceId !== record.recipientDeviceId ||
            typeof authority.sender.dskKeyId !== 'string' || authority.sender.dskKeyId.length === 0 ||
            typeof authority.recipient.dskKeyId !== 'string' || authority.recipient.dskKeyId.length === 0 ||
            (authority.parentAccountId !== undefined &&
              !isPlausibleOpaqueId(authority.parentAccountId)) ||
            !isFamilyEpochNumber(authority.trustSetEpoch, 1) || !isFamilyEpochNumber(authority.keyEpoch, 1)) {
          throw new TypeError('Relay enqueue authority snapshot is malformed.');
        }

        // A family's floor row serializes this write against Trust Set epoch
        // advancement. Do not rely on the route's async resolver alone: the
        // accepted head may rotate after it returns and before this insert.
        const { rows: floors } = await execute<{
          minimum_accepted_trust_set_epoch: number | string | bigint;
          minimum_accepted_key_epoch: number | string | bigint;
        }>(
          conn,
          `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
             FROM family_epoch_floors
            WHERE family_id = ?
            FOR UPDATE`,
          [authority.familyId],
        );
        const floor = floors[0];
        if (!floor ||
            familyEpochFromStorage(floor.minimum_accepted_trust_set_epoch) !== authority.trustSetEpoch ||
            familyEpochFromStorage(floor.minimum_accepted_key_epoch) !== authority.keyEpoch) {
          throw new RelayAuthorityChangedError();
        }

        // Use a stable lock order for the two member devices, then lock each
        // exact active DSK. This serializes the relay write against device or
        // key revocation without depending on the resolver's earlier reads.
        const expectedDevices = [...new Set([authority.sender.deviceId, authority.recipient.deviceId])].sort();
        const deviceClauses = expectedDevices.map(() => 'BINARY d.device_id = BINARY ?').join(' OR ');
        const { rows: devices } = await execute<{ device_id: string }>(
          conn,
          `SELECT d.device_id
             FROM devices d
             JOIN families f ON f.family_id = d.family_id
            WHERE (${deviceClauses})
              AND BINARY d.family_id = BINARY ?
              AND d.status = 'ACTIVE'
              AND f.status = 'ACTIVE'
              AND f.deleted_at IS NULL
            ORDER BY BINARY d.device_id
            FOR UPDATE`,
          [...expectedDevices, authority.familyId],
        );
        if (devices.length !== expectedDevices.length ||
            expectedDevices.some((deviceId) => devices.filter((row) => row.device_id === deviceId).length !== 1)) {
          throw new RelayAuthorityChangedError();
        }

        const requestedKeys = [
          { deviceId: authority.sender.deviceId, keyId: authority.sender.dskKeyId },
          { deviceId: authority.recipient.deviceId, keyId: authority.recipient.dskKeyId },
        ];
        const expectedKeys = requestedKeys.filter((key, index) =>
          requestedKeys.findIndex((candidate) => candidate.deviceId === key.deviceId && candidate.keyId === key.keyId) === index,
        )
          .sort((left, right) => left.deviceId.localeCompare(right.deviceId) || left.keyId.localeCompare(right.keyId));
        const keyClauses = expectedKeys.map(() => '(BINARY device_id = BINARY ? AND BINARY key_id = BINARY ?)').join(' OR ');
        const keyValues = expectedKeys.flatMap((key) => [key.deviceId, key.keyId]);
        const { rows: keys } = await execute<{ device_id: string; key_id: string }>(
          conn,
          `SELECT device_id, key_id
             FROM device_public_keys
            WHERE (${keyClauses})
              AND key_purpose = 'DSK'
              AND status = 'ACTIVE'
            ORDER BY BINARY device_id, BINARY key_id
            FOR UPDATE`,
          keyValues,
        );
        if (keys.length !== expectedKeys.length || expectedKeys.some((key) =>
          keys.filter((row) => row.device_id === key.deviceId && row.key_id === key.keyId).length !== 1)) {
          throw new RelayAuthorityChangedError();
        }

        // Parent account membership is separate from the browser device's
        // Trust Set role. When the server-authenticated Parent account is
        // part of this snapshot, lock its family membership through relay
        // insertion so a concurrent demotion/revocation has a serial order.
        if (authority.parentAccountId !== undefined) {
          const { rows: memberships } = await execute<{ role: string; status: string }>(
            conn,
            `SELECT role, status
               FROM family_parent_memberships
              WHERE account_id = ? AND family_id = ?
              FOR UPDATE`,
            [authority.parentAccountId, authority.familyId],
          );
          if (memberships.length !== 1 || memberships[0]?.role !== 'ADMINISTRATOR' ||
              memberships[0]?.status !== 'ACTIVE') {
            throw new RelayAuthorityChangedError();
          }
        }
      }
      try {
        await execute(
          conn,
          `INSERT INTO relay_envelopes
             (message_id, family_id, sender_device_id, recipient_device_id, ciphertext, state, created_at, expires_at, acknowledged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.messageId,
            record.familyId,
            record.senderDeviceId,
            record.recipientDeviceId,
            record.ciphertext,
            record.state,
            record.createdAt,
            record.expiresAt,
            record.acknowledgedAt,
          ],
        );
        const inserted = await execute<RelayRow>(conn, `SELECT * FROM relay_envelopes WHERE message_id = ?`, [
          record.messageId,
        ]);
        return { outcome: 'CREATED', record: mapRow(inserted.rows[0]!) };
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
      }

      const existing = await execute<RelayRow>(conn, `SELECT * FROM relay_envelopes WHERE message_id = ?`, [
        record.messageId,
      ]);
      const row = existing.rows[0];
      if (!row) throw new Error('relay envelope insert conflicted but no existing row was found');
      const matches =
        // utf8mb4_bin is PAD SPACE in the deployed schema, so the unique key
        // can report a collision for two JS-distinct IDs that differ only by
        // trailing spaces. Treat that collision as CONFLICT, never as an
        // exact idempotent replay.
        row.message_id === record.messageId &&
        row.family_id === record.familyId &&
        row.sender_device_id === record.senderDeviceId &&
        row.recipient_device_id === record.recipientDeviceId &&
        row.ciphertext.equals(record.ciphertext);
      return matches ? { outcome: 'IDEMPOTENT_MATCH', record: mapRow(row) } : { outcome: 'CONFLICT' };
    });
  }

  async findForRecipient(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<RelayRow>(conn, `SELECT * FROM relay_envelopes
        WHERE message_id = ? AND recipient_device_id = ?
          AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?`, [
        messageId,
        recipientDeviceId,
        messageId,
        recipientDeviceId,
      ]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listQueuedForRecipient(recipientDeviceId: OpaqueDeviceId, now: Date): Promise<RelayEnvelopeRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RelayRow>(
        conn,
        `SELECT * FROM relay_envelopes
          WHERE recipient_device_id = ? AND state = 'QUEUED' AND expires_at > ?
            AND BINARY recipient_device_id = BINARY ?`,
        [recipientDeviceId, now, recipientDeviceId],
      ),
    );
    return rows.map(mapRow);
  }

  async listQueuedPageForRecipient(
    recipientDeviceId: OpaqueDeviceId, familyId: string, now: Date, input: RelayQueuePageInput,
    authority?: RelayRecipientAuthoritySnapshot,
  ): Promise<RelayQueuePage> {
    validateRelayQueuePageInput(input);
    const safeAuthority = snapshotRecipientAuthority(authority);
    validateRecipientReadAuthority(recipientDeviceId, familyId, safeAuthority, this.options.allowMissingAuthorityForTests === true);
    return runInTransaction(async (conn) => {
      if (safeAuthority !== undefined) await lockRecipientReadAuthority(conn, recipientDeviceId, familyId, safeAuthority);
      let highWater: RelayQueuePosition | null = input.highWater;
      if (highWater === null) {
        const highest = await execute<Pick<RelayRow, 'created_at' | 'message_id'>>(
          conn,
          `SELECT created_at, message_id FROM relay_envelopes
           WHERE recipient_device_id = ? AND family_id = ?
             AND BINARY recipient_device_id = BINARY ? AND BINARY family_id = BINARY ?
             AND state = 'QUEUED' AND expires_at > ?
           ORDER BY created_at DESC, CAST(message_id AS BINARY) DESC LIMIT 1`,
          [recipientDeviceId, familyId, recipientDeviceId, familyId, now],
        );
        const row = highest.rows[0];
        if (!row) return { records: [], highWater: null, hasMore: false };
        highWater = { createdAtMs: row.created_at.getTime(), messageId: row.message_id };
      }
      const upperDate = new Date(highWater.createdAtMs);
      const values: Array<string | number | Date> = [recipientDeviceId, familyId, recipientDeviceId, familyId,
        now, upperDate, upperDate, highWater.messageId];
      let lowerClause = '';
      if (input.after !== null) {
        lowerClause = `AND (created_at > ? OR (created_at = ? AND CAST(message_id AS BINARY) > CAST(? AS BINARY)))`;
        const lowerDate = new Date(input.after.createdAtMs);
        values.push(lowerDate, lowerDate, input.after.messageId);
      }
      // Existing indexes establish scope/expiry but do not prove bounded
      // database scan/sort cost. LIMIT bounds returned records and memory.
      const result = await execute<QueuedRow>(
        conn,
        `SELECT ${QUEUED_COLUMNS} FROM relay_envelopes
         WHERE recipient_device_id = ? AND family_id = ?
           AND BINARY recipient_device_id = BINARY ? AND BINARY family_id = BINARY ?
           AND state = 'QUEUED' AND expires_at > ?
           AND (created_at < ? OR (created_at = ? AND CAST(message_id AS BINARY) <= CAST(? AS BINARY)))
           ${lowerClause}
         ORDER BY created_at ASC, CAST(message_id AS BINARY) ASC LIMIT ${input.limit + 1}`,
        values,
      );
      return { records: result.rows.slice(0, input.limit).map(mapQueuedRow), highWater, hasMore: result.rows.length > input.limit };
    });
  }

  async findQueuedForRecipient(
    recipientDeviceId: OpaqueDeviceId, familyId: string, messageIds: readonly MessageId[], now: Date,
    authority?: RelayRecipientAuthoritySnapshot,
  ): Promise<RelayQueuedRecord[]> {
    if (messageIds.length > MAX_RELAY_SUPPLEMENT_RECORDS) throw new RangeError('Relay supplement bound exceeded.');
    const safeAuthority = snapshotRecipientAuthority(authority);
    validateRecipientReadAuthority(recipientDeviceId, familyId, safeAuthority, this.options.allowMissingAuthorityForTests === true);
    if (messageIds.length === 0) return [];
    const { rows } = await runInTransaction(async (conn) => {
      if (safeAuthority !== undefined) await lockRecipientReadAuthority(conn, recipientDeviceId, familyId, safeAuthority);
      return execute<QueuedRow>(
        conn,
        `SELECT ${QUEUED_COLUMNS} FROM relay_envelopes
         WHERE recipient_device_id = ? AND family_id = ?
           AND BINARY recipient_device_id = BINARY ? AND BINARY family_id = BINARY ?
           AND state = 'QUEUED' AND expires_at > ?
           AND message_id IN (${messageIds.map(() => '?').join(',')})
         ORDER BY created_at ASC, CAST(message_id AS BINARY) ASC LIMIT ${MAX_RELAY_SUPPLEMENT_RECORDS}`,
        [recipientDeviceId, familyId, recipientDeviceId, familyId, now, ...messageIds],
      );
    });
    // IN uses the table's PAD SPACE collation. Exact comparison prevents a
    // different trailing-space identifier from masquerading as a predecessor.
    const exactIds = new Set(messageIds);
    return rows.filter((row) => exactIds.has(row.message_id)).map(mapQueuedRow);
  }

  async acknowledgeAtomically(
    recipientDeviceId: OpaqueDeviceId,
    messageId: MessageId,
    acknowledgedAt: Date,
    authority?: RelayRecipientAuthoritySnapshot,
  ): Promise<AcknowledgeResult> {
    if (authority === undefined && this.options.allowMissingAuthorityForTests !== true) {
      throw new TypeError('MySQL relay acknowledgement requires an accepted authority snapshot.');
    }
    // Detach this request before connection acquisition can yield. The
    // accepted family/key/head tuple is part of the ACK authorization and
    // must remain the exact snapshot resolved by the authenticated route.
    const safeAuthority = snapshotRecipientAuthority(authority);
    return runInTransaction(async (conn) => {
      if (safeAuthority !== undefined) {
        if (typeof safeAuthority.familyId !== 'string' || safeAuthority.familyId.length === 0 ||
            typeof safeAuthority.dskKeyId !== 'string' || safeAuthority.dskKeyId.length === 0 ||
            !isFamilyEpochNumber(safeAuthority.trustSetEpoch, 1) || !isFamilyEpochNumber(safeAuthority.keyEpoch, 1)) {
          throw new TypeError('Relay recipient authority snapshot is malformed.');
        }

        // Serialize ACK against accepted-head advancement using the same
        // floor -> device -> key lock order used by Trust Set writes.
        const { rows: floors } = await execute<{
          minimum_accepted_trust_set_epoch: number | string | bigint;
          minimum_accepted_key_epoch: number | string | bigint;
        }>(
          conn,
          `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
             FROM family_epoch_floors
            WHERE family_id = ?
            FOR UPDATE`,
          [safeAuthority.familyId],
        );
        const floor = floors[0];
        if (!floor ||
            familyEpochFromStorage(floor.minimum_accepted_trust_set_epoch) !== safeAuthority.trustSetEpoch ||
            familyEpochFromStorage(floor.minimum_accepted_key_epoch) !== safeAuthority.keyEpoch) {
          throw new RelayAuthorityChangedError();
        }

        const { rows: devices } = await execute<{ device_id: string }>(
          conn,
          `SELECT d.device_id
             FROM devices d
             JOIN families f ON f.family_id = d.family_id
            WHERE d.device_id = ?
              AND d.family_id = ?
              AND d.status = 'ACTIVE'
              AND f.status = 'ACTIVE'
              AND f.deleted_at IS NULL
            FOR UPDATE`,
          [recipientDeviceId, safeAuthority.familyId],
        );
        if (!devices[0]) throw new RelayAuthorityChangedError();

        const { rows: keys } = await execute<{ key_id: string }>(
          conn,
          `SELECT key_id
             FROM device_public_keys
            WHERE device_id = ?
              AND key_id = ?
              AND key_purpose = 'DSK'
              AND status = 'ACTIVE'
            LIMIT 1
            FOR UPDATE`,
          [recipientDeviceId, safeAuthority.dskKeyId],
        );
        if (keys.length !== 1) throw new RelayAuthorityChangedError();
      }

      const familyPredicate = safeAuthority === undefined ? '' : 'AND family_id = ? AND BINARY family_id = BINARY ?';
      const familyParameters = safeAuthority === undefined ? [] : [safeAuthority.familyId, safeAuthority.familyId];
      const updated = await execute(
        conn,
        `UPDATE relay_envelopes SET state = 'ACKNOWLEDGED', acknowledged_at = ?
         WHERE message_id = ? AND recipient_device_id = ?
           AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?
           ${familyPredicate}
           AND state = 'QUEUED' AND expires_at > ?`,
        [acknowledgedAt, messageId, recipientDeviceId, messageId, recipientDeviceId, ...familyParameters, acknowledgedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<RelayRow>(
          conn,
          `SELECT * FROM relay_envelopes
            WHERE message_id = ? AND recipient_device_id = ?
              AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?
              ${safeAuthority === undefined ? '' : 'AND family_id = ? AND BINARY family_id = BINARY ?'}`,
          [messageId, recipientDeviceId, messageId, recipientDeviceId, ...familyParameters],
        );
        return { outcome: 'ACKNOWLEDGED', record: mapRow(reread.rows[0]!) };
      }

      const existing = await execute<RelayRow>(
        conn,
        `SELECT * FROM relay_envelopes
          WHERE message_id = ? AND recipient_device_id = ?
            AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?
            ${safeAuthority === undefined ? '' : 'AND family_id = ? AND BINARY family_id = BINARY ?'}`,
        [messageId, recipientDeviceId, messageId, recipientDeviceId, ...familyParameters],
      );
      const row = existing.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.state === 'ACKNOWLEDGED') return { outcome: 'ACKNOWLEDGED', record: mapRow(row) };
      return { outcome: 'EXPIRED' };
    });
  }
}
