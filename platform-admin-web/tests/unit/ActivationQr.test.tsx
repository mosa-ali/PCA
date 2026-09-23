import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import Activation from '../../src/pages/Activation';

// The activation QR must be generated ENTIRELY inside this browser from the
// enrollment URI the authorized activation call already returned. These tests
// pin both halves of that: the code is really rendered and reachable, and the
// secret-bearing URI is not exposed, transmitted or persisted as a side effect
// of rendering it.
//
// The URI below is a throwaway fixture, not a real secret.

const ENROLLMENT_URI = 'otpauth://totp/PCA:owner@example.test?secret=JBSWY3DPEHPK3PXP&issuer=PCA';
const startMock = vi.fn();

vi.mock('../../src/api/platformAdminActivationClient', () => ({
  platformAdminActivationApi: {
    start: (token: string) => startMock(token),
    complete: vi.fn(),
  },
}));

function renderActivation() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/activate']}>
        <Activation />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Platform Admin activation QR', () => {
  beforeEach(async () => {
    startMock.mockReset();
    startMock.mockResolvedValue({ otpauthUri: ENROLLMENT_URI });
    // Activation reads the token straight off window.location, so the jsdom URL
    // is what supplies it.
    window.history.replaceState({}, '', '/activate?token=TOKEN123456');
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('renders the QR locally from the enrollment URI', async () => {
    renderActivation();

    // Present, and labelled, so it is not an unlabelled graphic to a screen
    // reader.
    expect(await screen.findByRole('img', { name: i18n.t('activation.qrAlt') })).toBeInTheDocument();
    // The textual instruction is the primary content -- a QR alone is not
    // usable by every assistive-tech user.
    expect(screen.getByText(i18n.t('activation.instructions'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('activation.qrHint'))).toBeInTheDocument();
  });

  it('generates the QR without any network call, and never as a remote image', async () => {
    // Any outbound request during QR generation would have to come through here.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderActivation();
    await screen.findByRole('img', { name: i18n.t('activation.qrAlt') });

    // No request at all: the URI is not handed to any renderer, local or remote.
    expect(fetchMock).not.toHaveBeenCalled();
    // And nothing in the page points at an external QR image.
    expect(container.querySelector('img')).toBeNull();
  });

  it('hides the raw enrollment URI by default and reveals it only on request', async () => {
    renderActivation();
    await screen.findByRole('img', { name: i18n.t('activation.qrAlt') });

    // Default: the secret-bearing URI is NOT in the DOM at all.
    expect(screen.queryByLabelText(i18n.t('activation.uri'))).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('otpauth://');

    await userEvent.click(screen.getByRole('button', { name: i18n.t('activation.showUri') }));
    const uriField = screen.getByLabelText(i18n.t('activation.uri'));
    expect(uriField).toHaveValue(ENROLLMENT_URI);

    // And it can be hidden again.
    await userEvent.click(screen.getByRole('button', { name: i18n.t('activation.hideUri') }));
    expect(screen.queryByLabelText(i18n.t('activation.uri'))).not.toBeInTheDocument();
  });

  it('does not persist the enrollment URI to web storage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderActivation();
    await screen.findByRole('img', { name: i18n.t('activation.qrAlt') });
    await userEvent.click(screen.getByRole('button', { name: i18n.t('activation.showUri') }));

    const written = setItemSpy.mock.calls.map((call) => String(call[1]));
    expect(written.some((value) => value.includes('otpauth'))).toBe(false);
    setItemSpy.mockRestore();
  });

  it('switching language keeps the activation state: the QR, the revealed URI and the entered password survive', async () => {
    renderActivation();
    await screen.findByRole('img', { name: i18n.t('activation.qrAlt') });
    await userEvent.type(screen.getByLabelText(i18n.t('activation.password')), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: i18n.t('activation.showUri') }));

    // Drive the language change through the same i18n instance the UI uses, so
    // the assertion does not depend on the switcher's own option labels.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });

    // A language change re-renders; it must not remount. If it remounted, the
    // component would restart the activation call and lose both the drawn QR and
    // everything already typed -- mid-ceremony that is unrecoverable, because
    // the enrollment secret is issued once.
    expect(screen.getByRole('img', { name: i18n.t('activation.qrAlt') })).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('activation.password'))).toHaveValue('correct-horse-battery');
    expect(screen.getByLabelText(i18n.t('activation.uri'))).toHaveValue(ENROLLMENT_URI);
    // The activation call ran exactly once, so the ceremony was not restarted.
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
