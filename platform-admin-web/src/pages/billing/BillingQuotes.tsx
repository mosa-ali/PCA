import { ComingSoon } from '../../components/common/ComingSoon';

export default function BillingQuotes() {
  return (
    <ComingSoon
      titleKey="nav.billingQuotes"
      backendGapNote="backend/src/billing/quote.ts and backend/src/entitlements/quote/QuotePort.ts define the custom-quote domain, but no HTTP route exposes open-quote-request listing or quote issuance yet."
    />
  );
}
