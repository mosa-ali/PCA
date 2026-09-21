import { execute, runInTransaction } from '../db/pool.js';
import type { GenesisChallengeRecord } from './genesisProtocol.js';
import type { ConsumeGenesisChallengeResult, GenesisChallengeRepository } from './GenesisChallengeRepository.js';

interface GenesisChallengeRow {
  challenge_id: string;
  account_id: string;
  service_account_id: string;
  family_id: string;
  candidate_device_id: string;
  candidate_key_id: string;
  candidate_public_key: string;
  candidate_platform: 'ANDROID' | 'IOS' | 'BROWSER';
  genesis_authorization_id: string | null;
  nonce: string;
  operation: 'GENESIS';
  protocol_version: 1;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function mapRow(row: GenesisChallengeRow): GenesisChallengeRecord {
  return {
    challengeId: row.challenge_id,
    accountId: row.account_id,
    serviceAccountId: row.service_account_id,
    familyId: row.family_id,
    candidateDeviceId: row.candidate_device_id,
    candidateKeyId: row.candidate_key_id,
    candidatePublicKey: row.candidate_public_key,
    candidatePlatform: row.candidate_platform,
    genesisAuthorizationId: row.genesis_authorization_id ?? '',
    nonce: row.nonce,
    operation: row.operation,
    protocolVersion: row.protocol_version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export class MySqlGenesisChallengeRepository implements GenesisChallengeRepository {
  async create(record: GenesisChallengeRecord): Promise<void> {
    await runInTransaction((conn) => execute(conn, `INSERT INTO parent_genesis_challenges
      (challenge_id, account_id, service_account_id, family_id, candidate_device_id, candidate_key_id,
       candidate_public_key, candidate_platform, genesis_authorization_id, nonce, operation, protocol_version, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      record.challengeId, record.accountId, record.serviceAccountId, record.familyId, record.candidateDeviceId,
      record.candidateKeyId, record.candidatePublicKey, record.candidatePlatform, record.genesisAuthorizationId, record.nonce, record.operation, record.protocolVersion,
      record.createdAt, record.expiresAt, record.consumedAt,
    ]));
  }

  async findById(challengeId: string): Promise<GenesisChallengeRecord | null> {
    const { rows } = await runInTransaction((conn) => execute<GenesisChallengeRow>(conn,
      `SELECT * FROM parent_genesis_challenges WHERE challenge_id = ?`, [challengeId]));
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async consumeAtomically(challengeId: string, consumedAt: Date): Promise<ConsumeGenesisChallengeResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(conn, `UPDATE parent_genesis_challenges
        SET consumed_at = ?
        WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?`, [consumedAt, challengeId, consumedAt]);
      if (updated.rowCount > 0) {
        const { rows } = await execute<GenesisChallengeRow>(conn,
          `SELECT * FROM parent_genesis_challenges WHERE challenge_id = ?`, [challengeId]);
        return { outcome: 'CONSUMED', challenge: mapRow(rows[0]!) };
      }
      const { rows } = await execute<GenesisChallengeRow>(conn,
        `SELECT * FROM parent_genesis_challenges WHERE challenge_id = ?`, [challengeId]);
      const row = rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.consumed_at) return { outcome: 'ALREADY_CONSUMED' };
      return { outcome: 'EXPIRED' };
    });
  }
}
