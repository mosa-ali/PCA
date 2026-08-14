import { ComingSoon } from '../../components/common/ComingSoon';

export default function BillingInvoices() {
  return (
    <ComingSoon
      titleKey="nav.billingInvoices"
      backendGapNote="backend/src/billing/invoice.ts defines the Invoice/InvoiceLine domain types, but no HTTP route exposes invoice listing yet."
    />
  );
}
