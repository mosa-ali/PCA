import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { AcknowledgeResult, CreateEnvelopeResult, RelayRepository } from './RelayRepository.js';
import type { MessageId, OpaqueDeviceId, RelayEnvelopeRecord } from './types.js';

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
        row.family_id === record.familyId &&
        row.sender_device_id === record.senderDeviceId &&
        row.recipient_device_id === record.recipientDeviceId &&
        row.ciphertext.equals(record.ciphertext);
      return matches ? { outcome: 'IDEMPOTENT_MATCH', record: mapRow(row) } : { outcome: 'CONFLICT' };
    });
  }

  async findForRecipient(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<RelayRow>(conn, `SELECT * FROM relay_envelopes WHERE message_id = ? AND recipient_device_id = ?`, [
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
        `SELECT * FROM relay_envelopes WHERE recipient_device_id = ? AND state = 'QUEUED' AND expires_at > ?`,
        [recipientDeviceId, now],
      ),
    );
    return rows.map(mapRow);
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
         WHERE message_id = ? AND recipient_device_id = ? AND state = 'QUEUED' AND expires_at > ?`,
        [acknowledgedAt, messageId, recipientDeviceId, acknowledgedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<RelayRow>(
          conn,
          `SELECT * FROM relay_envelopes WHERE message_id = ? AND recipient_device_id = ?`,
          [messageId, recipientDeviceId],
        );
        return { outcome: 'ACKNOWLEDGED', record: mapRow(reread.rows[0]!) };
      }

      const existing = await execute<RelayRow>(
        conn,
        `SELECT * FROM relay_envelopes WHERE message_id = ? AND recipient_device_id = ?`,
        [messageId, recipientDeviceId],
      );
      const row = existing.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.state === 'ACKNOWLEDGED') return { outcome: 'ACKNOWLEDGED', record: mapRow(row) };
      return { outcome: 'EXPIRED' };
    });
  }
}
