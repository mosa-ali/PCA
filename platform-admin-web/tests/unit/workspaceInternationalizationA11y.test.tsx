import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
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
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders Commercial & Pricing navigation with Arabic labels, RTL direction, and no axe violations', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = renderWorkspace('commercial');

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: i18n.t('commercialPricing.title') })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: i18n.t('commercialPricing.tabsLabel') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('nav.freeAccessPolicy') })).toHaveAttribute('aria-current', 'page');
    expect(await axe(container)).toHaveNoViolations();
  });
});
