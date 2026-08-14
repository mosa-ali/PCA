import { ComingSoon } from '../components/common/ComingSoon';

export default function AdminUsers() {
  return (
    <ComingSoon
      titleKey="nav.adminUsers"
      backendGapNote="backend/src/platformadmin/auth/PlatformAdminAccountService.ts can create/manage admin accounts server-side, but no HTTP route exposes admin-account listing, role assignment, enable/disable, or session revocation for an operator to drive from this UI yet."
    />
  );
}
