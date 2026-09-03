// PPR-2 header: language, notifications and account controls.
//
// The language selector was already IN the header. It was a bare `<select>`
// with no CSS rule anywhere in global.css, so it inherited `color: inherit`
// onto browser-default chrome and rendered at near-invisible contrast -- a
// legibility and control-quality defect, not a placement one. It is now a
// two-option segmented control, and these tests pin the parts of that contract
// jsdom can actually see: the accessible names, the pressed state, keyboard
// operability, that switching applies globally and preserves the current
// route, and that it flips document direction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Route, Routes } from 'react-router-dom';
import i18n, { applyDocumentDirection, LANGUAGE_STORAGE_KEY } from '../../src/i18n';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { NotificationsBell } from '../../src/components/shell/NotificationsBell';
import { getApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';

function Shell() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<h1>Dashboard content</h1>} />
        <Route path="/family/devices" element={<h1>Devices content</h1>} />
      </Route>
    </Routes>
  );
}

describe('header language control', () => {
  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it('exposes both languages as a named group of pressed/unpressed buttons', async () => {
    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const group = screen.getByRole('group', { name: i18n.t('shell.language') });
    const english = within(group).getByRole('button', { name: 'English' });
    const arabic = within(group).getByRole('button', { name: 'العربية' });

    expect(english).toHaveAttribute('aria-pressed', 'true');
    expect(arabic).toHaveAttribute('aria-pressed', 'false');
    // Without lang="ar" a screen reader pronounces the Arabic endonym with the
    // English voice.
    expect(arabic).toHaveAttribute('lang', 'ar');
    expect(english).toHaveAttribute('lang', 'en');
  });

  it('is operable by keyboard alone and switches the whole app to Arabic and back', async () => {
    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const arabic = screen.getByRole('button', { name: 'العربية' });
    arabic.focus();
    expect(arabic).toHaveFocus();
    // Enter/Space on a real <button>; no pointer involved.
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(i18n.language).toBe('ar'));
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(screen.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
    // Applies globally: the sidebar, not just the header, is now Arabic.
    expect(screen.getByRole('link', { name: i18n.t('nav.trustedBrowser') })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('preserves the current route and persists the choice through the approved mechanism', async () => {
    renderWithProviders(<Shell />, { route: '/family/devices' });
    await screen.findByText('Devices content');

    await userEvent.click(screen.getByRole('button', { name: 'العربية' }));

    await waitFor(() => expect(i18n.language).toBe('ar'));
    // Still on the same page -- switching language is not a navigation.
    expect(screen.getByText('Devices content')).toBeInTheDocument();
    // The existing i18next localStorage cache (src/i18n/index.ts), which is
    // what makes the choice survive a reload and apply before React renders.
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
  });
});

describe('header notifications bell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('carries the unread count in its accessible name and links to /notifications', async () => {
    vi.spyOn(getApiClients().commercialNotifications, 'unreadCount').mockResolvedValue(3);

    renderWithProviders(<NotificationsBell />, { route: '/dashboard' });

    const bell = await screen.findByRole('link', {
      name: i18n.t('shell.notificationsWithCount', { count: 3 }),
    });
    expect(bell.getAttribute('href')).toBe('/notifications');
    // The badge repeats what the accessible name already says, so it is
    // aria-hidden rather than announced twice.
    expect(bell.querySelector('.header-badge')?.textContent).toBe('3');
  });

  it('renders NO badge when the count cannot be read -- never a 0, never a stale number', async () => {
    vi.spyOn(getApiClients().commercialNotifications, 'unreadCount').mockRejectedValue(
      new Error('endpoint not trusted'),
    );

    const { container } = renderWithProviders(<NotificationsBell />, { route: '/dashboard' });

    const bell = await screen.findByRole('link', { name: i18n.t('shell.notifications') });
    expect(bell).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.header-badge')).toBeNull());
    // A "0" here would claim we checked and found nothing, which is the exact
    // lie this component exists to avoid.
    expect(bell.textContent).not.toContain('0');
  });

  it('renders no badge for a genuine zero either, and says so honestly in its name', async () => {
    vi.spyOn(getApiClients().commercialNotifications, 'unreadCount').mockResolvedValue(0);

    const { container } = renderWithProviders(<NotificationsBell />, { route: '/dashboard' });

    expect(await screen.findByRole('link', { name: i18n.t('shell.notifications') })).toBeInTheDocument();
    expect(container.querySelector('.header-badge')).toBeNull();
  });
});

describe('header account control', () => {
  it('opens a keyboard-dismissable panel carrying the account identity and a route to Settings', async () => {
    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const trigger = screen.getByRole('button', { name: new RegExp(i18n.t('shell.openProfileMenu')) });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Closed, the panel is not in the DOM at all, so its "Settings" link can
    // never collide with the sidebar's.
    expect(screen.getAllByRole('link', { name: i18n.t('nav.settings') })).toHaveLength(1);

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const panel = document.getElementById('header-profile-panel');
    expect(panel).not.toBeNull();
    expect(screen.getAllByRole('link', { name: i18n.t('nav.settings') })).toHaveLength(2);
    // The role line interpolates a translated role, never the raw enum and
    // never the untranslated "Role: {{role}}" the old header rendered.
    expect(panel?.textContent).toContain(i18n.t('roles.owner'));
    expect(panel?.textContent).not.toContain('{{role}}');

    await userEvent.keyboard('{Escape}');
    expect(document.getElementById('header-profile-panel')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('labels itself "Your account" and never puts the raw account identifier in the header', async () => {
    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const trigger = screen.getByRole('button', { name: new RegExp(i18n.t('shell.openProfileMenu')) });
    expect(trigger).toHaveTextContent(i18n.t('shell.profile'));

    await userEvent.click(trigger);
    const identifier = document.querySelector('#header-profile-panel bdi.iso')?.textContent ?? '';
    expect(identifier).not.toBe('');

    // In real (non-fixture) mode `session.displayName` is the raw accountId --
    // RealServiceAuthClient fills it with `body.accountId` as a documented
    // placeholder, and against the live stack it is a bare UUID. The header
    // trigger must never present that as if it were a person's name; the
    // identifier belongs in the panel, isolated in a <bdi>.
    expect(trigger.textContent ?? '').not.toContain(identifier);
    expect(document.querySelector('.header-profile')?.textContent ?? '').not.toContain(identifier);
  });
});

describe('the whole header is axe-clean', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('has no axe violations in English or in Arabic/RTL', async () => {
    const { container, unmount } = renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');
    expect(await axe(container)).toHaveNoViolations();
    unmount();

    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const arabic = renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');
    expect(await axe(arabic.container)).toHaveNoViolations();
  });
});
