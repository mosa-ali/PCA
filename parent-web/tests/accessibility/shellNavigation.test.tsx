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
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { Sidebar } from '../../src/components/shell/Sidebar';
import { NAV_SECTIONS } from '../../src/nav/navConfig';
import { renderWithProviders } from '../utils/renderWithProviders';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAV_LABEL_KEYS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.labelKey));

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
