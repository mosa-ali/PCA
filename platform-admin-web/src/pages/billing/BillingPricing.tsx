import { ComingSoon } from '../../components/common/ComingSoon';

/**
 * This page's future implementation must use src/money/money.ts's
 * parseExactMinorUnits for every operator-entered price -- never
 * parseFloat(price) * 100 (mission Section 17) -- once a PriceBook
 * administration endpoint exists (backend/src/billing/priceBook.ts defines
 * the domain type today; no HTTP route wires it up yet).
 */
export default function BillingPricing() {
  return (
    <ComingSoon
      titleKey="nav.billingPricing"
      backendGapNote="backend/src/billing/priceBook.ts defines the PriceBook domain type (market, currency, targetDeviceLimit, amountMinor, version), but no HTTP route exposes price-book CRUD yet."
    />
  );
}
