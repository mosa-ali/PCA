import { execute, runInTransaction } from '../../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';

export type ParentEmailIneligibleReason =
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_SUSPENDED'
  | 'FAMILY_NOT_PROVISIONED'
  | 'ALREADY_ENTITLED'
  | 'OTHER_APPROVED_REASON';

export type ParentEmailFamilyLookupResult =
  // This resolver deliberately addresses the Parent identity domain only.
  // `parent_accounts` has no account-class discriminator: its rows are Parents
  // by construction. Other identity domains (notably Platform Admin) have
  // separate tables and security boundaries. Probing those tables here would
  // disclose cross-domain account existence, so an email with no Parent row
  // is reported as ACCOUNT_NOT_FOUND rather than WRONG_ACCOUNT_CLASS.
  | { readonly outcome: 'ACCOUNT_NOT_FOUND' }
  | {
      readonly outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE';
      readonly reason: ParentEmailIneligibleReason;
      /** Directly linked family IDs remain available to read-only workspaces. */
      readonly familyIds: readonly string[];
      readonly account: ParentEmailAccountSummary;
      readonly families: readonly ParentEmailFamilySummary[];
    }
  | {
      readonly outcome: 'ELIGIBLE_FAMILY_FOUND';
      readonly familyIds: readonly string[];
      readonly account: ParentEmailAccountSummary;
      readonly families: readonly ParentEmailFamilySummary[];
    };

export interface ParentEmailAccountSummary {
  readonly status: string;
  readonly createdAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly accountType: string | null;
  readonly estimatedChildCount: number | null;
  readonly freeAccessMode: string | null;
  readonly freeAccessStartedAt: Date | null;
  readonly freeAccessExpiresAt: Date | null;
  readonly defaultParentMemberLimit: number | null;
  readonly defaultManagedDeviceLimit: number | null;
}

export interface ParentEmailFamilySummary {
  readonly familyId: string;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly deletedAt: Date | null;
}

export interface ParentEmailAccountState {
  readonly status: string;
  readonly disabledAt: Date | null;
  readonly createdAt?: Date | null;
  readonly verifiedAt?: Date | null;
  readonly accountType?: string | null;
  readonly estimatedChildCount?: number | null;
  readonly freeAccessMode?: string | null;
  readonly freeAccessStartedAt?: Date | null;
  readonly freeAccessExpiresAt?: Date | null;
  readonly defaultParentMemberLimit?: number | null;
  readonly defaultManagedDeviceLimit?: number | null;
}

export interface ParentEmailFamilyState {
  readonly familyId: string;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly deletedAt: Date | null;
  readonly alreadyEntitled: boolean;
}

/**
 * Applies the owner-approved deterministic precedence to one uniquely hashed
 * Parent account. A suspended/disabled account wins before verification;
 * verification wins before family provisioning; entitlement only classifies
 * whether a new entitlement is appropriate. It never removes linked IDs from
 * read-only lookup results.
 */
export function classifyParentEmailFamilyLookup(
  account: ParentEmailAccountState | null,
  families: readonly ParentEmailFamilyState[],
): ParentEmailFamilyLookupResult {
  if (!account) return { outcome: 'ACCOUNT_NOT_FOUND' };

  const familyIds = [...new Set(families.map((family) => family.familyId))];
  const linkedFamilies = families.filter((family) => familyIds.includes(family.familyId));
  const accountSummary: ParentEmailAccountSummary = {
    status: account.status,
    createdAt: account.createdAt ?? null,
    verifiedAt: account.verifiedAt ?? null,
    disabledAt: account.disabledAt,
    accountType: account.accountType ?? null,
    estimatedChildCount: account.estimatedChildCount ?? null,
    freeAccessMode: account.freeAccessMode ?? null,
    freeAccessStartedAt: account.freeAccessStartedAt ?? null,
    freeAccessExpiresAt: account.freeAccessExpiresAt ?? null,
    defaultParentMemberLimit: account.defaultParentMemberLimit ?? null,
    defaultManagedDeviceLimit: account.defaultManagedDeviceLimit ?? null,
  };
  const familySummaries = familyIds.map((familyId) => {
    const family = linkedFamilies.find((candidate) => candidate.familyId === familyId);
    return { familyId, status: family!.status, deletedAt: family!.deletedAt };
  });
  const activeFamilies = linkedFamilies.filter((family) => family.status === 'ACTIVE' && family.deletedAt === null);
  const allLinkedFamiliesSuspended = linkedFamilies.length > 0 && activeFamilies.length === 0
    && linkedFamilies.some((family) => family.status === 'SUSPENDED');

  if (account.disabledAt !== null || allLinkedFamiliesSuspended) {
    return { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'ACCOUNT_SUSPENDED', familyIds, account: accountSummary, families: familySummaries };
  }
  if (account.status !== 'VERIFIED') {
    return { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'EMAIL_NOT_VERIFIED', familyIds, account: accountSummary, families: familySummaries };
  }
  if (activeFamilies.length === 0) {
    return { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'FAMILY_NOT_PROVISIONED', familyIds, account: accountSummary, families: familySummaries };
  }
  if (activeFamilies.every((family) => family.alreadyEntitled)) {
    return { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'ALREADY_ENTITLED', familyIds, account: accountSummary, families: familySummaries };
  }
  return { outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds, account: accountSummary, families: familySummaries };
}

interface ParentAccountRow {
  status: string;
  disabled_at: Date | null;
  created_at: Date;
  verified_at: Date | null;
  account_type: string | null;
  estimated_child_count: number | null;
  free_access_mode: string | null;
  free_access_started_at: Date | null;
  free_access_expires_at: Date | null;
  default_parent_member_limit: number | null;
  default_managed_device_limit: number | null;
}

interface FamilyRow {
  family_id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  deleted_at: Date | null;
  already_entitled: number;
}

/** Exact, family-isolated lookup by the normalized Parent email hash. */
export async function resolveParentEmailFamilyLookup(
  emailHash: Buffer,
  includeDeleted = false,
): Promise<ParentEmailFamilyLookupResult> {
  return runInTransaction((conn) => resolveParentEmailFamilyLookupOnConnection(conn, emailHash, includeDeleted));
}

/** Connection-scoped form allows a rollback-only MySQL integration fixture. */
export async function resolveParentEmailFamilyLookupOnConnection(
  conn: PoolConnection,
  emailHash: Buffer,
  includeDeleted = false,
): Promise<ParentEmailFamilyLookupResult> {
  const { rows: accountRows } = await execute<ParentAccountRow>(
    conn,
    `SELECT status, disabled_at, created_at, verified_at, account_type,
            estimated_child_count, free_access_mode, free_access_started_at,
            free_access_expires_at, default_parent_member_limit,
            default_managed_device_limit
       FROM parent_accounts
      WHERE email_hash = ?`,
    [emailHash],
  );
  const accountRow = accountRows[0];
  if (!accountRow) return classifyParentEmailFamilyLookup(null, []);

  const { rows: familyRows } = await execute<FamilyRow>(
    conn,
    // account_entitlements is the current base entitlement record and has no
    // status/expiry lifecycle columns. Complimentary grants have a separate
    // lifecycle and are intentionally not conflated with this read lookup.
    `SELECT DISTINCT f.family_id, f.status, f.deleted_at,
            CASE WHEN ae.family_id IS NULL THEN 0 ELSE 1 END AS already_entitled
     FROM families f
     LEFT JOIN account_entitlements ae ON ae.family_id = f.family_id
     WHERE (
       f.family_id IN (
         SELECT pa.family_id FROM parent_accounts pa
         WHERE pa.email_hash = ? AND pa.family_id IS NOT NULL
       )
       OR f.provisioned_for_account_id IN (
         SELECT pa.account_id FROM parent_accounts pa WHERE pa.email_hash = ?
       )
       OR EXISTS (
         SELECT 1 FROM family_parent_memberships m
         INNER JOIN parent_accounts pa ON pa.account_id = m.account_id
         WHERE pa.email_hash = ? AND m.family_id = f.family_id
           AND m.status = 'ACTIVE' AND m.role = 'ADMINISTRATOR'
       )
     )
     ${includeDeleted ? '' : 'AND f.deleted_at IS NULL'}
     ORDER BY f.family_id ASC`,
    [emailHash, emailHash, emailHash],
  );

  return classifyParentEmailFamilyLookup(
    {
      status: accountRow.status,
      disabledAt: accountRow.disabled_at,
      createdAt: accountRow.created_at,
      verifiedAt: accountRow.verified_at,
      accountType: accountRow.account_type,
      estimatedChildCount: accountRow.estimated_child_count,
      freeAccessMode: accountRow.free_access_mode,
      freeAccessStartedAt: accountRow.free_access_started_at,
      freeAccessExpiresAt: accountRow.free_access_expires_at,
      defaultParentMemberLimit: accountRow.default_parent_member_limit,
      defaultManagedDeviceLimit: accountRow.default_managed_device_limit,
    },
    familyRows.map((row) => ({
      familyId: row.family_id,
      status: row.status,
      deletedAt: row.deleted_at,
      alreadyEntitled: row.already_entitled === 1,
    })),
  );
}
