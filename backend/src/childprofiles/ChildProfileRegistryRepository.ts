/**
 * The opaque central child-profile membership registry. Owner-approved
 * scope (doc 00 Section 9 change CHG-2026-09-04-01, doc 10 Section 7.1):
 * "The central service may maintain an opaque child-profile membership
 * registry consisting of a server-minted childProfileId bound to
 * familyId. No readable child-profile content is permitted in the central
 * service." This repository's shape enforces that at the type level --
 * there is no field here for a name, an age, or any other readable
 * content, and there must never be one added. FamilyMember (doc 10
 * Section 3.2) remains the authoritative readable child entity; this is a
 * membership/existence edge only, never a ChildProfile record.
 *
 * Distinct from ChildProfileMembershipResolver.ts, which this change does
 * not touch: that resolver's synchronous, actor-derived contract is
 * frozen (doc 39 Section 10) and is not backed by this table.
 */
export interface ChildProfileMembershipRow {
  childProfileId: string;
  familyId: string;
  createdAtUtc: string;
}

export type CreateChildProfileOutcome =
  | { outcome: 'CREATED'; row: ChildProfileMembershipRow }
  /** The same (familyId, creationRequestKey) pair was already used -- the existing row is returned, not a new one. */
  | { outcome: 'IDEMPOTENT_REPLAY'; row: ChildProfileMembershipRow };

export interface ChildProfileRegistryRepository {
  /**
   * Mints a NEW opaque childProfileId server-side and binds it to
   * familyId. Never accepts a caller-supplied id -- see the migration's
   * own header comment for why (a caller-chosen id under a global primary
   * key is a cross-family existence oracle).
   */
  create(familyId: string, creationRequestKey: string | null, now: Date): Promise<CreateChildProfileOutcome>;

  /** Every opaque entry belonging to familyId. No cross-family read exists on this interface at all. */
  listForFamily(familyId: string): Promise<ChildProfileMembershipRow[]>;

  /**
   * The doc 39 Section 5 oracle-safe membership check: collapses "belongs
   * to a different family" and "does not exist" into the SAME outcome for
   * any caller that must not be able to distinguish them. Only a caller
   * already authorized for `familyId` may safely branch on MEMBER vs
   * NOT_MEMBER_OR_NOT_FOUND -- and even then, the two negative outcomes
   * must still produce the same downstream response (see
   * InvitationService's own use of this method).
   */
  resolveMembership(familyId: string, childProfileId: string): Promise<'MEMBER' | 'NOT_MEMBER_OR_NOT_FOUND'>;
}

/**
 * Reference/test implementation. Keyed purely by childProfileId, matching
 * the real table's PRIMARY KEY -- never a second, independently-scoped map.
 */
export class InMemoryChildProfileRegistryRepository implements ChildProfileRegistryRepository {
  private readonly rowsById = new Map<string, ChildProfileMembershipRow>();
  private readonly idByRequestKey = new Map<string, string>(); // `${familyId}:${creationRequestKey}` -> childProfileId
  private readonly mintId: () => string;

  constructor(mintId: () => string = () => crypto.randomUUID()) {
    this.mintId = mintId;
  }

  async create(familyId: string, creationRequestKey: string | null, now: Date): Promise<CreateChildProfileOutcome> {
    if (creationRequestKey !== null) {
      const dedupeKey = `${familyId}:${creationRequestKey}`;
      const existingId = this.idByRequestKey.get(dedupeKey);
      if (existingId) {
        const existing = this.rowsById.get(existingId);
        if (existing) return { outcome: 'IDEMPOTENT_REPLAY', row: existing };
      }
    }
    const childProfileId = this.mintId();
    const row: ChildProfileMembershipRow = { childProfileId, familyId, createdAtUtc: now.toISOString() };
    this.rowsById.set(childProfileId, row);
    if (creationRequestKey !== null) this.idByRequestKey.set(`${familyId}:${creationRequestKey}`, childProfileId);
    return { outcome: 'CREATED', row };
  }

  async listForFamily(familyId: string): Promise<ChildProfileMembershipRow[]> {
    return Array.from(this.rowsById.values())
      .filter((row) => row.familyId === familyId)
      .sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));
  }

  async resolveMembership(familyId: string, childProfileId: string): Promise<'MEMBER' | 'NOT_MEMBER_OR_NOT_FOUND'> {
    const row = this.rowsById.get(childProfileId);
    if (!row || row.familyId !== familyId) return 'NOT_MEMBER_OR_NOT_FOUND';
    return 'MEMBER';
  }
}
