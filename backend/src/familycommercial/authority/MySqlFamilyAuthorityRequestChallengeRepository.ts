import { execute, runInTransaction } from '../../db/pool.js';
import type {
  ConsumeFamilyAuthorityRequestChallengeResult,
  FamilyAuthorityRequestChallengeRecord,
  FamilyAuthorityRequestChallengeRepository,
} from './FamilyAuthorityRequestChallengeRepository.js';
import type { FamilyAuthorityRequestProofFields } from './requestProofProtocol.js';

interface RequestChallengeRow {
  challenge_id: string;
  service_account_id: string;
  family_id: string;
  device_id: string;
  key_id: string;
  public_key: string;
  operation: string;
  nonce: string;
  request_digest: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function mapRow(row: RequestChallengeRow): FamilyAuthorityRequestChallengeRecord {
  return {
    protocolVersion: 1,
    operation: row.operation,
    serviceAccountId: row.service_account_id,
    familyId: row.family_id,
    deviceId: row.device_id,
    keyId: row.key_id,
    publicKey: row.public_key,
    challengeId: row.challenge_id,
    nonce: row.nonce,
    requestDigest: row.request_digest,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export class MySqlFamilyAuthorityRequestChallengeRepository implements FamilyAuthorityRequestChallengeRepository {
  async create(record: FamilyAuthorityRequestChallengeRecord): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO family_authority_request_challenges
          (challenge_id, service_account_id, family_id, device_id, key_id, public_key, operation,
           protocol_version, nonce, request_digest, issued_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.challengeId,
          record.serviceAccountId,
          record.familyId,
          record.deviceId,
          record.keyId,
          record.publicKey,
          record.operation,
          record.protocolVersion,
          record.nonce,
          record.requestDigest,
          record.issuedAt,
          record.expiresAt,
          record.consumedAt,
        ],
      ),
    );
  }

  async findById(challengeId: string): Promise<FamilyAuthorityRequestChallengeRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<RequestChallengeRow>(conn, `SELECT * FROM family_authority_request_challenges WHERE challenge_id = ?`, [challengeId]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async consumeAtomically(
    fields: FamilyAuthorityRequestProofFields,
    consumedAt: Date,
  ): Promise<ConsumeFamilyAuthorityRequestChallengeResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE family_authority_request_challenges
         SET consumed_at = ?
         WHERE challenge_id = ? AND protocol_version = 1 AND operation = ?
           AND service_account_id = ? AND family_id = ? AND device_id = ? AND key_id = ?
           AND public_key = ? AND nonce = ? AND request_digest = ?
           AND issued_at = ? AND expires_at = ? AND consumed_at IS NULL AND expires_at > ?`,
        [
          consumedAt,
          fields.challengeId,
          fields.operation,
          fields.serviceAccountId,
          fields.familyId,
          fields.deviceId,
          fields.keyId,
          fields.publicKey,
          fields.nonce,
          fields.requestDigest,
          fields.issuedAt,
          fields.expiresAt,
          consumedAt,
        ],
      );
      if (updated.rowCount > 0) {
        const { rows } = await execute<RequestChallengeRow>(conn, `SELECT * FROM family_authority_request_challenges WHERE challenge_id = ?`, [
          fields.challengeId,
        ]);
        return { outcome: 'CONSUMED', challenge: mapRow(rows[0]!) };
      }

      const { rows } = await execute<RequestChallengeRow>(conn, `SELECT * FROM family_authority_request_challenges WHERE challenge_id = ?`, [
        fields.challengeId,
      ]);
      const row = rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.consumed_at) return { outcome: 'ALREADY_CONSUMED' };
      if (row.expires_at.getTime() <= consumedAt.getTime()) return { outcome: 'EXPIRED' };
      return { outcome: 'MISMATCH' };
    });
  }
}
