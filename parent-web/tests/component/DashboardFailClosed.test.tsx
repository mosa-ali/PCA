// A FAIL-CLOSED READ IS NOT AN ERROR.
//
// In real (non-fixture) mode `getDashboard()` ALWAYS throws
// EndpointNotTrustedError or CryptoReviewRequiredError, by design and
// correctly: the trust gate refused a browser that has not been paired. Before
// PPR-2 that rendered under `common.errorTitle` -- "Something went wrong",
// `role="alert"` -- which told a parent the product was broken at the exact
// moment it was working as specified, with no next step.
//
// These tests pin the replacement: the action-needed treatment, with the one
// real next step, and six em-dash KPIs rather than a page of reassuring zeros.
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
  it('renders the action-needed treatment, not "Something went wrong"', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);

    expect(await screen.findByText('Finish setting up this browser')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    const block = container.querySelector('.state-action-needed');
    expect(block).not.toBeNull();
    // Informational, never an interruption.
    expect(block?.getAttribute('role')).toBe('status');
    expect(container.querySelectorAll('.state-error')).toHaveLength(0);
  });

  it('names the one next step and keeps it inside the app', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    renderWithProviders(<Dashboard />);

    const action = await screen.findByRole('link', { name: 'Set up this browser' });
    expect(action.getAttribute('href')).toBe('/security/trusted-browser');
  });

  it('keeps the existing honest reason sentence', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    renderWithProviders(<Dashboard />);

    expect(
      await screen.findByText(/This browser is not trusted with your family's data yet/),
    ).toBeInTheDocument();
  });

  it('shows every KPI as an em dash rather than a reassuring zero', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByText('Finish setting up this browser');

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
    await screen.findByText('Finish setting up this browser');

    expect(container.querySelectorAll('.child-card')).toHaveLength(0);
    expect(container.querySelectorAll('.children-grid')).toHaveLength(0);
  });

  it('still shows the standing honesty note at the foot', async () => {
    const { default: Dashboard } = await import('../../src/pages/Dashboard');
    const { container } = renderWithProviders(<Dashboard />);
    await screen.findByText('Finish setting up this browser');

    const note = container.querySelector('.banner-neutral');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('role')).toBe('note');
    expect(note?.textContent).toContain('We never claim full protection when any capability is limited.');
  });
});
