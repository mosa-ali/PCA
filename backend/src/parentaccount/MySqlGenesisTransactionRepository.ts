import { createHash, randomUUID } from 'node:crypto';
import { execute, runInTransaction, SoftFailure } from '../db/pool.js';
import { GenesisTransactionError, type GenesisTransactionRepository, type GenesisCompletionArtifacts } from './GenesisTransactionRepository.js';

/**
 * MySQL implementation of the PCA-DEC-020-R1 genesis boundary. The order is
 * deliberately boring: lock the challenge and account first, then create all
 * dependent rows, and consume the challenge last. Any exception from any
 * statement rolls the entire transaction back through runInTransaction.
 */
export class MySqlGenesisTransactionRepository implements GenesisTransactionRepository {
  async completeAtomically(input: GenesisCompletionArtifacts): Promise<void> {
    await runInTransaction(async (conn) => {
      const challengeResult = await execute<{
        account_id: string;
        service_account_id: string;
        family_id: string;
        candidate_device_id: string;
        candidate_key_id: string;
        candidate_public_key: string;
        candidate_platform: 'ANDROID' | 'IOS' | 'BROWSER';
        nonce: string;
        operation: 'GENESIS';
        protocol_version: 1;
        created_at: Date;
        expires_at: Date;
        consumed_at: Date | null;
      }>(conn, `SELECT * FROM parent_genesis_challenges WHERE challenge_id = ? FOR UPDATE`, [input.challenge.challengeId]);
      const challenge = challengeResult.rows[0];
      if (!challenge) throw new SoftFailure('CHALLENGE_NOT_FOUND');
      if (challenge.consumed_at !== null) throw new SoftFailure('CHALLENGE_ALREADY_CONSUMED');
      if (challenge.expires_at.getTime() <= input.consumedAt.getTime()) throw new SoftFailure('CHALLENGE_EXPIRED');
      if (
        challenge.account_id !== input.challenge.accountId ||
        challenge.service_account_id !== input.challenge.serviceAccountId ||
        challenge.family_id !== input.challenge.familyId ||
        challenge.candidate_device_id !== input.challenge.candidateDeviceId ||
        challenge.candidate_key_id !== input.challenge.candidateKeyId ||
        challenge.candidate_public_key !== input.challenge.candidatePublicKey ||
        challenge.candidate_platform !== input.challenge.candidatePlatform ||
        challenge.nonce !== input.challenge.nonce
      ) {
        throw new SoftFailure('INVALID_ATOMIC_STATE');
      }

      const accountResult = await execute<{ account_id: string; family_id: string | null; service_account_id: string | null; status: string }>(
        conn,
        `SELECT account_id, family_id, service_account_id, status FROM parent_accounts WHERE account_id = ? FOR UPDATE`,
        [input.challenge.accountId],
      );
      const account = accountResult.rows[0];
      if (!account || account.status !== 'VERIFIED') throw new SoftFailure('ACCOUNT_NOT_FOUND');
      if (account.service_account_id !== input.challenge.serviceAccountId) throw new SoftFailure('INVALID_ATOMIC_STATE');
      if (account.family_id !== null) throw new SoftFailure('ACCOUNT_ALREADY_BOUND');

      const serviceAccount = await execute<{ account_id: string }>(conn, `SELECT account_id FROM service_accounts WHERE account_id = ? FOR UPDATE`, [
        input.challenge.serviceAccountId,
      ]);
      if (!serviceAccount.rows[0]) throw new SoftFailure('SERVICE_ACCOUNT_NOT_FOUND');

      const familyReferenceHash = createHash('sha256').update(input.anchor.familyId, 'utf8').digest();
      try {
        await execute(
          conn,
          `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, ?)`,
          [input.anchor.familyId, familyReferenceHash, input.consumedAt],
        );
        await execute(
          conn,
          `INSERT INTO devices
             (device_id, family_id, platform, status, created_at, revoked_at, paired_at, paired_by_account_id, registered_by_account_id)
           VALUES (?, ?, ?, 'ACTIVE', ?, NULL, ?, ?, ?)`,
          [input.anchor.genesisDeviceId, input.anchor.familyId, input.challenge.candidatePlatform, input.consumedAt, input.consumedAt, input.challenge.serviceAccountId, input.challenge.serviceAccountId],
        );
        await execute(
          conn,
          `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
           VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
          [input.anchor.genesisDeviceId, input.anchor.genesisDskKeyId, input.anchor.genesisDskPublicKey, input.consumedAt],
        );
        await execute(
          conn,
          `INSERT INTO service_account_family_scopes (account_id, family_id, status, created_at)
           VALUES (?, ?, 'ACTIVE', ?)`,
          [input.challenge.serviceAccountId, input.anchor.familyId, input.consumedAt],
        );
        await execute(
          conn,
          `INSERT INTO family_parent_memberships
             (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ADMINISTRATOR', 'ACTIVE', ?, ?)`,
          [randomUUID(), input.anchor.familyId, input.challenge.accountId, input.challenge.serviceAccountId, input.consumedAt, input.consumedAt],
        );
        const accountUpdate = await execute(
          conn,
          `UPDATE parent_accounts SET family_id = ? WHERE account_id = ? AND family_id IS NULL`,
          [input.anchor.familyId, input.challenge.accountId],
        );
        if (accountUpdate.rowCount !== 1) throw new SoftFailure('ACCOUNT_ALREADY_BOUND');
        await execute(
          conn,
          `INSERT INTO family_authority_genesis_anchors
             (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, created_at, signature)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [input.anchor.familyId, input.anchor.genesisDeviceId, input.anchor.genesisDskKeyId, input.anchor.genesisDskPublicKey, input.anchor.protocolVersion, input.anchor.createdAt, input.anchor.signature],
        );
        await execute(
          conn,
          `INSERT INTO family_authority_attestations
             (family_id, attestation_id, attestation_revision, owner_device_id, owner_dsk_key_id, owner_dsk_public_key,
              trust_set_epoch, key_epoch, issued_at, expires_at, previous_attestation_id,
              signer_device_id, signer_dsk_key_id, signer_dsk_public_key, signature)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            input.attestation.familyId,
            input.attestationId,
            input.attestation.ownerDeviceId,
            input.attestation.ownerDskKeyId,
            input.attestation.ownerDskPublicKey,
            input.attestation.trustSetEpoch,
            input.attestation.keyEpoch,
            input.attestation.issuedAt,
            input.attestation.expiresAt,
            input.attestation.signerDeviceId,
            input.attestation.signerDskKeyId,
            input.attestation.signerDskPublicKey,
            input.attestation.signature,
          ],
        );
        await execute(
          conn,
          `INSERT INTO family_authority_chain_heads
             (family_id, head_attestation_id, head_revision, required_trust_set_epoch, required_key_epoch, status, updated_at)
           VALUES (?, ?, 1, ?, ?, 'ACTIVE', ?)`,
          [input.attestation.familyId, input.attestationId, input.attestation.trustSetEpoch, input.attestation.keyEpoch, input.consumedAt],
        );
      } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY') {
          throw new SoftFailure('GENESIS_ALREADY_EXISTS');
        }
        throw error;
      }

      const consumed = await execute(
        conn,
        `UPDATE parent_genesis_challenges SET consumed_at = ?
         WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?`,
        [input.consumedAt, input.challenge.challengeId, input.consumedAt],
      );
      if (consumed.rowCount !== 1) throw new SoftFailure('CHALLENGE_ALREADY_CONSUMED');
    }).catch((error: unknown) => {
      if (error instanceof SoftFailure) throw new GenesisTransactionError(error.outcome as never);
      throw error;
    });
  }
}
