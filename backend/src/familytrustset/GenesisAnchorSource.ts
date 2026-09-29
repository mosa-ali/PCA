import { execute, runInTransaction } from '../db/pool.js';
import type { FamilyAuthorityGenesisStore } from '../familycommercial/authority/GenesisAnchorStore.js';
import type { OpaqueFamilyId } from './types.js';

/**
 * The minimal read surface the Trust Set acceptance flow needs from the
 * family's durable genesis anchor (PCA-FAMILY-AUTH-1-R1 / PCA-DEC-025): who
 * founded this family's trust lineage, and with which DSK. Only the three
 * identity fields are exposed -- the acceptance flow never needs the
 * anchor's signature, protocol version or creation timestamp, and a narrow
 * interface keeps a future acceptance consumer from being tempted to treat
 * any other anchor field as authority.
 */
export interface GenesisAnchorRecord {
  genesisDeviceId: string;
  genesisDskKeyId: string;
  genesisDskPublicKey: string;
}

/**
 * Read-only source of a family's genesis anchor. `null` means EXACTLY "no
 * anchor row exists for this family" (a family that was never bootstrapped,
 * or an anchor not yet visible) -- a read failure must throw, never be
 * reported as `null`, because the acceptance flow treats `null` as
 * GENESIS_UNKNOWN_ANCHOR and a false "no anchor" answer would turn a
 * transient read problem into a rejection (fail closed either way, but a
 * swallowed error would hide the real condition).
 */
export interface GenesisAnchorSource {
  readGenesisAnchor(familyId: OpaqueFamilyId): Promise<GenesisAnchorRecord | null>;
}

interface GenesisAnchorRow {
  genesis_device_id: string;
  genesis_dsk_key_id: string;
  genesis_dsk_public_key: string;
}

/**
 * Direct MySQL reader over `family_authority_genesis_anchors` (migration
 * 0011_family_commercial_authority.sql; column names per src/db/schema.ts).
 * SELECT only -- this class contains no writer of any kind, and the anchor's
 * only write path remains MySqlFamilyAuthorityGenesisStore.createIfAbsent.
 *
 * Read errors propagate: `runInTransaction` rethrows whatever the driver
 * raised, so `null` is returned ONLY for the genuine zero-rows case.
 */
export class MySqlGenesisAnchorSource implements GenesisAnchorSource {
  async readGenesisAnchor(familyId: OpaqueFamilyId): Promise<GenesisAnchorRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<GenesisAnchorRow>(
        conn,
        `SELECT genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key
         FROM family_authority_genesis_anchors
         WHERE family_id = ?`,
        [familyId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      genesisDeviceId: row.genesis_device_id,
      genesisDskKeyId: row.genesis_dsk_key_id,
      genesisDskPublicKey: row.genesis_dsk_public_key,
    };
  }
}

/**
 * Preferred production composition: a thin adapter over the EXISTING
 * familycommercial authority store (`FamilyAuthorityGenesisStore.
 * findByFamilyId`), imported without modification. It reads the same table
 * through the already-reviewed mapper and row interface, so the acceptance
 * flow and the Owner-attestation chain engine can never drift into two
 * different interpretations of one anchor row. `MySqlGenesisAnchorSource`
 * above is kept as the standalone direct-SQL variant of the same contract.
 */
export class GenesisAnchorStoreSource implements GenesisAnchorSource {
  private readonly store: FamilyAuthorityGenesisStore;

  constructor(store: FamilyAuthorityGenesisStore) {
    this.store = store;
  }

  async readGenesisAnchor(familyId: OpaqueFamilyId): Promise<GenesisAnchorRecord | null> {
    const anchor = await this.store.findByFamilyId(familyId);
    if (anchor === null) return null;
    return {
      genesisDeviceId: anchor.genesisDeviceId,
      genesisDskKeyId: anchor.genesisDskKeyId,
      genesisDskPublicKey: anchor.genesisDskPublicKey,
    };
  }
}
