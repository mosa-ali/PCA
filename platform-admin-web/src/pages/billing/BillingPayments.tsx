import { ComingSoon } from '../../components/common/ComingSoon';

export default function BillingPayments() {
  return (
    <ComingSoon
      titleKey="nav.billingPayments"
      backendGapNote="backend/src/billing/payment.ts, paymentMethod.ts, and refund.ts define the domain types, but no HTTP route exposes payment attempt/transaction, refund, or dispute listing yet. No payment provider (mission Section 28) has been chosen or integrated in this backend slice."
    />
  );
}
