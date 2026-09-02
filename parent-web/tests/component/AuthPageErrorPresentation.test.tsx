import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import Login from '../../src/pages/auth/Login';
import Register from '../../src/pages/auth/Register';
import ForgotPassword from '../../src/pages/auth/ForgotPassword';
import ResetPassword from '../../src/pages/auth/ResetPassword';
import VerifyEmail from '../../src/pages/auth/VerifyEmail';

/**
 * The five auth pages used to each carry the same hard-coded inline
 * `style={{ color: 'var(--color-danger, #b00020)' }}` on their error text --
 * an off-palette Material red fallback, and colour as the only signal. They
 * now use the shared `.field-error` class (global.css), which adds a border
 * and tinted background on top of the token colour, so the error is not
 * conveyed by colour alone.
 */
describe('auth page error presentation and field association', () => {
  it('Register renders its error with the shared .field-error class, not an inline off-palette colour', async () => {
    renderWithProviders(<Register />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'does-not-match-at-all');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Passwords do not match.');
    expect(error).toHaveClass('field-error');
    expect(error.getAttribute('style')).toBeNull();
    expect(error.outerHTML).not.toContain('b00020');
  });

  it('Register associates the error with the fields it is about, and only marks those fields invalid', async () => {
    renderWithProviders(<Register />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'does-not-match-at-all');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const error = await screen.findByRole('alert');
    expect(error.id).toBe('register-error');

    for (const label of ['Email address', 'Confirm password']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-describedby', 'register-error');
    }
    // Password also carries its always-on requirements hint, so the error is
    // appended to that id rather than replacing it.
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', 'register-password-hint register-error');
    // The mismatch is genuinely a password-field error -- the email is not invalid.
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email address')).not.toHaveAttribute('aria-invalid');
  });

  it('ResetPassword renders its error with .field-error and associates it with the new-password fields', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>,
      { route: '/reset-password' },
    );

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'does-not-match-at-all');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveClass('field-error');
    expect(error.getAttribute('style')).toBeNull();
    expect(error.id).toBe('reset-password-error');
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-describedby', 'reset-password-error');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('aria-invalid', 'true');
    // A password mismatch says nothing about the reset code itself.
    expect(screen.getByLabelText('Verification code')).not.toHaveAttribute('aria-invalid');
  });

  it.each([
    ['Login', <Login key="login" />, 'Sign in'],
    ['Register', <Register key="register" />, 'Create account'],
    ['ForgotPassword', <ForgotPassword key="forgot" />, 'Send reset code'],
    ['ResetPassword', <ResetPassword key="reset" />, 'Reset password'],
    ['VerifyEmail', <VerifyEmail key="verify" />, 'Verify email'],
  ])('%s exposes its submit button busy state via aria-busy', async (_name, element, submitLabel) => {
    renderWithProviders(element);
    const submit = await screen.findByRole('button', { name: submitLabel as string });
    expect(submit).toHaveAttribute('aria-busy', 'false');
    expect(submit).not.toBeDisabled();
  });

  it('ForgotPassword marks its submit button busy while the request is in flight, then moves focus to the success heading', async () => {
    renderWithProviders(<ForgotPassword />);

    await userEvent.type(screen.getByLabelText('Email address'), 'parent@example.test');
    const submit = screen.getByRole('button', { name: 'Send reset code' });
    await userEvent.click(submit);

    // The dev ServiceAuth fixture delays ~120ms, so the in-flight state is
    // still current here (load can only delay resolution further, never
    // resolve it sooner).
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(submit).toBeDisabled();

    // The success state unmounts the whole form including the focused submit
    // button -- focus must land on the new heading, not fall back to <body>.
    const heading = await screen.findByRole('heading', { name: 'Check your email' });
    expect(document.activeElement).toBe(heading);
  });
});
