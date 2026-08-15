import type { PlatformAdminRole } from './roles';

export interface AdminUserSummary {
  adminId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  roles: PlatformAdminRole[];
  mfaStatus: string;
  createdAt: string | null;
  disabledAt: string | null;
}

export interface CreatedAdminUser {
  adminId: string;
  displayName: string;
  status: string;
  createdAt: string | null;
}
