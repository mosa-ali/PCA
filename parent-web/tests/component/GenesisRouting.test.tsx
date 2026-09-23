import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { PcaApiClients } from '../../src/api/client';
import { renderWithProviders } from '../utils/renderWithProviders';
import Genesis from '../../src/pages/auth/Genesis';

// A session can be LOADED and yet be null: the parent reached /genesis without
// signing in (a bookmark, a stale link, or an expired cookie). The page used to
// render its password form in that state anyway, but every endpoint behind it --
// requestGenesisStepUp, completeGenesisStepUp, the challenge and the completion
// -- requires a session, so the only possible outcome was a 401 the parent could
// not act on. There is no session to onboard, so this must send them to sign in.
//
// getApiClients() is mocked so AuthProvider resolves to a genuinely null session;
// the dev ServiceAuth fixture always yields a session and so cannot reach this
// state at all.
vi.mock('../../src/api/client', () => ({
  getApiClients: () =>
    ({
      serviceAuth: {
        getSession: vi.fn().mockResolvedValue(null),
      },
      isFixtureBacked: false,
    }) as unknown as PcaApiClients,
}));

describe('Genesis onboarding routing', () => {
  const assignMock = vi.fn();

  beforeEach(() => {
    assignMock.mockReset();
    // jsdom's window.location.assign cannot be spied on directly
    // (non-configurable); replacing the whole object is the standard workaround,
    // as in LoginStepUp.test.tsx.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  it('redirects a loaded but unauthenticated session to sign-in instead of rendering the ceremony', async () => {
    renderWithProviders(<Genesis />, { route: '/genesis' });

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/login'));
    // Not the console: there is no family and no session to console into.
    expect(assignMock).not.toHaveBeenCalledWith('/dashboard');
  });
});
