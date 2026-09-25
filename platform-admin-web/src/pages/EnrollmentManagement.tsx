import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import AccountsList from './accounts/AccountsList';
import Entitlements from './entitlements/Entitlements';
import EntitlementRequests from './entitlements/EntitlementRequests';
import ComplimentaryCapacity from './entitlements/ComplimentaryCapacity';

/** Stable deep-link values for the enrollment workspace tabs. */
const ENROLLMENT_TAB_PARAM = 'tab';
const ENROLLMENT_TABS = ['accounts', 'entitlements', 'requests', 'complimentary-capacity'] as const;
type EnrollmentTab = (typeof ENROLLMENT_TABS)[number];

const TAB_LABELS: Record<EnrollmentTab, string> = {
  accounts: 'nav.accounts',
  entitlements: 'nav.entitlements',
  requests: 'nav.entitlementRequests',
  'complimentary-capacity': 'nav.complimentaryCapacity',
};

function isEnrollmentTab(value: string | null): value is EnrollmentTab {
  return value !== null && (ENROLLMENT_TABS as readonly string[]).includes(value);
}

/**
 * Combines the existing enrollment pages without changing their data flows or
 * permission gates. The selected page is URL-backed so tabs survive refresh,
 * and browser Back/Forward restore the previous selection.
 */
export default function EnrollmentManagement() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestedTab = searchParams.get(ENROLLMENT_TAB_PARAM);
  const selectedTab: EnrollmentTab = isEnrollmentTab(requestedTab) ? requestedTab : 'accounts';

  useEffect(() => {
    if (isEnrollmentTab(requestedTab)) return;
    const normalized = new URLSearchParams(searchParams);
    normalized.set(ENROLLMENT_TAB_PARAM, 'accounts');
    setSearchParams(normalized, { replace: true });
  }, [requestedTab, searchParams, setSearchParams]);

  const selectTab = (tab: EnrollmentTab) => {
    const next = new URLSearchParams(searchParams);
    next.set(ENROLLMENT_TAB_PARAM, tab);
    setSearchParams(next);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % ENROLLMENT_TABS.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + ENROLLMENT_TABS.length) % ENROLLMENT_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ENROLLMENT_TABS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = ENROLLMENT_TABS[nextIndex];
    selectTab(nextTab);
    tabRefs.current[nextIndex]?.focus();
  };

  const page = {
    accounts: <AccountsList />,
    entitlements: <Entitlements />,
    requests: <EntitlementRequests />,
    'complimentary-capacity': <ComplimentaryCapacity />,
  }[selectedTab];

  return (
    <div className="page">
      <h1>{t('enrollmentManagement.title')}</h1>
      <div className="tabs" role="tablist" aria-label={t('enrollmentManagement.tabsLabel')}>
        {ENROLLMENT_TABS.map((tab, index) => (
          <button
            key={tab}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`enrollment-tab-${tab}`}
            aria-selected={selectedTab === tab}
            aria-controls="enrollment-tabpanel"
            tabIndex={selectedTab === tab ? 0 : -1}
            className={selectedTab === tab ? 'tab-btn active' : 'tab-btn'}
            onClick={() => selectTab(tab)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {t(TAB_LABELS[tab])}
          </button>
        ))}
      </div>
      <section
        id="enrollment-tabpanel"
        className="workspace-page-panel"
        role="tabpanel"
        aria-labelledby={`enrollment-tab-${selectedTab}`}
        tabIndex={0}
      >
        {page}
      </section>
    </div>
  );
}
