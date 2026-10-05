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
  childAppDistributionUrl: null as string | null,
  childAppDistributionKind: 'release' as 'release' | 'local-test',
}));

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return {
    config: {
      ...actual.config,
      get childAppDistributionUrl() {
        return configHoisted.childAppDistributionUrl;
      },
      get childAppDistributionKind() {
        return configHoisted.childAppDistributionKind;
      },
    },
  };
});

describe('Download PCA Child App page', () => {
  afterEach(() => {
    configHoisted.childAppDistributionUrl = null;
    configHoisted.childAppDistributionKind = 'release';
  });

  it('states the Android position honestly when no URL is configured', () => {
    configHoisted.childAppDistributionUrl = null;

    renderWithProviders(<DownloadApp />, { route: '/download' });

    expect(screen.getByRole('heading', { level: 1, name: i18n.t('downloadApp.title') })).toBeTruthy();
    expect(screen.getByText(i18n.t('downloadApp.androidNotConfigured'))).toBeTruthy();
    // The exact V1 position, not a softened paraphrase.
    expect(i18n.t('downloadApp.androidNotConfigured')).toBe(
      'Android app download is not configured yet for this environment.',
    );
    expect(i18n.t('downloadApp.intro')).toBe(
      "The PCA Child App is installed on your children's devices, not on this one. Check the installation status for each platform below.",
    );
    const arabic = i18n.getResourceBundle('ar', 'translation') as {
      downloadApp: { intro: string };
    };
    expect(arabic.downloadApp.intro).toBe(
      'يُثبَّت تطبيق حماية الطفل على أجهزة أطفالك، وليس على هذا الجهاز. تحقّق أدناه من حالة التثبيت لكل نظام تشغيل.',
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
    configHoisted.childAppDistributionUrl = null;

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/play\.google\.com|apps\.apple\.com|itunes|market:\/\//i);
    expect(container.innerHTML).not.toMatch(/javascript:|data:/i);
  });

  it('renders an approved installation-information URL verbatim as the ONLY link when one is set', () => {
    configHoisted.childAppDistributionUrl = 'https://downloads.example.test/pca-child.apk';

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://downloads.example.test/pca-child.apk');
    expect(links[0].textContent).toBe(i18n.t('downloadApp.viewInstallationOptions'));
    // Also shown as copyable text, LTR-isolated so an RTL paragraph cannot
    // reorder it.
    expect(container.querySelector('.copyable-value code')?.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('.copyable-value code')?.textContent).toBe(
      'https://downloads.example.test/pca-child.apk',
    );
  });

  it('uses neutral installation-options copy for an approved external destination', () => {
    configHoisted.childAppDistributionUrl = 'https://play.google.com/store/apps/details?id=org.pca.app';

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://play.google.com/store/apps/details?id=org.pca.app');
    expect(links[0].textContent).toBe(i18n.t('downloadApp.viewInstallationOptions'));
  });

  it('accepts an approved public landing destination as the app distribution URL', () => {
    configHoisted.childAppDistributionUrl = 'https://www.pcasafe.com/child-app/';

    const { container } = renderWithProviders(<DownloadApp />, { route: '/download' });

    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://www.pcasafe.com/child-app/');
    expect(screen.getByText(i18n.t('downloadApp.androidLandingPage'))).toBeTruthy();
    expect(links[0].textContent).toBe(i18n.t('downloadApp.viewInstallationOptions'));
  });

  it('labels a configured local debug APK as a test build, not a release', () => {
    configHoisted.childAppDistributionUrl = 'http://127.0.0.1:4002/app-debug.apk';
    configHoisted.childAppDistributionKind = 'local-test';

    renderWithProviders(<DownloadApp />, { route: '/download' });

    expect(screen.getByText(i18n.t('downloadApp.androidLocalTest'))).toBeTruthy();
    expect(screen.getByRole('link', { name: i18n.t('shell.downloadAppAndroid') }).getAttribute('href'))
      .toBe('http://127.0.0.1:4002/app-debug.apk');
  });

  it('presents both not-available cases as status, never as an error', () => {
    configHoisted.childAppDistributionUrl = null;

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
describe('Child App distribution URL scheme validation (real config/env)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadConfig(raw: string | undefined, production = false) {
    vi.resetModules();
    if (raw === undefined) vi.stubEnv('VITE_PCA_CHILD_APP_DISTRIBUTION_URL', '');
    else vi.stubEnv('VITE_PCA_CHILD_APP_DISTRIBUTION_URL', raw);
    vi.stubEnv('PROD', production);
    const mod = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env');
    return mod.config.childAppDistributionUrl;
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

  it('rejects loopback or insecure http download URLs in production builds', async () => {
    expect(await loadConfig('http://127.0.0.1:4002/app-debug.apk', true)).toBeNull();
    expect(await loadConfig('http://downloads.example.test/pca-child.apk', true)).toBeNull();
    expect(await loadConfig('https://downloads.example.test/pca-child.apk', true)).toBe(
      'https://downloads.example.test/pca-child.apk',
    );
  });
});
