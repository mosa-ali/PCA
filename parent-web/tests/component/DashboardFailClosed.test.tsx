// A FAIL-CLOSED READ IS NOT AN ERROR.
//
// In real (non-fixture) mode `getDashboard()` ALWAYS throws
// EndpointNotTrustedError or CryptoReviewRequiredError, by design and
// correctly: the trust gate refused a browser that has not been paired. Before
// PPR-2 that rendered under `common.errorTitle` -- "Something went wrong",
// `role="alert"` -- which told a parent the product was broken at the exact
// moment it was working as specified, with no next step.
//
// Dashboard remains honest without turning the obsolete Genesis onboarding
// card into a browser-pairing CTA; protected data stays fail closed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { EndpointNotTrustedError } from '../../src/api/familyDataAccessErrors';
import { renderWithProviders } from '../utils/renderWithProviders';

const failClosed = () => new EndpointNotTrustedError('BROWSER_NOT_TRUSTED', 'ParentFamilyDataGateway.getDashboard');

// Everything else (serviceAuth, which the AuthProvider needs) stays on the
// real dev fixture bundle; only the three family-data reads the dashboard makes
// are replaced with the fail-closed rejection real mode actually produces.
vi.mock('../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/client')>('../../src/api/client');
  return {
    ...actual,
    getApiClients: () => ({
      ...actual.getApiClients(),
      parentFamilyData: {
        getDashboard: () => Promise.reject(failClosed()),
        getScreenTime: () => Promise.reject(failClosed()),
        getActivityTimeline: () => Promise.reject(failClosed()),
      },
      deviceStatus: { listDeviceStatuses: () => Promise.reject(failClosed()) },
      protectionAlertDelivery: { list: () => Promise.reject(failClosed()) },
    }),
  };
});

// useAsync logs the developer-facing diagnostic on every rejection; that is
// deliberate and is not what is under test here.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Dashboard when the family-data read is fail-closed', () => {
  it('renders a neutral unavailable state, not a Genesis browser setup card or error', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);

    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    const block = container.querySelector('.state-action-needed');
    expect(block).not.toBeNull();
    // Informational, never an interruption.
    expect(block?.getAttribute('role')).toBe('status');
    expect(container.querySelectorAll('.state-error')).toHaveLength(0);
  });

  it('does not present the obsolete dashboard pairing CTA', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    renderWithProviders(<Dashboard />);

    await screen.findByText('Not available yet');
    expect(screen.queryByRole('link', { name: 'Set up this browser' })).toBeNull();
  });

  it('explains that unverified protected family data stays hidden without asking to trust this browser', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    renderWithProviders(<Dashboard />);

    expect(
      await screen.findByText('This protected information is not available yet. Browser pairing is not needed for parent access.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/This browser is not trusted/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Set up this browser' })).toBeNull();
  });

  it('shows every KPI as an em dash rather than a reassuring zero', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByText('Not available yet');

    const values = Array.from(container.querySelectorAll('.kpi-value'));
    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value.textContent).toBe('—');
      expect(value).toHaveClass('kpi-value-unknown');
    }
  });

  it('never renders a child card built from a read that threw', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByText('Not available yet');

    expect(container.querySelectorAll('.child-card')).toHaveLength(0);
    expect(container.querySelectorAll('.children-grid')).toHaveLength(0);
  });

  it('still shows the standing honesty note at the foot', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByText('Not available yet');

    const note = container.querySelector('.banner-neutral');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('role')).toBe('note');
    expect(note?.textContent).toContain('We never claim full protection when any capability is limited.');
  });
});
