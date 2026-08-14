import { execute, isDuplicateEntry, runInTransaction } from '../../db/pool.js';
import type { FamilyAuthorityGenesisAnchor } from './types.js';
import type { OpaqueFamilyId } from '../../familytrustset/types.js';
import type { FamilyAuthorityGenesisStore } from './GenesisAnchorStore.js';

interface GenesisAnchorRow {
  family_id: string;
  genesis_device_id: string;
  genesis_dsk_key_id: string;
  genesis_dsk_public_key: string;
  protocol_version: number;
  created_at: Date;
  signature: string;
}

function mapRow(row: GenesisAnchorRow): FamilyAuthorityGenesisAnchor {
  return {
    familyId: row.family_id,
    genesisDeviceId: row.genesis_device_id,
    genesisDskKeyId: row.genesis_dsk_key_id,
    genesisDskPublicKey: row.genesis_dsk_public_key,
    protocolVersion: row.protocol_version,
    createdAt: row.created_at,
    signature: row.signature,
  };
}

/**
 * `family_id` is the PRIMARY KEY (0011_family_commercial_authority.sql), so
 * two concurrent bootstrap attempts for the same family cannot both insert
 * -- InnoDB serializes the race and the loser's INSERT raises ER_DUP_ENTRY
 * (mission Section 26: exactly one canonical genesis, other attempts get a
 * stable/idempotent result, never a second root).
 */
export class MySqlFamilyAuthorityGenesisStore implements FamilyAuthorityGenesisStore {
  async createIfAbsent(anchor: FamilyAuthorityGenesisAnchor): Promise<FamilyAuthorityGenesisAnchor> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO family_authority_genesis_anchors
             (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, created_at, signature)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            anchor.familyId,
            anchor.genesisDeviceId,
            anchor.genesisDskKeyId,
            anchor.genesisDskPublicKey,
            anchor.protocolVersion,
            anchor.createdAt,
            anchor.signature,
          ],
        ),
      );
      return anchor;
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const existing = await this.findByFamilyId(anchor.familyId);
      if (existing === null) throw error;
      return existing;
    }
  }

  async findByFamilyId(familyId: OpaqueFamilyId): Promise<FamilyAuthorityGenesisAnchor | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<GenesisAnchorRow>(conn, `SELECT * FROM family_authority_genesis_anchors WHERE family_id = ?`, [familyId]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
}
