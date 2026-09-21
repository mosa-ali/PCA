import { execute, runInTransaction } from '../db/pool.js';
import type { GenesisStepUpAuthorization, GenesisStepUpRepository, NewGenesisStepUpAuthorization } from './GenesisStepUpRepository.js';

interface GenesisStepUpRow {
  authorization_id: string;
  account_id: string;
  service_account_id: string;
  session_id_hash: string;
  operation: 'FAMILY_GENESIS';
  code_hash: string;
  created_at: Date;
  expires_at: Date;
  attempt_count: number;
  verified_at: Date | null;
  consumed_at: Date | null;
}

function mapRow(row: GenesisStepUpRow): GenesisStepUpAuthorization {
  return {
    authorizationId: row.authorization_id,
    accountId: row.account_id,
    serviceAccountId: row.service_account_id,
    sessionIdHash: row.session_id_hash,
    operation: row.operation,
    codeHash: row.code_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    attemptCount: row.attempt_count,
    verifiedAt: row.verified_at,
    consumedAt: row.consumed_at,
  };
}

export class MySqlGenesisStepUpRepository implements GenesisStepUpRepository {
  async create(record: NewGenesisStepUpAuthorization): Promise<void> {
    await runInTransaction((conn) => execute(conn, `
      INSERT INTO parent_genesis_step_up_authorizations
        (authorization_id, account_id, service_account_id, session_id_hash, operation, code_hash, created_at, expires_at, attempt_count, verified_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
    `, [
      record.authorizationId,
      record.accountId,
      record.serviceAccountId,
      record.sessionIdHash,
      record.operation,
      record.codeHash,
      record.createdAt,
      record.expiresAt,
    ]));
  }

  async findLatestForSession(input: { accountId: string; serviceAccountId: string; sessionIdHash: string }): Promise<GenesisStepUpAuthorization | null> {
    const result = await runInTransaction((conn) => execute<GenesisStepUpRow>(conn, `
      SELECT * FROM parent_genesis_step_up_authorizations
      WHERE account_id = ? AND service_account_id = ? AND session_id_hash = ?
      ORDER BY created_at DESC, authorization_id DESC
      LIMIT 1
    `, [input.accountId, input.serviceAccountId, input.sessionIdHash]));
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async incrementAttempt(authorizationId: string): Promise<void> {
    await runInTransaction((conn) => execute(conn,
      `UPDATE parent_genesis_step_up_authorizations SET attempt_count = attempt_count + 1 WHERE authorization_id = ?`,
      [authorizationId],
    ));
  }

  async verifyCodeAtomically(authorizationId: string, verifiedAt: Date): Promise<boolean> {
    const result = await runInTransaction((conn) => execute(conn, `
      UPDATE parent_genesis_step_up_authorizations
      SET verified_at = ?
      WHERE authorization_id = ? AND verified_at IS NULL AND consumed_at IS NULL AND expires_at > ?
    `, [verifiedAt, authorizationId, verifiedAt]));
    return result.rowCount === 1;
  }

  async findVerifiedForSession(input: { accountId: string; serviceAccountId: string; sessionIdHash: string; now: Date }): Promise<GenesisStepUpAuthorization | null> {
    const result = await runInTransaction((conn) => execute<GenesisStepUpRow>(conn, `
      SELECT * FROM parent_genesis_step_up_authorizations
      WHERE account_id = ? AND service_account_id = ? AND session_id_hash = ?
        AND operation = 'FAMILY_GENESIS' AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at > ?
      ORDER BY verified_at DESC, authorization_id DESC
      LIMIT 1
    `, [input.accountId, input.serviceAccountId, input.sessionIdHash, input.now]));
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async consumeAtomically(input: {
    authorizationId: string;
    accountId: string;
    serviceAccountId: string;
    sessionIdHash: string;
    operation: 'FAMILY_GENESIS';
    consumedAt: Date;
  }): Promise<boolean> {
    const result = await runInTransaction((conn) => execute(conn, `
      UPDATE parent_genesis_step_up_authorizations
      SET consumed_at = ?
      WHERE authorization_id = ? AND account_id = ? AND service_account_id = ?
        AND session_id_hash = ? AND operation = ? AND verified_at IS NOT NULL
        AND consumed_at IS NULL AND expires_at > ?
    `, [
      input.consumedAt,
      input.authorizationId,
      input.accountId,
      input.serviceAccountId,
      input.sessionIdHash,
      input.operation,
      input.consumedAt,
    ]));
    return result.rowCount === 1;
  }
}
