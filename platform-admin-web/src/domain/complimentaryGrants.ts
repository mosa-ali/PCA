// Wire shapes for the Platform Administration complimentary-entitlement-
// grant HTTP surface (backend/src/http/routes/platformadmin/
// complimentaryGrantRoutes.ts, COMPLIMENTARY_ENTITLEMENT_GRANT_V1 in
// ROUND5_INTERFACE_CONTRACTS.md). category/internalNote are `string | null`
// because SUPPORT_ADMIN reads are redacted to null server-side
// (PCA-ADD-COMP-014 Section 8) -- never assume a non-null value here.

export type ComplimentaryEntitlementType = 'COMMERCIAL_ACCESS' | 'MANAGED_DEVICE_CAPACITY' | 'PARENT_MEMBER_CAPACITY';
export const COMPLIMENTARY_ENTITLEMENT_TYPES: ComplimentaryEntitlementType[] = ['COMMERCIAL_ACCESS', 'MANAGED_DEVICE_CAPACITY', 'PARENT_MEMBER_CAPACITY'];

export type ComplimentaryGrantCategory =
  | 'FOUNDER'
  | 'STAFF'
  | 'STAFF_FAMILY'
  | 'BETA_TESTER'
  | 'PARTNER'
  | 'PROMOTION'
  | 'SUPPORT_EXCEPTION'
  | 'LIFETIME_COMPLIMENTARY'
  | 'TEMPORARY_COMPLIMENTARY'
  | 'OTHER';
export const COMPLIMENTARY_GRANT_CATEGORIES: ComplimentaryGrantCategory[] = [
  'FOUNDER',
  'STAFF',
  'STAFF_FAMILY',
  'BETA_TESTER',
  'PARTNER',
  'PROMOTION',
  'SUPPORT_EXCEPTION',
  'LIFETIME_COMPLIMENTARY',
  'TEMPORARY_COMPLIMENTARY',
  'OTHER',
];

export type ComplimentaryGrantStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface ComplimentaryGrantDto {
  grantId: string;
  familyId: string;
  entitlementType: ComplimentaryEntitlementType;
  category: ComplimentaryGrantCategory | null;
  amountOrAllowance: number;
  effectiveFrom: string;
  expiresAt: string | null;
  status: ComplimentaryGrantStatus;
  reasonCode: string;
  internalNote: string | null;
  grantedByAdminId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByAdminId: string | null;
  revision: number;
}

export function isPermanentGrant(grant: Pick<ComplimentaryGrantDto, 'expiresAt'>): boolean {
  return grant.expiresAt === null;
}
