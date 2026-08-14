import { ComingSoon } from '../../components/common/ComingSoon';

export default function EntitlementRequests() {
  return (
    <ComingSoon
      titleKey="nav.entitlementRequests"
      backendGapNote="backend/src/entitlements/requests/ChangeRequestService.ts implements the PENDING -> QUOTED -> PAYMENT_PENDING -> APPROVED|DENIED|CANCELLED lifecycle, but no HTTP route exposes request listing, quoting, or approval/denial actions yet."
    />
  );
}
