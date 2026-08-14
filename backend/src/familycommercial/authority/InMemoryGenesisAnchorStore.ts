import type { FamilyAuthorityGenesisAnchor } from './types.js';
import type { OpaqueFamilyId } from '../../familytrustset/types.js';
import type { FamilyAuthorityGenesisStore } from './GenesisAnchorStore.js';

/** Test/reference implementation only -- see MySqlFamilyAuthorityGenesisStore for the durable, concurrency-safe production store. */
export class InMemoryGenesisAnchorStore implements FamilyAuthorityGenesisStore {
  private readonly anchorsByFamilyId = new Map<OpaqueFamilyId, FamilyAuthorityGenesisAnchor>();

  async createIfAbsent(anchor: FamilyAuthorityGenesisAnchor): Promise<FamilyAuthorityGenesisAnchor> {
    const existing = this.anchorsByFamilyId.get(anchor.familyId);
    if (existing !== undefined) return existing;
    this.anchorsByFamilyId.set(anchor.familyId, anchor);
    return anchor;
  }

  async findByFamilyId(familyId: OpaqueFamilyId): Promise<FamilyAuthorityGenesisAnchor | null> {
    return this.anchorsByFamilyId.get(familyId) ?? null;
  }
}
