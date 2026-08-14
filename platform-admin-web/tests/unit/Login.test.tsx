import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../src/pages/Login';
import { AuthProvider } from '../../src/state/AuthContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Login page', () => {
  beforeEach(() => {
    secureSession.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a 6-digit code before the submit button is enabled -- MFA cannot be skipped', async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'owner@pca.test');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');

    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('strips non-digit characters typed into the TOTP field', async () => {
    renderLogin();
    const user = userEvent.setup();
    const totpInput = screen.getByLabelText(/authenticator code/i) as HTMLInputElement;

    await user.type(totpInput, 'a1b2c3d4');
    expect(totpInput.value).toBe('1234');
  });

  it('shows a generic unauthorized error on bad credentials, never revealing which factor failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'owner@pca.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.type(screen.getByLabelText(/authenticator code/i), '000000');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email, password, or authenticator code/i);
  });

  it('shows a rate-limit-specific message on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate_limited' })));
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'owner@pca.test');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('on success, stores the session token in memory only (never in localStorage)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { sessionToken: 'tok-1', expiresAt: new Date(Date.now() + 60_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] })),
    );
    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'owner@pca.test');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.type(screen.getByLabelText(/authenticator code/i), '123456');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // secureSession is verified in-memory-only (never touches Web Storage)
    // by tests/unit/secureSession.test.ts; this test only asserts Login
    // actually routes the token through that abstraction.
    await waitFor(() => expect(secureSession.get()?.token).toBe('tok-1'));
  });
});
