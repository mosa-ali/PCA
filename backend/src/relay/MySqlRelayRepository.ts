import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { AcknowledgeResult, CreateEnvelopeResult, RelayRepository } from './RelayRepository.js';
import type { MessageId, OpaqueDeviceId, RelayEnvelopeRecord } from './types.js';
import { MAX_CIPHERTEXT_BYTES } from './policy.js';
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

export class MySqlRelayRepository implements RelayRepository {
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
  async createOrMatchEnvelope(record: RelayEnvelopeRecord): Promise<CreateEnvelopeResult> {
    return runInTransaction(async (conn) => {
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
  ): Promise<RelayQueuePage> {
    validateRelayQueuePageInput(input);
    return runInTransaction(async (conn) => {
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
  ): Promise<RelayQueuedRecord[]> {
    if (messageIds.length > MAX_RELAY_SUPPLEMENT_RECORDS) throw new RangeError('Relay supplement bound exceeded.');
    if (messageIds.length === 0) return [];
    const { rows } = await runInTransaction((conn) => execute<QueuedRow>(
      conn,
      `SELECT ${QUEUED_COLUMNS} FROM relay_envelopes
       WHERE recipient_device_id = ? AND family_id = ?
         AND BINARY recipient_device_id = BINARY ? AND BINARY family_id = BINARY ?
         AND state = 'QUEUED' AND expires_at > ?
         AND message_id IN (${messageIds.map(() => '?').join(',')})
       ORDER BY created_at ASC, CAST(message_id AS BINARY) ASC LIMIT ${MAX_RELAY_SUPPLEMENT_RECORDS}`,
      [recipientDeviceId, familyId, recipientDeviceId, familyId, now, ...messageIds],
    ));
    // IN uses the table's PAD SPACE collation. Exact comparison prevents a
    // different trailing-space identifier from masquerading as a predecessor.
    const exactIds = new Set(messageIds);
    return rows.filter((row) => exactIds.has(row.message_id)).map(mapQueuedRow);
  }

  async acknowledgeAtomically(
    recipientDeviceId: OpaqueDeviceId,
    messageId: MessageId,
    acknowledgedAt: Date,
  ): Promise<AcknowledgeResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE relay_envelopes SET state = 'ACKNOWLEDGED', acknowledged_at = ?
         WHERE message_id = ? AND recipient_device_id = ?
           AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?
           AND state = 'QUEUED' AND expires_at > ?`,
        [acknowledgedAt, messageId, recipientDeviceId, messageId, recipientDeviceId, acknowledgedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<RelayRow>(
          conn,
          `SELECT * FROM relay_envelopes
            WHERE message_id = ? AND recipient_device_id = ?
              AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?`,
          [messageId, recipientDeviceId, messageId, recipientDeviceId],
        );
        return { outcome: 'ACKNOWLEDGED', record: mapRow(reread.rows[0]!) };
      }

      const existing = await execute<RelayRow>(
        conn,
        `SELECT * FROM relay_envelopes
          WHERE message_id = ? AND recipient_device_id = ?
            AND BINARY message_id = BINARY ? AND BINARY recipient_device_id = BINARY ?`,
        [messageId, recipientDeviceId, messageId, recipientDeviceId],
      );
      const row = existing.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.state === 'ACKNOWLEDGED') return { outcome: 'ACKNOWLEDGED', record: mapRow(row) };
      return { outcome: 'EXPIRED' };
    });
  }
}
