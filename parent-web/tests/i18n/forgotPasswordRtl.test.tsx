import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import ForgotPassword from '../../src/pages/auth/ForgotPassword';
import ResetPassword from '../../src/pages/auth/ResetPassword';

function TestApp() {
  return (
    <Routes>
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  );
}

describe('forgot-password / reset-password pages in Arabic RTL', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders ForgotPassword fully in Arabic under RTL, not a raw translation key', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<TestApp />, { route: '/forgot-password' });
    expect(await screen.findByRole('heading', { name: 'إعادة تعيين كلمة المرور' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إرسال رمز إعادة التعيين' })).toBeInTheDocument();
    expect(screen.queryByText(/auth\./)).not.toBeInTheDocument();
  });

  it('renders the ResetPassword success state fully in Arabic under RTL', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<TestApp />, { route: '/reset-password' });
    await userEvent.type(screen.getByLabelText('البريد الإلكتروني'), 'parent@example.test');
    await userEvent.type(screen.getByLabelText('رمز التحقق'), '123456');
    await userEvent.type(screen.getByLabelText('كلمة المرور الجديدة'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('تأكيد كلمة المرور الجديدة'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'إعادة تعيين كلمة المرور' }));

    expect(await screen.findByRole('heading', { name: 'تمت إعادة تعيين كلمة المرور' })).toBeInTheDocument();
    expect(screen.queryByText(/auth\./)).not.toBeInTheDocument();
  });
});
