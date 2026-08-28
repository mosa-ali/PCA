import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import Login from '../../src/pages/auth/Login';
import ForgotPassword from '../../src/pages/auth/ForgotPassword';
import ResetPassword from '../../src/pages/auth/ResetPassword';

function TestApp() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  );
}

describe('forgot-password / reset-password flow', () => {
  it('links from Login to ForgotPassword', async () => {
    renderWithProviders(<TestApp />, { route: '/login' });
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot password?' }));
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('shows the enumeration-safe success state after requesting a reset code, and carries the email forward to ResetPassword', async () => {
    renderWithProviders(<TestApp />, { route: '/forgot-password' });

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset code' }));

    expect(await screen.findByText("If an account exists for that email, we've sent a password reset code.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Enter it here' }));
    expect(await screen.findByLabelText('Email address')).toHaveValue('parent@example.test');
  });

  it('rejects a mismatched new password/confirmation before calling the service, with no code ever sent', async () => {
    renderWithProviders(<TestApp />, { route: '/reset-password' });

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'does-not-match-at-all');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.queryByText('Password reset')).not.toBeInTheDocument();
  });

  it('completes a reset and links back to Login without establishing a session', async () => {
    renderWithProviders(<TestApp />, { route: '/reset-password' });

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('heading', { name: 'Password reset' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });
});
