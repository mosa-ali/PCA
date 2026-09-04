import { randomUUID } from 'node:crypto';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type {
  ChildProfileMembershipRow,
  ChildProfileRegistryRepository,
  CreateChildProfileOutcome,
} from './ChildProfileRegistryRepository.js';

interface MembershipRowShape {
  child_profile_id: string;
  family_id: string;
  created_at: Date;
}

function toRow(row: MembershipRowShape): ChildProfileMembershipRow {
  return { childProfileId: row.child_profile_id, familyId: row.family_id, createdAtUtc: row.created_at.toISOString() };
}

export class MySqlChildProfileRegistryRepository implements ChildProfileRegistryRepository {
  async create(familyId: string, creationRequestKey: string | null, now: Date): Promise<CreateChildProfileOutcome> {
    const childProfileId = randomUUID();
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO family_child_memberships (child_profile_id, family_id, creation_request_key, created_at)
           VALUES (?, ?, ?, ?)`,
          [childProfileId, familyId, creationRequestKey, now],
        ),
      );
      return { outcome: 'CREATED', row: { childProfileId, familyId, createdAtUtc: now.toISOString() } };
    } catch (error) {
      // The only unique key besides the primary key is
      // (family_id, creation_request_key). A collision there -- never on
      // the server-minted primary key itself, which cannot practically
      // collide -- means this exact family already used this exact
      // idempotency key: return the row that call actually created,
      // never a second one.
      if (isDuplicateEntry(error) && creationRequestKey !== null) {
        const existing = await this.findByRequestKey(familyId, creationRequestKey);
        if (existing) return { outcome: 'IDEMPOTENT_REPLAY', row: existing };
      }
      throw error;
    }
  }

  private async findByRequestKey(familyId: string, creationRequestKey: string): Promise<ChildProfileMembershipRow | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<MembershipRowShape>(
        conn,
        `SELECT child_profile_id, family_id, created_at FROM family_child_memberships
         WHERE family_id = ? AND creation_request_key = ?`,
        [familyId, creationRequestKey],
      ),
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async listForFamily(familyId: string): Promise<ChildProfileMembershipRow[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<MembershipRowShape>(
        conn,
        `SELECT child_profile_id, family_id, created_at FROM family_child_memberships
         WHERE family_id = ? ORDER BY created_at ASC, child_profile_id ASC`,
        [familyId],
      ),
    );
    return rows.map(toRow);
  }

  async resolveMembership(familyId: string, childProfileId: string): Promise<'MEMBER' | 'NOT_MEMBER_OR_NOT_FOUND'> {
    const { rows } = await runInTransaction((conn) =>
      execute<{ family_id: string }>(
        conn,
        `SELECT family_id FROM family_child_memberships WHERE child_profile_id = ?`,
        [childProfileId],
      ),
    );
    if (rows[0] && rows[0].family_id === familyId) return 'MEMBER';
    return 'NOT_MEMBER_OR_NOT_FOUND';
  }
}
