import type { PlatformAdminRole } from './roles';

/** Mirrors backend/src/platformadmin/readmodels/AdminUsersReadModel.ts's mfaStatus exactly: null when no platform_admin_mfa_state row exists yet for this admin (MFA setup never started). */
export type AdminMfaStatus = 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED' | null;

export interface AdminUserSummary {
  adminId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roles: PlatformAdminRole[];
  mfaStatus: AdminMfaStatus;
  createdAt: string | null;
  disabledAt: string | null;
}

export interface CreatedAdminUser {
  adminId: string;
  displayName: string;
  status: string;
  createdAt: string | null;
}
