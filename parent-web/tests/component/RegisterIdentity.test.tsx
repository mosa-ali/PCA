import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import Register from '../../src/pages/auth/Register';
import { renderWithProviders } from '../utils/renderWithProviders';

const { mockRegister, mockClients } = vi.hoisted(() => {
  const register = vi.fn().mockResolvedValue({ status: 'PENDING_VERIFICATION' });
  const clients = {
    serviceAuth: {
      getSession: vi.fn().mockResolvedValue(null),
      register,
      stepUp: vi.fn(),
    },
    isFixtureBacked: true,
  };
  return { mockRegister: register, mockClients: clients };
});

vi.mock('../../src/api/client', () => ({ getApiClients: () => mockClients }));

afterEach(async () => {
  cleanup();
  mockRegister.mockClear();
  await i18n.changeLanguage('en');
  applyDocumentDirection('en');
});

describe('Parent registration identity fields', () => {
  it('requires first and last names before submitting registration', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />);

    await user.type(screen.getByLabelText('Last name'), 'الحسني');
    await user.type(screen.getByLabelText('Email address'), 'sara@example.test');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'A strong password 1!');
    await user.type(screen.getByLabelText('Confirm password'), 'A strong password 1!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your first and last name.');
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('sends trimmed Arabic names and the optional phone with the existing profile fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />);

    await user.type(screen.getByLabelText('First name'), ' سارة ');
    await user.type(screen.getByLabelText('Last name'), ' الحسني ');
    await user.type(screen.getByLabelText('Email address'), 'sara@example.test');
    await user.type(screen.getByLabelText('Phone number (optional)'), ' +967 712 345 678 ');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'A strong password 1!');
    await user.type(screen.getByLabelText('Confirm password'), 'A strong password 1!');
    expect(screen.getByLabelText('First name')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('Last name')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('Phone number (optional)')).toHaveAttribute('dir', 'ltr');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockRegister).toHaveBeenCalledWith('sara@example.test', 'A strong password 1!', 'A strong password 1!', {
      firstName: 'سارة',
      lastName: 'الحسني',
      phoneNumber: '+967 712 345 678',
      accountType: 'PARENT_GUARDIAN',
      estimatedChildCount: null,
    });
  });

  it('marks malformed optional phone as invalid and keeps the registration request uncalled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />);

    await user.type(screen.getByLabelText('First name'), 'Sara');
    await user.type(screen.getByLabelText('Last name'), 'Ali');
    await user.type(screen.getByLabelText('Email address'), 'sara@example.test');
    await user.type(screen.getByLabelText('Phone number (optional)'), '555-0100');
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'A strong password 1!');
    await user.type(screen.getByLabelText('Confirm password'), 'A strong password 1!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a phone number with its country code, such as +14155552671.');
    expect(screen.getByLabelText('Phone number (optional)')).toHaveAttribute('aria-invalid', 'true');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('renders Arabic identity labels and keeps mixed-script inputs readable in RTL', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    await act(async () => {
      renderWithProviders(<Register />);
      await Promise.resolve();
    });

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('الاسم الأول')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('اسم العائلة')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('رقم الهاتف (اختياري)')).toHaveAttribute('dir', 'ltr');
  });
});
