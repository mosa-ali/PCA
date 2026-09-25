import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import EnrollmentManagement from '../../src/pages/EnrollmentManagement';
import CommercialPricing from '../../src/pages/CommercialPricing';

vi.mock('../../src/pages/accounts/AccountsList', () => ({ default: () => <p>Accounts panel</p> }));
vi.mock('../../src/pages/entitlements/Entitlements', () => ({ default: () => <p>Entitlements panel</p> }));
vi.mock('../../src/pages/entitlements/EntitlementRequests', () => ({ default: () => <p>Requests panel</p> }));
vi.mock('../../src/pages/entitlements/ComplimentaryCapacity', () => ({ default: () => <p>Complimentary capacity panel</p> }));
vi.mock('../../src/pages/entitlements/FreeAccessPolicy', () => ({ default: () => <p>Free access policy panel</p> }));
vi.mock('../../src/pages/billing/BillingPlans', () => ({ default: () => <p>Plans panel</p> }));
vi.mock('../../src/pages/billing/BillingPricing', () => ({ default: () => <p>Price book panel</p> }));
vi.mock('../../src/pages/billing/BillingQuotes', () => ({ default: () => <p>Custom quotes panel</p> }));
vi.mock('../../src/state/AuthContext', () => ({ useCurrentRoles: () => ['APP_OWNER'] }));

function renderWorkspace(workspace: 'enrollment' | 'commercial') {
  const content = workspace === 'enrollment' ? <EnrollmentManagement /> : <CommercialPricing />;
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/workspace']}>
        {content}
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="workspace location">{location.pathname}{location.search}</output>;
}

function renderInteractiveWorkspace(workspace: 'enrollment' | 'commercial') {
  const content = workspace === 'enrollment' ? <EnrollmentManagement /> : <CommercialPricing />;
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[workspace === 'enrollment' ? '/enrollment-management' : '/commercial-pricing']}>
        <LocationProbe />
        {content}
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('consolidated workspace Arabic and accessibility', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
    vi.clearAllMocks();
  });

  it('renders Enrollment Management tabs with Arabic labels, RTL direction, and no axe violations', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = renderWorkspace('enrollment');

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: i18n.t('enrollmentManagement.title') })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: i18n.t('enrollmentManagement.tabsLabel') })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: i18n.t('nav.accounts') })).toHaveAttribute('aria-selected', 'true');
    for (const key of ['nav.accounts', 'nav.entitlements', 'nav.entitlementRequests', 'nav.complimentaryCapacity']) {
      expect(screen.getByRole('tab', { name: i18n.t(key) })).toBeInTheDocument();
    }
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(i18n.t('nav.accounts'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders Commercial & Pricing navigation with Arabic labels, RTL direction, and no axe violations', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = renderWorkspace('commercial');

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: i18n.t('commercialPricing.title') })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: i18n.t('commercialPricing.tabsLabel') })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: i18n.t('nav.freeAccessPolicy') })).toHaveAttribute('aria-selected', 'true');
    for (const key of ['nav.freeAccessPolicy', 'nav.billingPlans', 'nav.billingPricing', 'nav.billingQuotes']) {
      expect(screen.getByRole('tab', { name: i18n.t(key) })).toBeInTheDocument();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps every enrollment tab deep-linkable through its query parameter in English and Arabic', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('en');
    const { unmount } = renderInteractiveWorkspace('enrollment');
    const enrollmentTabs = [
      ['nav.accounts', 'accounts'],
      ['nav.entitlements', 'entitlements'],
      ['nav.entitlementRequests', 'requests'],
      ['nav.complimentaryCapacity', 'complimentary-capacity'],
    ] as const;
    for (const [label, value] of enrollmentTabs) {
      await user.click(screen.getByRole('tab', { name: i18n.t(label) }));
      expect(screen.getByLabelText('workspace location')).toHaveTextContent(`?tab=${value}`);
      expect(screen.getByRole('tab', { name: i18n.t(label) })).toHaveAttribute('aria-selected', 'true');
    }
    unmount();

    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    renderInteractiveWorkspace('enrollment');
    for (const [label, value] of enrollmentTabs) {
      await user.click(screen.getByRole('tab', { name: i18n.t(label) }));
      expect(screen.getByLabelText('workspace location')).toHaveTextContent(`?tab=${value}`);
    }
  });

  it('keeps every commercial tab deep-linkable through its query parameter in English and Arabic', async () => {
    const user = userEvent.setup();
    const commercialTabs = [
      ['nav.freeAccessPolicy', 'free-access-policy'],
      ['nav.billingPlans', 'plans'],
      ['nav.billingPricing', 'price-book'],
      ['nav.billingQuotes', 'custom-quotes'],
    ] as const;
    for (const language of ['en', 'ar'] as const) {
      await i18n.changeLanguage(language);
      applyDocumentDirection(language);
      const { unmount } = renderInteractiveWorkspace('commercial');
      for (const [label, value] of commercialTabs) {
        await user.click(screen.getByRole('tab', { name: i18n.t(label) }));
        expect(screen.getByLabelText('workspace location')).toHaveTextContent(`?tab=${value}`);
        expect(screen.getByRole('tab', { name: i18n.t(label) })).toHaveAttribute('aria-selected', 'true');
      }
      unmount();
    }
  });
});
