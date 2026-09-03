// PPR-2: the internal "Download PCA Child App" page.
//
// The header's Download action is global and always visible; this page is what
// it opens, and it is where the honesty lives. Three facts are pinned here
// because each of them is a way the feature could quietly become a lie:
//
//   1. With nothing configured -- the state of every environment in this
//      repository -- the page STATES the Android position rather than showing
//      a dead button or an invented Play Store link.
//   2. It emits no external href at all in that state, and only ever the
//      configured URL itself in the other.
//   3. iOS is text. No link, no button, no form control anywhere near it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import i18n from '../../src/i18n';
import DownloadApp from '../../src/pages/download/DownloadApp';
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

describe('Download PCA Child App page', () => {
  afterEach(() => {
    configHoisted.androidAppDownloadUrl = null;
  });

  it('states the Android position honestly when no URL is configured', () => {
    configHoisted.androidAppDownloadUrl = null;

    renderWithProviders(<DownloadApp />, { route: '/download' });

    expect(screen.getByRole('heading', { level: 1, name: i18n.t('downloadApp.title') })).toBeTruthy();
    expect(screen.getByText(i18n.t('downloadApp.androidNotConfigured'))).toBeTruthy();
    // The exact V1 position, not a softened paraphrase.
    expect(i18n.t('downloadApp.androidNotConfigured')).toBe(
      'Android app download is not configured yet for this environment.',
    );
  });

  it('states the iOS position as text and offers no iOS action', () => {
    renderWithProviders(<DownloadApp />, { route: '/download' });

    const iosText = screen.getByText(i18n.t('downloadApp.iosPlanned'));
    expect(iosText).toBeTruthy();
    expect(i18n.t('downloadApp.iosPlanned')).toBe('iOS app is planned for a later release.');

    // Nothing actionable inside the iOS block: no link, no button, no control.
    const iosBlock = iosText.closest('.state-block');
    expect(iosBlock).not.toBeNull();
    expect(within(iosBlock as HTMLElement).queryAllByRole('link')).toEqual([]);
    expect(within(iosBlock as HTMLElement).queryAllByRole('button')).toEqual([]);
    expect((iosBlock as HTMLElement).querySelectorAll('a, button, input, select')).toHaveLength(0);
  });

  it('has ZERO hrefs of any kind when nothing is configured -- no store link, no dead link', () => {
    configHoisted.androidAppDownloadUrl = null;

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/play\.google\.com|apps\.apple\.com|itunes|market:\/\//i);
    expect(container.innerHTML).not.toMatch(/javascript:|data:/i);
  });

  it('renders the configured URL verbatim as the ONLY link when one is set', () => {
    configHoisted.androidAppDownloadUrl = 'https://downloads.example.test/pca-child.apk';

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://downloads.example.test/pca-child.apk');
    expect(links[0].textContent).toBe(i18n.t('shell.downloadAppAndroid'));
    // Also shown as copyable text, LTR-isolated so an RTL paragraph cannot
    // reorder it.
    expect(container.querySelector('.copyable-value code')?.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('.copyable-value code')?.textContent).toBe(
      'https://downloads.example.test/pca-child.apk',
    );
  });

  it('presents both not-available cases as status, never as an error', () => {
    configHoisted.androidAppDownloadUrl = null;

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    // Android + iOS: two ActionNeededState blocks, blue and role="status".
    expect(container.querySelectorAll('.state-action-needed[role="status"]')).toHaveLength(2);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('.state-error')).toHaveLength(0);
  });
});

// Constraint that predates this page and must survive it: an env value with a
// scheme other than http(s) is treated as UNSET, so it can never reach an href.
// Asserted against the real config module (vi.importActual bypasses the mock
// above), because that is the code the browser actually runs.
describe('androidAppDownloadUrl scheme validation (real config/env)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadConfig(raw: string | undefined) {
    vi.resetModules();
    if (raw === undefined) vi.stubEnv('VITE_PCA_ANDROID_APP_DOWNLOAD_URL', '');
    else vi.stubEnv('VITE_PCA_ANDROID_APP_DOWNLOAD_URL', raw);
    const mod = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env');
    return mod.config.androidAppDownloadUrl;
  }

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
    ['not a url at all'],
    [''],
  ])('treats %j as unset', async (raw) => {
    expect(await loadConfig(raw)).toBeNull();
  });

  it('keeps a real https URL', async () => {
    expect(await loadConfig('https://downloads.example.test/pca-child.apk')).toBe(
      'https://downloads.example.test/pca-child.apk',
    );
  });
});
