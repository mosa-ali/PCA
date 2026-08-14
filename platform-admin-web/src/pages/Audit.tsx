import { ComingSoon } from '../components/common/ComingSoon';

export default function Audit() {
  return (
    <ComingSoon
      titleKey="nav.audit"
      backendGapNote="backend/src/platformadmin/audit/PlatformAdminAuditService.ts and AuditRepository.ts record audit events server-side, but no HTTP route exposes a queryable audit-log read endpoint for this UI to render yet."
    />
  );
}
