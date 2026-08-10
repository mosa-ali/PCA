import { runInTransaction } from '../db/pool.js';
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

export class PostgresRelayRepository implements RelayRepository {
  /**
   * INSERT ... ON CONFLICT DO NOTHING is atomic at the statement level, so
   * two concurrent submissions of the same messageId cannot both "win" the
   * insert -- the loser's statement affects zero rows and falls through to
   * comparing against whatever the winner (or an earlier submission)
   * actually stored.
   */
  async createOrMatchEnvelope(record: RelayEnvelopeRecord): Promise<CreateEnvelopeResult> {
    return runInTransaction(async (client) => {
      const inserted = await client.query<RelayRow>(
        `INSERT INTO relay_envelopes
           (message_id, family_id, sender_device_id, recipient_device_id, ciphertext, state, created_at, expires_at, acknowledged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (message_id) DO NOTHING
         RETURNING *`,
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
      if (inserted.rows[0]) return { outcome: 'CREATED', record: mapRow(inserted.rows[0]) };

      const existing = await client.query<RelayRow>(`SELECT * FROM relay_envelopes WHERE message_id = $1`, [
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
    const { rows } = await runInTransaction((client) =>
      client.query<RelayRow>(`SELECT * FROM relay_envelopes WHERE message_id = $1 AND recipient_device_id = $2`, [
        messageId,
        recipientDeviceId,
      ]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listQueuedForRecipient(recipientDeviceId: OpaqueDeviceId, now: Date): Promise<RelayEnvelopeRecord[]> {
    const { rows } = await runInTransaction((client) =>
      client.query<RelayRow>(
        `SELECT * FROM relay_envelopes WHERE recipient_device_id = $1 AND state = 'QUEUED' AND expires_at > $2`,
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
    return runInTransaction(async (client) => {
      const updated = await client.query<RelayRow>(
        `UPDATE relay_envelopes SET state = 'ACKNOWLEDGED', acknowledged_at = $3
         WHERE message_id = $1 AND recipient_device_id = $2 AND state = 'QUEUED' AND expires_at > $3
         RETURNING *`,
        [messageId, recipientDeviceId, acknowledgedAt],
      );
      if (updated.rows[0]) return { outcome: 'ACKNOWLEDGED', record: mapRow(updated.rows[0]) };

      const existing = await client.query<RelayRow>(
        `SELECT * FROM relay_envelopes WHERE message_id = $1 AND recipient_device_id = $2`,
        [messageId, recipientDeviceId],
      );
      const row = existing.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.state === 'ACKNOWLEDGED') return { outcome: 'ACKNOWLEDGED', record: mapRow(row) };
      return { outcome: 'EXPIRED' };
    });
  }
}
