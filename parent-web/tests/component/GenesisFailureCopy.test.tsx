import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PcaApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';
import Genesis from '../../src/pages/auth/Genesis';
import { ServiceAuthError } from '../../src/api/real/realServiceAuthClient';
import i18n from '../../src/i18n';

// F-A-min, client half (Claude CLAUDE_20260924T0540_LEAD_release_scope_ruling, W2/W4).
//
// The user-facing contract, in EN and AR:
//  - a VALID authenticated parent in a deployment whose genesis cryptography is
//    unavailable sees the family-setup-unavailable state ON LOAD -- never a
//    password prompt and never "your session expired";
//  - an absent capability (NOT_IMPLEMENTED) is terminal, not a retry loop;
//  - a genuinely dead session (SESSION_EXPIRED) goes to sign-in, the one case
//    where re-authenticating is the fix;
//  - a rejected proof restarts the ceremony from the password step with its own
//    honest copy (unreachable in production while the verifier rejects, so no
//    retry-ceremony UX in this release).
const GENESIS_REQUIRED_SESSION = {
  state: 'GENESIS_REQUIRED',
  accountId: 'acc-1',
  displayName: 'acc-1',
  familyId: null,
  memberId: null,
  role: null,
  serviceAuthenticated: true,
  genesisAvailable: true as boolean | undefined,
};

const sessionMock = vi.fn();
const startGenesisStepUpMock = vi.fn();
const completeGenesisStepUpMock = vi.fn();
const requestGenesisChallengeMock = vi.fn();
const completeGenesisMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  getApiClients: () =>
    ({
      serviceAuth: {
        getSession: sessionMock,
        startGenesisStepUp: startGenesisStepUpMock,
        completeGenesisStepUp: completeGenesisStepUpMock,
        requestGenesisChallenge: requestGenesisChallengeMock,
        completeGenesis: completeGenesisMock,
        signOut: signOutMock,
      },
      isFixtureBacked: false,
    }) as unknown as PcaApiClients,
}));

// The ceremony's Web Crypto work is covered by genesisProof/trustedEndpointKey
// tests; this file exercises the page's state handling only, so the key
// generation and completion-building steps are stubbed.
vi.mock('../../src/security/genesisCeremony', () => ({
  createGenesisDeviceKey: vi.fn().mockResolvedValue({ publicKey: 'stub-public-key', privateKey: {} }),
  buildGenesisCompletion: vi.fn().mockResolvedValue({
    challengeId: 'challenge-stub',
    proofSignature: 'proof-stub',
    anchorSignature: 'anchor-stub',
    attestationSignature: 'attestation-stub',
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
  }),
  persistGenesisDeviceKey: vi.fn().mockResolvedValue(undefined),
}));

async function driveToCodeStep() {
  await userEvent.type(await screen.findByLabelText(i18n.t('auth.emailLabel')), 'parent@example.test');
  await userEvent.type(screen.getByLabelText(i18n.t('auth.passwordLabel')), 'correct-horse-battery');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('auth.genesisStepUpSubmit') }));
  await screen.findByLabelText(i18n.t('auth.codeLabel'));
}

async function submitCode() {
  await userEvent.type(screen.getByLabelText(i18n.t('auth.codeLabel')), '123456');
  await userEvent.click(screen.getByRole('button', { name: i18n.t('auth.genesisCodeSubmit') }));
}

describe('Genesis failure copy (F-A-min)', () => {
  const assignMock = vi.fn();

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    sessionMock.mockReset().mockResolvedValue({ ...GENESIS_REQUIRED_SESSION });
    startGenesisStepUpMock.mockReset().mockResolvedValue(undefined);
    completeGenesisStepUpMock.mockReset().mockResolvedValue(undefined);
    requestGenesisChallengeMock.mockReset().mockResolvedValue({ challengeId: 'challenge-stub' });
    completeGenesisMock.mockReset().mockResolvedValue(undefined);
    signOutMock.mockReset().mockResolvedValue(undefined);
    assignMock.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  // ---------------------------------------------------------------------
  // Load-time: the session itself says the capability is absent
  // ---------------------------------------------------------------------

  it('EN: a valid session with genesisAvailable=false renders the unavailable state ON LOAD -- no password prompt, no session-expired copy, sign-out present', async () => {
    sessionMock.mockResolvedValue({ ...GENESIS_REQUIRED_SESSION, genesisAvailable: false });
    renderWithProviders(<Genesis />, { route: '/genesis' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(screen.queryByLabelText(i18n.t('auth.passwordLabel'))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t('auth.emailLabel'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('auth.genesisSignOut') })).toBeInTheDocument();
    // The step-up endpoints are never called: no code is requested, none burned.
    expect(startGenesisStepUpMock).not.toHaveBeenCalled();
  });

  it('AR: the same load-time state renders the ARABIC unavailable copy', async () => {
    await i18n.changeLanguage('ar');
    sessionMock.mockResolvedValue({ ...GENESIS_REQUIRED_SESSION, genesisAvailable: false });
    renderWithProviders(<Genesis />, { route: '/genesis' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(screen.queryByLabelText(i18n.t('auth.passwordLabel'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('auth.genesisSignOut') })).toBeInTheDocument();
  });

  it('EN: genesisAvailable=true (or absent) keeps the normal ceremony -- the password form renders', async () => {
    renderWithProviders(<Genesis />, { route: '/genesis' });
    expect(await screen.findByLabelText(i18n.t('auth.passwordLabel'))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Absent capability discovered mid-ceremony -> terminal UNAVAILABLE
  // ---------------------------------------------------------------------

  it('EN: NOT_IMPLEMENTED from the step-up (503) moves to UNAVAILABLE without burning anything further', async () => {
    startGenesisStepUpMock.mockRejectedValueOnce(new ServiceAuthError('NOT_IMPLEMENTED', 'unavailable'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await userEvent.type(await screen.findByLabelText(i18n.t('auth.emailLabel')), 'parent@example.test');
    await userEvent.type(screen.getByLabelText(i18n.t('auth.passwordLabel')), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: i18n.t('auth.genesisStepUpSubmit') }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(screen.queryByLabelText(i18n.t('auth.passwordLabel'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('auth.genesisSignOut') })).toBeInTheDocument();
  });

  it('EN: NOT_IMPLEMENTED from the challenge (503) moves to UNAVAILABLE, not back to the code step', async () => {
    requestGenesisChallengeMock.mockRejectedValueOnce(new ServiceAuthError('NOT_IMPLEMENTED', 'unavailable'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(screen.queryByLabelText(i18n.t('auth.codeLabel'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('auth.genesisSignOut') })).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Genuinely dead session -> sign-in (the one case re-auth is the fix)
  // ---------------------------------------------------------------------

  it('EN: SESSION_EXPIRED sends the parent to sign-in instead of showing a dead-end copy', async () => {
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('SESSION_EXPIRED', 'dead session'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    expect(assignMock).toHaveBeenCalledWith('/login');
  });

  // ---------------------------------------------------------------------
  // Rejected proof -> honest copy, restart from the password step
  // ---------------------------------------------------------------------

  it('EN: GENESIS_REJECTED shows the rejected-setup copy and returns to the PASSWORD stage -- never the session-expired copy', async () => {
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('GENESIS_REJECTED', 'rejected'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisRejected'));
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(alert).not.toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    // Restarted at the beginning of the ceremony: password form, no code form.
    expect(screen.getByLabelText(i18n.t('auth.passwordLabel'))).toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t('auth.codeLabel'))).not.toBeInTheDocument();
  });

  it('AR: GENESIS_REJECTED renders the ARABIC rejected-setup copy and the password stage', async () => {
    await i18n.changeLanguage('ar');
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('GENESIS_REJECTED', 'rejected'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisRejected'));
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(screen.getByLabelText(i18n.t('auth.passwordLabel'))).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------
  // Rate limiting keeps its own copy and the form
  // ---------------------------------------------------------------------

  it('EN: RATE_LIMITED keeps the rate-limit copy and the form remains usable', async () => {
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('RATE_LIMITED', 'slow down'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.rateLimited'));
    expect(screen.getByLabelText(i18n.t('auth.codeLabel'))).toBeInTheDocument();
  });
});
