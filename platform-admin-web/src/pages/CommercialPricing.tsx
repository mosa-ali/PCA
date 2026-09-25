import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import FreeAccessPolicy from './entitlements/FreeAccessPolicy';
import BillingPlans from './billing/BillingPlans';
import BillingPricing from './billing/BillingPricing';
import BillingQuotes from './billing/BillingQuotes';
import { RouteGuard } from '../rbac/RouteGuard';
import { BillingRouteGuard } from '../rbac/BillingRouteGuard';
import { isPermitted, type PlatformAdminOperation } from '../domain/roles';
import { isBillingPermitted, type BillingOperation } from '../domain/billingRbac';
import { useCurrentRoles } from '../state/AuthContext';

const COMMERCIAL_TABS = [
  { id: 'free-access-policy', label: 'nav.freeAccessPolicy', Page: FreeAccessPolicy, guard: 'platform', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
  { id: 'plans', label: 'nav.billingPlans', Page: BillingPlans, guard: 'billing', operation: 'VIEW_BILLING_RECORDS' },
  { id: 'price-book', label: 'nav.billingPricing', Page: BillingPricing, guard: 'billing', operation: 'VIEW_PRICE_BOOK' },
  { id: 'custom-quotes', label: 'nav.billingQuotes', Page: BillingQuotes, guard: 'platform', operation: 'VIEW_SUPPORT_ACCOUNT_METADATA' },
] as const;

export default function CommercialPricing() {
  const { t } = useTranslation();
  const roles = useCurrentRoles();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestedTab = searchParams.get('tab');
  const allowedTabs = COMMERCIAL_TABS.filter((tab) => tab.guard === 'billing'
    ? isBillingPermitted(roles, tab.operation as BillingOperation)
    : isPermitted(roles, tab.operation as PlatformAdminOperation));
  const activeTab = allowedTabs.find((tab) => tab.id === requestedTab) ?? allowedTabs[0];
  const activeTabId = activeTab?.id;

  // Normalize missing/unknown tabs in the URL while keeping the browser's
  // history entry intact. Tab clicks below create normal history entries.
  useEffect(() => {
    if (activeTabId && requestedTab !== activeTabId) {
      const normalized = new URLSearchParams(searchParams);
      normalized.set('tab', activeTabId);
      setSearchParams(normalized, { replace: true });
    }
  }, [activeTabId, requestedTab, searchParams, setSearchParams]);

  const selectTab = (tabId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tabId);
    setSearchParams(next);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % allowedTabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + allowedTabs.length) % allowedTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = allowedTabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = allowedTabs[nextIndex];
    selectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  if (!activeTab) {
    return <div className="page"><p className="status-unavailable">{t('notPermitted.title')}</p></div>;
  }

  const ActivePage = activeTab.Page;

  return (
    <div className="page">
      <h1>{t('commercialPricing.title', 'Commercial & Pricing')}</h1>
      <div className="filters" role="tablist" aria-label={t('commercialPricing.tabsLabel', 'Commercial and pricing sections')}>
        {allowedTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`commercial-pricing-tab-${tab.id}`}
            aria-selected={tab.id === activeTab.id}
            className={tab.id === activeTab.id ? 'btn btn-primary' : 'btn'}
            aria-controls="commercial-pricing-panel"
            tabIndex={tab.id === activeTab.id ? 0 : -1}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
      <section id="commercial-pricing-panel" className="workspace-page-panel" role="tabpanel" aria-labelledby={`commercial-pricing-tab-${activeTab.id}`} tabIndex={0}>
        {activeTab.guard === 'billing' ? (
          <BillingRouteGuard operation={activeTab.operation as BillingOperation}>
            <ActivePage />
          </BillingRouteGuard>
        ) : (
          <RouteGuard operation={activeTab.operation as PlatformAdminOperation}>
            <ActivePage />
          </RouteGuard>
        )}
      </section>
    </div>
  );
}
