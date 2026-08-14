import { ComingSoon } from '../../components/common/ComingSoon';

export default function BillingPlans() {
  return (
    <ComingSoon
      titleKey="nav.billingPlans"
      backendGapNote="backend/src/billing/plan.ts defines the Plan domain type, but no HTTP route exposes plan listing or administration yet."
    />
  );
}
