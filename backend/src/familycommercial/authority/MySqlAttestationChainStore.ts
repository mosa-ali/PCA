import { execute, isDuplicateEntry, runInTransaction, SoftFailure } from '../../db/pool.js';
import { OWNER_ATTESTATION_DOMAIN } from './types.js';
import type { AttestationId, FamilyAuthorityChainHead, FamilyAuthorityChainHeadStatus, FamilyOwnerAttestation } from './types.js';
import type { OpaqueFamilyId } from '../../familytrustset/types.js';
import type { AppendAttestationResult, FamilyAuthorityAttestationChainStore } from './AttestationChainStore.js';

interface AttestationRow {
  family_id: string;
  attestation_id: string;
  attestation_revision: number;
  owner_device_id: string;
  owner_dsk_key_id: string;
  owner_dsk_public_key: string;
  trust_set_epoch: number;
  key_epoch: number;
  issued_at: Date;
  expires_at: Date;
  previous_attestation_id: string | null;
  signer_device_id: string;
  signer_dsk_key_id: string;
  signer_dsk_public_key: string;
  signature: string;
}

interface ChainHeadRow {
  family_id: string;
  head_attestation_id: string;
  head_revision: number;
  status: FamilyAuthorityChainHeadStatus;
  updated_at: Date;
}

function mapAttestationRow(row: AttestationRow): FamilyOwnerAttestation {
  return {
    familyId: row.family_id,
    purpose: OWNER_ATTESTATION_DOMAIN,
    attestationRevision: row.attestation_revision,
    ownerDeviceId: row.owner_device_id,
    ownerDskKeyId: row.owner_dsk_key_id,
    ownerDskPublicKey: row.owner_dsk_public_key,
    trustSetEpoch: row.trust_set_epoch,
    keyEpoch: row.key_epoch,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    previousAttestationId: row.previous_attestation_id,
    signerDeviceId: row.signer_device_id,
    signerDskKeyId: row.signer_dsk_key_id,
    signerDskPublicKey: row.signer_dsk_public_key,
    signature: row.signature,
  };
}

function mapHeadRow(row: ChainHeadRow): FamilyAuthorityChainHead {
  return {
    familyId: row.family_id,
    headAttestationId: row.head_attestation_id,
    headRevision: row.head_revision,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

type AppendSoftCode = 'REJECTED_STALE_REVISION';

/**
 * Both the attestation-ledger INSERT and the head-pointer advance happen in
 * ONE transaction, so a conflict on either half rolls back both -- no
 * orphan attestation row can ever exist without (or ahead of) its head
 * pointer. The head advance itself is a single guarded UPDATE (revision >
 * 1) or a PRIMARY-KEY-guarded INSERT (revision 1, no head row yet),
 * mirroring MySqlDeviceChallengeRepository.consumeAtomically -- under a
 * concurrent race, InnoDB row-level locking serializes the competing
 * writers; every loser's guard clause matches zero rows (or raises
 * ER_DUP_ENTRY) against the winner's already-committed row (mission
 * Section 25/27: at most one transition becomes canonical, never a fork).
 */
export class MySqlFamilyAuthorityAttestationChainStore implements FamilyAuthorityAttestationChainStore {
  async appendIfCurrentRevision(
    attestation: FamilyOwnerAttestation,
    attestationId: AttestationId,
    expectedPreviousRevision: number,
  ): Promise<AppendAttestationResult> {
    try {
      return await runInTransaction(async (conn) => {
        try {
          await execute(
            conn,
            `INSERT INTO family_authority_attestations
               (family_id, attestation_id, attestation_revision, owner_device_id, owner_dsk_key_id, owner_dsk_public_key,
                trust_set_epoch, key_epoch, issued_at, expires_at, previous_attestation_id,
                signer_device_id, signer_dsk_key_id, signer_dsk_public_key, signature)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              attestation.familyId,
              attestationId,
              attestation.attestationRevision,
              attestation.ownerDeviceId,
              attestation.ownerDskKeyId,
              attestation.ownerDskPublicKey,
              attestation.trustSetEpoch,
              attestation.keyEpoch,
              attestation.issuedAt,
              attestation.expiresAt,
              attestation.previousAttestationId,
              attestation.signerDeviceId,
              attestation.signerDskKeyId,
              attestation.signerDskPublicKey,
              attestation.signature,
            ],
          );
        } catch (error) {
          if (isDuplicateEntry(error)) throw new SoftFailure<AppendSoftCode>('REJECTED_STALE_REVISION');
          throw error;
        }

        if (expectedPreviousRevision === 0) {
          try {
            await execute(
              conn,
              `INSERT INTO family_authority_chain_heads (family_id, head_attestation_id, head_revision, status, updated_at)
               VALUES (?, ?, ?, 'ACTIVE', ?)`,
              [attestation.familyId, attestationId, attestation.attestationRevision, attestation.issuedAt],
            );
          } catch (error) {
            if (isDuplicateEntry(error)) throw new SoftFailure<AppendSoftCode>('REJECTED_STALE_REVISION');
            throw error;
          }
        } else {
          const updated = await execute(
            conn,
            `UPDATE family_authority_chain_heads
             SET head_attestation_id = ?, head_revision = ?, status = 'ACTIVE', updated_at = ?
             WHERE family_id = ? AND head_revision = ?`,
            [attestationId, attestation.attestationRevision, attestation.issuedAt, attestation.familyId, expectedPreviousRevision],
          );
          if (updated.rowCount === 0) throw new SoftFailure<AppendSoftCode>('REJECTED_STALE_REVISION');
        }

        return 'APPENDED' as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return error.outcome;
      throw error;
    }
  }

  async findHead(familyId: OpaqueFamilyId): Promise<FamilyAuthorityChainHead | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ChainHeadRow>(conn, `SELECT * FROM family_authority_chain_heads WHERE family_id = ?`, [familyId]),
    );
    return rows[0] ? mapHeadRow(rows[0]) : null;
  }

  async findAttestationById(familyId: OpaqueFamilyId, attestationId: AttestationId): Promise<FamilyOwnerAttestation | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AttestationRow>(conn, `SELECT * FROM family_authority_attestations WHERE family_id = ? AND attestation_id = ?`, [
        familyId,
        attestationId,
      ]),
    );
    return rows[0] ? mapAttestationRow(rows[0]) : null;
  }

  async markHeadRevoked(familyId: OpaqueFamilyId, revokedAt: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE family_authority_chain_heads SET status = 'REVOKED', updated_at = ? WHERE family_id = ? AND status <> 'REVOKED'`,
        [revokedAt, familyId],
      ),
    );
  }
}
