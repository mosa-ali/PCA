import { ComingSoon } from '../../components/common/ComingSoon';

export default function Entitlements() {
  return (
    <ComingSoon
      titleKey="nav.entitlements"
      backendGapNote="backend/src/entitlements/EntitlementService.ts and MySqlEntitlementRepository.ts implement the domain logic, but no Fastify route in backend/src/http/routes registers an HTTP surface for it -- no GET /platform-admin/entitlements/:accountId or limit-administration endpoint exists yet."
    />
  );
}
