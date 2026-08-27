import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../utils/renderWithProviders';
import VerifyEmail from '../../src/pages/auth/VerifyEmail';
import Register from '../../src/pages/auth/Register';

describe('VerifyEmail resend-code link', () => {
  it('navigates to Register with the current email prefilled, reusing the real register()-as-resend mechanism', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/register" element={<Register />} />
      </Routes>,
      { route: '/verify-email' },
    );

    expect(await screen.findByText("Didn't receive a code?")).toBeInTheDocument();

    const emailInput = screen.getByLabelText('Email address');
    await userEvent.type(emailInput, 'parent@example.test');
    await userEvent.click(screen.getByRole('link', { name: 'Request a new one' }));

    const registerEmailInput = await screen.findByLabelText('Email address');
    expect(registerEmailInput).toHaveValue('parent@example.test');
  });
});
