import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PcaApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';
import Genesis from '../../src/pages/auth/Genesis';
import { ServiceAuthError } from '../../src/api/real/realServiceAuthClient';
import i18n from '../../src/i18n';

// F-A: the user-facing half of the genesis failure contract.
//
// The release-visible defect this pins down: in the production composition the
// genesis verifier rejects every completion, the backend answered 401, and the
// client told a parent with a perfectly VALID session that it had expired.
// These tests drive the real page through the ceremony against the exact
// ServiceAuthError codes the transport now produces and assert the EXACT
// rendered copy per status, in EN and AR -- a valid session must never be
// reported as expired because genesis cannot complete.
const GENESIS_REQUIRED_SESSION = {
  state: 'GENESIS_REQUIRED',
  accountId: 'acc-1',
  displayName: 'acc-1',
  familyId: null,
  memberId: null,
  role: null,
  serviceAuthenticated: true,
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
// tests; this file exercises the page's failure-state handling only, so the
// key generation and completion-building steps are stubbed.
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

describe('Genesis failure copy (F-A)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    sessionMock.mockReset().mockResolvedValue(GENESIS_REQUIRED_SESSION);
    startGenesisStepUpMock.mockReset().mockResolvedValue(undefined);
    completeGenesisStepUpMock.mockReset().mockResolvedValue(undefined);
    requestGenesisChallengeMock.mockReset().mockResolvedValue({ challengeId: 'challenge-stub' });
    completeGenesisMock.mockReset().mockResolvedValue(undefined);
    signOutMock.mockReset().mockResolvedValue(undefined);
  });

  it('EN: a REJECTED genesis proof (GENESIS_REJECTED) shows the honest unavailable copy -- never session-expired -- and does not return to the code step', async () => {
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('GENESIS_REJECTED', 'rejected'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    // The code step is GONE: retrying cannot succeed and would burn another code.
    expect(screen.queryByLabelText(i18n.t('auth.codeLabel'))).not.toBeInTheDocument();
    // Sign-out stays reachable.
    expect(screen.getByRole('button', { name: i18n.t('auth.genesisSignOut') })).toBeInTheDocument();
  });

  it('EN: an UNAVAILABLE capability (NOT_IMPLEMENTED from the challenge) shows the same honest copy, not a session problem', async () => {
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

  it('EN: SESSION_EXPIRED keeps its own copy (a genuinely dead session is still reported honestly) and the code step remains available after re-authentication', async () => {
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('SESSION_EXPIRED', 'dead session'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(alert).not.toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(screen.getByLabelText(i18n.t('auth.codeLabel'))).toBeInTheDocument();
  });

  it('EN: RATE_LIMITED keeps the rate-limit copy', async () => {
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('RATE_LIMITED', 'slow down'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.rateLimited'));
  });

  it('EN: an unavailable capability on the PASSWORD step (startGenesisStepUp 503) shows the unavailable copy without leaving the password form', async () => {
    startGenesisStepUpMock.mockRejectedValueOnce(new ServiceAuthError('NOT_IMPLEMENTED', 'unavailable'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await userEvent.type(await screen.findByLabelText(i18n.t('auth.emailLabel')), 'parent@example.test');
    await userEvent.type(screen.getByLabelText(i18n.t('auth.passwordLabel')), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: i18n.t('auth.genesisStepUpSubmit') }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    expect(screen.queryByLabelText(i18n.t('auth.codeLabel'))).not.toBeInTheDocument();
  });

  it('AR: a rejected genesis proof shows the ARABIC unavailable copy, and the AR string reads as "not available right now", not as a rejection of the parent', async () => {
    await i18n.changeLanguage('ar');
    completeGenesisMock.mockRejectedValueOnce(new ServiceAuthError('GENESIS_REJECTED', 'rejected'));
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await driveToCodeStep();
    await submitCode();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('auth.genesisUnavailable'));
    // The Arabic copy must not collapse into the session-expired message.
    expect(alert).not.toHaveTextContent(i18n.t('serviceAuth.sessionExpired'));
    expect(screen.queryByLabelText(i18n.t('auth.codeLabel'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('auth.genesisSignOut') })).toBeInTheDocument();
  });
});
