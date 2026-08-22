import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PcaApiClients } from '../../src/api/client';
import { AuthProvider, useAuth } from '../../src/state/AuthContext';

// AuthProvider.refresh() previously had no .catch() on
// clients.serviceAuth.getSession() -- a rejection (RealServiceAuthClient
// throws ServiceAuthError('NETWORK_ERROR', ...) on a fetch failure, or
// ServiceAuthError('UNKNOWN', ...) on an unexpected non-401 status) left
// `loading` stuck at `true` forever, since nothing ever called
// setLoading(false) on that path. AppLayout's `if (loading) return null`
// then rendered a permanently blank, unrecoverable page instead of its
// normal `session === null` -> redirect-to-/login behaviour, plus an
// unhandled promise rejection in the console. This test exercises
// AuthProvider directly (not through AppLayout) against a getSession() that
// rejects, so getApiClients() is mocked wholesale for this file only --
// the dev-fixture DevServiceAuthClient used by every other test file never
// rejects, so this failure mode cannot be reproduced through the normal
// renderWithProviders() dev-mode path.
const getSessionMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  getApiClients: () =>
    ({
      serviceAuth: { getSession: getSessionMock },
      isFixtureBacked: false,
    }) as unknown as PcaApiClients,
}));

function Probe() {
  const { session, loading } = useAuth();
  return (
    <div>
      <p data-testid="loading">{String(loading)}</p>
      <p data-testid="session">{session === null ? 'null' : 'present'}</p>
    </div>
  );
}

describe('AuthProvider session-check failure handling', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  it('fails closed (session=null, loading=false) instead of hanging forever when getSession() rejects', async () => {
    getSessionMock.mockRejectedValue(new Error('Could not reach the PCA parent-account service: network down'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('session')).toHaveTextContent('null');
  });

  it('still resolves normally (session=present) when getSession() succeeds, unaffected by the new catch handler', async () => {
    getSessionMock.mockResolvedValue({
      accountId: 'acct-1',
      displayName: 'Dev Parent',
      familyId: 'family-1',
      memberId: 'member-1',
      role: 'OWNER',
      serviceAuthenticated: true,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('session')).toHaveTextContent('present');
  });
});
