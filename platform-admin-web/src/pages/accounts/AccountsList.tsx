import { ComingSoon } from '../../components/common/ComingSoon';

export default function AccountsList() {
  return (
    <ComingSoon
      titleKey="nav.accounts"
      backendGapNote="No HTTP route exists for family/account listing (e.g. GET /platform-admin/accounts). backend/src/platformadmin has no account-listing endpoint yet -- only the five auth routes in platformAdminAuthRoutes.ts exist."
    />
  );
}
