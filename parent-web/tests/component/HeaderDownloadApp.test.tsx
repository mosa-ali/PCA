// PPR-2: the header's "Download App" action.
//
// It used to be rendered ONLY when `config.androidAppDownloadUrl` held a real
// URL. No environment in this repository sets that variable, so in practice the
// control did not exist at all -- the header carried the language switch,
// Notifications and "Your account", and nothing else. That honoured "never
// fabricate a link" by deleting the feature.
//
// The action is now GLOBAL AND PERMANENT and is never conditional on an env
// var. It stays honest by not being a store link at all: it is an in-app link
// to /download, which states per platform what is actually available (see
// pages/download/DownloadApp.tsx and tests/component/DownloadAppPage.test.tsx).
// The Android URL is read there, so no env value can reach an href in this row.
//
// The header still names no platform and offers no iOS action: iOS is post-V1
// and the backend refuses `platform=IOS` with PLATFORM_ENROLLMENT_UNAVAILABLE.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import i18n from '../../src/i18n';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { renderWithProviders } from '../utils/renderWithProviders';

const configHoisted = vi.hoisted(() => ({
  androidAppDownloadUrl: null as string | null,
}));

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return {
    config: {
      ...actual.config,
      get androidAppDownloadUrl() {
        return configHoisted.androidAppDownloadUrl;
      },
    },
  };
});

function Shell() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<h1>Dashboard content</h1>} />
        <Route path="/download" element={<h1>Download page reached</h1>} />
      </Route>
    </Routes>
  );
}

describe('header Download App action', () => {
  afterEach(() => {
    configHoisted.androidAppDownloadUrl = null;
  });

  it('is rendered with NO download URL configured -- the unconfigured case is the normal one', async () => {
    configHoisted.androidAppDownloadUrl = null;

    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const link = screen.getByRole('link', { name: i18n.t('shell.downloadApp') });
    expect(link).toHaveClass('btn-download-app');
    // In-app destination, never an external or empty href.
    expect(link.getAttribute('href')).toBe('/download');
  });

  it('still points at the internal page -- never at the env URL -- when one IS configured', async () => {
    configHoisted.androidAppDownloadUrl = 'https://example.test/pca-android';

    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const link = screen.getByRole('link', { name: i18n.t('shell.downloadApp') });
    expect(link.getAttribute('href')).toBe('/download');
  });

  it('has no href in the whole header that leaves the app, configured or not', async () => {
    for (const url of [null, 'https://example.test/pca-android']) {
      configHoisted.androidAppDownloadUrl = url;
      const { container, unmount } = renderWithProviders(<Shell />, { route: '/dashboard' });
      await screen.findByText('Dashboard content');

      const hrefs = [...(container.querySelector('.app-header')?.querySelectorAll('a[href]') ?? [])].map(
        (a) => a.getAttribute('href') ?? '',
      );
      expect(hrefs).not.toEqual([]);
      for (const href of hrefs) {
        expect(href.startsWith('/')).toBe(true);
        expect(href).not.toMatch(/^(https?|javascript|data):/i);
      }
      unmount();
    }
  });

  it('opens the internal Download page when clicked', async () => {
    renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    await userEvent.click(screen.getByRole('link', { name: i18n.t('shell.downloadApp') }));

    expect(await screen.findByText('Download page reached')).toBeTruthy();
  });

  it('names no platform and offers no iOS action in the header itself', async () => {
    const { container } = renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const header = container.querySelector('.app-header');
    expect(header?.textContent ?? '').not.toMatch(/iOS|iPhone|App Store|Google Play|Android/i);
    expect(screen.getAllByRole('link', { name: i18n.t('shell.downloadApp') })).toHaveLength(1);
  });

  it('keeps the icon-only mobile treatment: the visible label is the desktop-only span', async () => {
    const { container } = renderWithProviders(<Shell />, { route: '/dashboard' });
    await screen.findByText('Dashboard content');

    const link = container.querySelector('.btn-download-app');
    expect(link?.querySelector('svg')).not.toBeNull();
    // The label is hidden by CSS below 900px; the accessible name comes from
    // aria-label and therefore survives that.
    expect(link?.querySelector('span.desktop-only')?.textContent).toBe(i18n.t('shell.downloadApp'));
    expect(link?.getAttribute('aria-label')).toBe(i18n.t('shell.downloadApp'));
  });
});
