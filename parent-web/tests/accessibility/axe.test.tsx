import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Route, Routes } from 'react-router-dom';
import Dashboard from '../../src/pages/Dashboard';
import Requests from '../../src/pages/Requests';
import Notifications from '../../src/pages/Notifications';
import Subscription from '../../src/pages/Subscription';
import DeviceIncreaseRequest from '../../src/pages/billing/DeviceIncreaseRequest';
import ParentMemberIncreaseRequest from '../../src/pages/billing/ParentMemberIncreaseRequest';
import Invoices from '../../src/pages/billing/Invoices';
import ChildrenList from '../../src/pages/children/ChildrenList';
import ActivityTimelinePage from '../../src/pages/children/ActivityTimelinePage';
import AppsPage from '../../src/pages/children/AppsPage';
import Devices from '../../src/pages/family/Devices';
import Members from '../../src/pages/family/Members';
import RolesMatrix from '../../src/pages/family/RolesMatrix';
import DeleteNow from '../../src/pages/privacy/DeleteNow';
import Retention from '../../src/pages/privacy/Retention';
import Transparency from '../../src/pages/privacy/Transparency';
import Audit from '../../src/pages/security/Audit';
import ProtectionStatus from '../../src/pages/security/ProtectionStatus';
import WellbeingAdmin from '../../src/pages/wellbeing/WellbeingAdmin';
import Login from '../../src/pages/auth/Login';
import Register from '../../src/pages/auth/Register';
import VerifyEmail from '../../src/pages/auth/VerifyEmail';
import CheckoutReturn from '../../src/pages/billing/CheckoutReturn';
import ChildOverview from '../../src/pages/children/ChildOverview';
import ChildWellbeingPage from '../../src/pages/children/ChildWellbeingPage';
import EyeProtectionPage from '../../src/pages/children/EyeProtectionPage';
import LocationPage from '../../src/pages/children/LocationPage';
import PrayerPage from '../../src/pages/children/PrayerPage';
import ScreenTimePage from '../../src/pages/children/ScreenTimePage';
import WebProtectionPage from '../../src/pages/children/WebProtectionPage';
import YouTubePage from '../../src/pages/children/YouTubePage';
import Export from '../../src/pages/privacy/Export';
import InvoiceDetail from '../../src/pages/billing/InvoiceDetail';
import NotFound from '../../src/pages/NotFound';
import NotPermitted from '../../src/pages/NotPermitted';
import Recovery from '../../src/pages/security/Recovery';
import Settings from '../../src/pages/Settings';
import TrustedBrowser from '../../src/pages/security/TrustedBrowser';
import { FreeAccessReminderBannerView } from '../../src/components/freeaccess/FreeAccessReminderBannerView';
import { renderWithProviders } from '../utils/renderWithProviders';

/** Wraps a page that reads a route param (e.g. useParams childId) so it actually receives one, mirroring tests/component/ScreenTimePage.test.tsx's established pattern. */
function withChildRoute(path: string, element: ReactElement) {
  return (
    <Routes>
      <Route path={path} element={element} />
    </Routes>
  );
}

/**
 * axe-core's `empty-table-header` rule is a "best-practice"/minor-impact
 * heuristic that only credits *visible* text content, not `aria-label`
 * (see node_modules/axe-core/axe.js: `any: ['has-visible-text']`). Several
 * data tables in this app (Requests, ChildrenList, Devices, Members) have a
 * trailing "actions" column whose header intentionally carries only an
 * `aria-label` (e.g. `<th scope="col" aria-label={t('common.actions')} />`)
 * -- a real visually-hidden text node in a `<th>` was tried first, but
 * browsers' auto table-layout algorithm counts even absolutely-positioned
 * descendants toward that cell's intrinsic width, which reintroduced
 * horizontal overflow at narrow/tablet viewports (see e2e/responsive.spec.ts
 * "family members table"). `aria-label` on the header is a valid WCAG 4.1.2
 * name, correctly announced by real screen readers, without that layout
 * side effect -- so this specific minor/best-practice rule is disabled
 * rather than reverting to the layout-breaking pattern.
 */
const AXE_OPTIONS = { rules: { 'empty-table-header': { enabled: false } } };

describe('accessibility spot checks (axe)', () => {
  it('Dashboard has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Dashboard />);
    // allow initial fixture fetch to settle
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Roles & permissions matrix has no critical axe violations', async () => {
    const { container } = renderWithProviders(<RolesMatrix />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Requests page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Requests />);
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Notifications page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Notifications />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Subscription page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Subscription />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('DeviceIncreaseRequest page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<DeviceIncreaseRequest />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ParentMemberIncreaseRequest page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<ParentMemberIncreaseRequest />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Invoices page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Invoices />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ChildrenList page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<ChildrenList />);
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Devices page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Devices />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Members page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Members />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Audit page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Audit />);
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('WellbeingAdmin page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<WellbeingAdmin />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Retention page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Retention />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Transparency ("What parents can see") page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Transparency />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ActivityTimelinePage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/activity', <ActivityTimelinePage />), {
      route: '/children/child-amir/activity',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Login page (auth, unauthenticated) has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Login />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Register page (auth, unauthenticated) has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Register />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Settings page (language switcher form) has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Settings />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('VerifyEmail page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<VerifyEmail />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ChildOverview page has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/overview', <ChildOverview />), {
      route: '/children/child-amir/overview',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ScreenTimePage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/screen-time', <ScreenTimePage />), {
      route: '/children/child-amir/screen-time',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('WebProtectionPage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/web-protection', <WebProtectionPage />), {
      route: '/children/child-amir/web-protection',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('YouTubePage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/youtube', <YouTubePage />), {
      route: '/children/child-amir/youtube',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('LocationPage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/location', <LocationPage />), {
      route: '/children/child-amir/location',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('EyeProtectionPage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/eye-protection', <EyeProtectionPage />), {
      route: '/children/child-amir/eye-protection',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('PrayerPage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/prayer', <PrayerPage />), {
      route: '/children/child-amir/prayer',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ChildWellbeingPage has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/wellbeing-messages', <ChildWellbeingPage />), {
      route: '/children/child-amir/wellbeing-messages',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Export page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Export />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('TrustedBrowser page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<TrustedBrowser />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('Recovery page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<Recovery />, { role: 'OWNER' });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('InvoiceDetail page has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/subscription/invoices/:invoiceId', <InvoiceDetail />), {
      route: '/subscription/invoices/invoice-1',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('NotPermitted page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<NotPermitted />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('NotFound page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<NotFound />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('ProtectionStatus page has no critical axe violations', async () => {
    const { container } = renderWithProviders(<ProtectionStatus />);
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('CheckoutReturn page (no requestId in URL) has no critical axe violations', async () => {
    const { container } = renderWithProviders(<CheckoutReturn />);
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('AppsPage (child app-rules form) has no critical axe violations', async () => {
    const { container } = renderWithProviders(withChildRoute('/children/:childId/apps', <AppsPage />), {
      route: '/children/child-amir/apps',
      role: 'OWNER',
    });
    await new Promise((r) => setTimeout(r, 250));
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('the delete-now confirmation dialog has no critical axe violations while open', async () => {
    const { container, getByRole, findByRole } = renderWithProviders(<DeleteNow />, { role: 'OWNER' });
    await userEvent.click(getByRole('button', { name: 'Delete Now' }));
    await findByRole('dialog');
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('FreeAccessReminderBannerView (ACTIVE) has no critical axe violations', async () => {
    const { container } = renderWithProviders(
      <FreeAccessReminderBannerView
        status={{ mode: 'TIME_LIMITED', grantedAt: '2026-07-16T00:00:00.000Z', expiresAt: '2026-08-15T00:00:00.000Z', remainingDays: 7, status: 'ACTIVE' }}
        onDismiss={() => {}}
      />,
    );
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('FreeAccessReminderBannerView (EXPIRED) has no critical axe violations', async () => {
    const { container } = renderWithProviders(
      <FreeAccessReminderBannerView
        status={{ mode: 'TIME_LIMITED', grantedAt: '2026-07-16T00:00:00.000Z', expiresAt: '2026-08-15T00:00:00.000Z', remainingDays: null, status: 'EXPIRED' }}
        onDismiss={() => {}}
      />,
    );
    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});
