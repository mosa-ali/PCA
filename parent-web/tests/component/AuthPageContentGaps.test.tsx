import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import Login from '../../src/pages/auth/Login';
import Register from '../../src/pages/auth/Register';
import VerifyEmail from '../../src/pages/auth/VerifyEmail';

/**
 * PCA product-completion ledger B003/B004/B008/B012: Register, VerifyEmail
 * and Login were flagged as having weak visual hierarchy / sparse content.
 * These are narrow, functional fixes -- not a redesign -- for the three
 * concrete gaps that inspection actually found.
 */
describe('auth page content gaps (B003/B004/B008/B012)', () => {
  it('Register shows the password length requirement up front, associated with the password field', () => {
    renderWithProviders(<Register />);

    const hint = screen.getByText('Must be at least 10 characters.');
    const passwordInput = screen.getByLabelText('Password');

    // Visible before any failed attempt, not just after a server rejection.
    expect(hint).toBeInTheDocument();
    expect(hint.id).toBe('register-password-hint');
    expect(passwordInput).toHaveAttribute('aria-describedby', 'register-password-hint');
  });

  it('Login carries an intro line under its heading, matching the pattern every other auth page already uses', () => {
    renderWithProviders(<Login />);

    const heading = screen.getByRole('heading', { name: 'Sign in to PCA' });
    const intro = screen.getByText('Sign in with your email and password to access your PCA parent console.');
    // The intro immediately follows the heading, same structure as
    // Register/VerifyEmail/ForgotPassword/ResetPassword (h1 then a body <p>).
    expect(heading.nextElementSibling).toBe(intro);
  });

  it('VerifyEmail no longer duplicates the register link -- only the clearly labeled resend link remains', () => {
    renderWithProviders(
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/register" element={<Register />} />
      </Routes>,
      { route: '/verify-email' },
    );

    const registerLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/register'));
    expect(registerLinks).toHaveLength(1);
    expect(registerLinks[0]).toHaveTextContent('Request a new one');
    expect(screen.queryByRole('link', { name: 'Create your PCA account' })).not.toBeInTheDocument();
  });
});
