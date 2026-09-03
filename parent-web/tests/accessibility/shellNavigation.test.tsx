// PCA-NFR-043: two real navigation defects in the app shell.
//
//  (a) The collapsed sidebar rendered `t(label).slice(0, 1)` as the link's ONLY
//      content, so the single visible character was also the accessible name.
//      In Arabic 10 of the 18 nav labels begin with the definite article "ا",
//      which left ten links with the identical accessible name -- unusable with
//      a screen reader or voice control.
//  (b) The mobile drawer is a fixed panel translated off-screen. It kept all
//      ~19 nav links in the tab order while closed, and once open there was no
//      Escape handler and no close control anywhere inside it: a keyboard user
//      could open it and not get out.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import App from '../../src/App';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { Sidebar } from '../../src/components/shell/Sidebar';
import { NAV_SECTIONS } from '../../src/nav/navConfig';
import { renderWithProviders } from '../utils/renderWithProviders';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAV_LABEL_KEYS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.labelKey));
const NAV_PATHS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.path));

function Shell() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
      </Route>
    </Routes>
  );
}

describe('collapsed sidebar keeps a stable, unique accessible name per link', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('Arabic collapsed links are named by their full label, not by the shared first letter', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    const noop = () => {};
    renderWithProviders(<Sidebar collapsed drawerOpen={false} onNavigate={noop} onClose={noop} />);

    const expected = NAV_LABEL_KEYS.map((key) => i18n.t(key));
    // Sanity: the defect's precondition is real -- most Arabic labels share
    // their first character, so a first-letter-only name is not distinguishing.
    const firstLetters = new Set(expected.map((label) => label.slice(0, 1)));
    expect(firstLetters.size).toBeLessThan(expected.length);

    for (const label of expected) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(new Set(names).size).toBe(names.length);
  });

  it('the navigation landmark is named "main navigation", not "Dashboard"', () => {
    const noop = () => {};
    renderWithProviders(<Sidebar collapsed={false} drawerOpen={false} onNavigate={noop} onClose={noop} />);
    expect(screen.getByRole('navigation', { name: i18n.t('shell.primaryNav') })).toBeInTheDocument();
  });
});

describe('mobile drawer is keyboard-operable', () => {
  it('opens from the header, exposes a close control, and Escape closes it and restores focus', async () => {
    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const toggle = screen.getByRole('button', { name: i18n.t('shell.openMenu') });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    const drawer = screen.getByRole('navigation', { name: i18n.t('shell.primaryNav') });
    expect(drawer.className).toContain('drawer-open');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // A close control lives INSIDE the drawer (previously the only way out was
    // clicking the scrim with a pointer).
    const drawerClose = within(drawer).getByRole('button', { name: i18n.t('shell.closeMenu') });
    // Focus moved into the drawer rather than being left on the toggle behind
    // a panel that covers the page.
    expect(drawerClose).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    expect(
      screen.getByRole('navigation', { name: i18n.t('shell.primaryNav') }).className,
    ).not.toContain('drawer-open');
    expect(
      within(screen.getByRole('navigation', { name: i18n.t('shell.primaryNav') })).queryByRole('button', {
        name: i18n.t('shell.closeMenu'),
      }),
    ).not.toBeInTheDocument();
    // Focus returns to the control that opened it.
    const reopenToggle = screen.getByRole('button', { name: i18n.t('shell.openMenu') });
    expect(reopenToggle).toHaveFocus();
    expect(reopenToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('the closed drawer is taken out of the tab order by the stylesheet, not merely moved off-screen', () => {
    // jsdom does not apply the stylesheet, so this asserts the rule itself:
    // `transform: translateX(-100%)` alone leaves links focusable;
    // `visibility: hidden` is what removes them from the tab order.
    const css = readFileSync(resolve(HERE, '../../src/styles/global.css'), 'utf8');
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 900px)'));
    const sidebarRule = mobileBlock.slice(
      mobileBlock.indexOf('.sidebar {'),
      mobileBlock.indexOf('.sidebar.drawer-open'),
    );
    expect(sidebarRule).toContain('visibility: hidden');
    expect(mobileBlock).toMatch(/\.sidebar\.drawer-open\s*\{[^}]*visibility:\s*visible/);
  });
});

// ---------------------------------------------------------------------------
// PPR-2 information architecture.
//
// First-level navigation was regrouped from six system-named sections into
// five consumer groups. The one thing that must be provably true about that
// change is that it REMOVED NOTHING: Retention, Export, Delete Now, Audit and
// Roles & Permissions are controlled capabilities, and a cosmetic
// simplification is never allowed to drop one. These tests are the proof.
// ---------------------------------------------------------------------------

/** The complete nav surface before the regrouping (navConfig.ts, 18 entries). */
const PREVIOUS_NAV_ROUTES = [
  '/dashboard',
  '/children',
  '/requests',
  '/family/members',
  '/family/roles',
  '/family/devices',
  '/privacy/retention',
  '/privacy/export',
  '/privacy/delete',
  '/privacy/transparency',
  '/privacy/permissions',
  '/security/status',
  '/security/trusted-browser',
  '/security/recovery',
  '/security/audit',
  '/notifications',
  '/subscription',
  '/settings',
];

/**
 * The five routes that moved off the first level. They are not gone: each is
 * listed on the /privacy hub, keeps its own route and RouteGuard, and is still
 * directly linkable and breadcrumbed.
 */
const ROUTES_REHOMED_ON_THE_PRIVACY_HUB = [
  '/privacy/retention',
  '/privacy/export',
  '/privacy/delete',
  '/privacy/transparency',
  '/privacy/permissions',
];

describe('first-level navigation: five consumer groups, zero drops', () => {
  it('is exactly the five groups and 19 entries the IA specifies', () => {
    expect(NAV_SECTIONS.map((section) => section.titleKey)).toEqual([
      'nav.groupHome',
      'nav.groupFamily',
      'nav.groupProtection',
      'nav.groupSafetyPrivacy',
      'nav.groupAccount',
    ]);
    // 18 previous entries + the recovered /wellbeing-messages orphan + the
    // three new /protection/* index pages - the five privacy rows now reached
    // through the hub, + the hub itself + /safety/alerts.
    expect(NAV_PATHS).toHaveLength(19);
    expect(new Set(NAV_PATHS).size).toBe(19);
  });

  it('drops nothing: every previously-navigable route is still in the nav or on the privacy hub', () => {
    const missing = PREVIOUS_NAV_ROUTES.filter(
      (route) => !NAV_PATHS.includes(route) && !ROUTES_REHOMED_ON_THE_PRIVACY_HUB.includes(route),
    );
    expect(missing).toEqual([]);
    // And the five that moved really did move to the hub, not out of the app.
    for (const route of ROUTES_REHOMED_ON_THE_PRIVACY_HUB) {
      expect(NAV_PATHS).not.toContain(route);
      expect(PREVIOUS_NAV_ROUTES).toContain(route);
    }
  });

  it('recovers /wellbeing-messages, a registered route that appeared in no nav section', () => {
    expect(PREVIOUS_NAV_ROUTES).not.toContain('/wellbeing-messages');
    expect(NAV_PATHS).toContain('/wellbeing-messages');
  });

  it('keeps every accessible name that is pinned elsewhere in the suite', () => {
    const noop = () => {};
    renderWithProviders(<Sidebar collapsed={false} drawerOpen={false} onNavigate={noop} onClose={noop} />);

    // tests/component/SidebarTrustedBrowserLink.test.tsx, e2e/responsive.spec.ts,
    // e2e/keyboard-accessibility.spec.ts.
    expect(screen.getByRole('link', { name: 'Trusted Browser' }).getAttribute('href')).toBe(
      '/security/trusted-browser',
    );
    expect(screen.getByRole('link', { name: 'Requests' }).getAttribute('href')).toBe('/requests');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/dashboard');
  });
});

describe('every first-level nav entry resolves to a live route', () => {
  // Rendered against the REAL router table in App.tsx, as an Owner. A nav row
  // that pointed at an unregistered path would land on NotFound; one that
  // pointed at a route this parent may not open would land on NotPermitted.
  // Both are navigation dead ends and both fail here.
  it.each(NAV_PATHS)('%s renders a real page, not NotFound and not NotPermitted', async (path) => {
    const { container, unmount } = renderWithProviders(<App />, { route: path, role: 'OWNER' });
    try {
      await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
      const heading = container.querySelector('h1')?.textContent ?? '';
      expect(heading).not.toBe(i18n.t('notFound.title'));
      expect(heading).not.toBe(i18n.t('rbac.deniedTitle'));
      expect(heading.trim()).not.toBe('');
    } finally {
      unmount();
    }
  });
});

describe('the /privacy hub is where the five rehomed capabilities live', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('lists all five, each linked, for a parent whose role permits them', async () => {
    renderWithProviders(<App />, { route: '/privacy', role: 'OWNER' });
    await screen.findByRole('heading', { name: i18n.t('privacyHub.title'), level: 1 });

    for (const [route, labelKey] of [
      ['/privacy/retention', 'nav.retention'],
      ['/privacy/export', 'nav.export'],
      ['/privacy/delete', 'nav.deleteNow'],
      ['/privacy/transparency', 'nav.transparency'],
      ['/privacy/permissions', 'nav.permissionsPolicy'],
    ] as const) {
      const link = screen.getByRole('link', { name: i18n.t(labelKey) });
      expect(link.getAttribute('href')).toBe(route);
    }
  });

  it('still NAMES a capability the role cannot use, instead of hiding that it exists', async () => {
    // A Viewer may not change retention, export or delete. The hub reflects the
    // gate rather than sending them to a "Not permitted" page -- but it never
    // pretends the capability is absent, which would be the dishonest way to
    // "simplify".
    renderWithProviders(<App />, { route: '/privacy', role: 'VIEWER' });
    await screen.findByRole('heading', { name: i18n.t('privacyHub.title'), level: 1 });

    for (const labelKey of ['nav.retention', 'nav.export', 'nav.deleteNow'] as const) {
      expect(screen.getByText(i18n.t(labelKey))).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: i18n.t(labelKey) })).toBeNull();
    }
    expect(screen.getAllByText(i18n.t('rbac.denied')).length).toBeGreaterThan(0);
    // The ungated ones stay reachable for every role.
    expect(screen.getByRole('link', { name: i18n.t('nav.transparency') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: i18n.t('nav.permissionsPolicy') })).toBeInTheDocument();
  });
});
