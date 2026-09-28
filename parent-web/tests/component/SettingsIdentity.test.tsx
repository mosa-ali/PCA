import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import Settings from '../../src/pages/Settings';
import { renderWithProviders } from '../utils/renderWithProviders';

const { profile, mockGetIdentity, mockUpdateNames, mockRevokeAllSessions, mockClients } = vi.hoisted(() => {
  const currentProfile = {
    firstName: null as string | null,
    lastName: null as string | null,
    email: 'amina@example.test',
    phoneNumber: '+967712345678',
    emailVerified: true,
    phoneVerified: false,
  };
  const getIdentity = vi.fn().mockResolvedValue(currentProfile);
  const updateNames = vi.fn(async ({ firstName, lastName }: { firstName: string; lastName: string }) => ({
    ...currentProfile,
    firstName,
    lastName,
  }));
  const revokeAllSessions = vi.fn().mockResolvedValue(undefined);
  const clients = {
    serviceAuth: {
      getSession: vi.fn().mockResolvedValue(null),
      stepUp: vi.fn(),
      revokeAllSessions,
    },
    parentPreferences: {
      get: vi.fn().mockResolvedValue({ language: 'en' }),
      update: vi.fn().mockResolvedValue({ language: 'en' }),
    },
    parentIdentity: { get: getIdentity, updateNames },
    isFixtureBacked: true,
  };
  return { profile: currentProfile, mockGetIdentity: getIdentity, mockUpdateNames: updateNames, mockRevokeAllSessions: revokeAllSessions, mockClients: clients };
});

vi.mock('../../src/api/client', () => ({ getApiClients: () => mockClients }));

afterEach(async () => {
  cleanup();
  mockGetIdentity.mockClear();
  mockUpdateNames.mockClear();
  mockRevokeAllSessions.mockReset().mockResolvedValue(undefined);
  await i18n.changeLanguage('en');
  applyDocumentDirection('en');
});

describe('Settings identity profile', () => {
  it('shows available contact details and verification state while allowing legacy names to be added', async () => {
    renderWithProviders(<Settings />);

    expect(await screen.findByText(profile.email)).toBeInTheDocument();
    expect(screen.getByText(profile.phoneNumber)).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('');
    expect(screen.getByLabelText('Last name')).toHaveValue('');
    expect(screen.getByLabelText('First name')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('Last name')).toHaveAttribute('dir', 'auto');
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument();
  });

  it('saves validated first and last names without offering contact changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);

    const firstName = await screen.findByLabelText('First name');
    const lastName = screen.getByLabelText('Last name');
    await user.type(firstName, '  أمينة ');
    await user.type(lastName, 'الحسني  ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => expect(mockUpdateNames).toHaveBeenCalledWith({ firstName: 'أمينة', lastName: 'الحسني' }));
  });

  it('rejects missing legacy names before sending an update', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);

    await screen.findByLabelText('First name');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your first and last name.');
    expect(mockUpdateNames).not.toHaveBeenCalled();
  });

  it('localizes identity fields in Arabic and preserves RTL while numbers stay left-to-right', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    renderWithProviders(<Settings />);

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(await screen.findByLabelText('الاسم الأول')).toHaveAttribute('dir', 'auto');
    expect(screen.getByLabelText('اسم العائلة')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(profile.email).closest('bdi')).toHaveAttribute('dir', 'auto');
  });
});

describe('Parent session management', () => {
  const assignMock = vi.fn();
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('requires explicit confirmation before revoking all sessions, then navigates to sign-in', async () => {
    const user = userEvent.setup();
    assignMock.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign: assignMock } });
    renderWithProviders(<Settings />);

    await user.click(await screen.findByRole('button', { name: 'Sign out all sessions' }));
    expect(screen.getByRole('status')).toHaveTextContent('This will sign you out here and on every other browser.');
    expect(mockRevokeAllSessions).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/This will sign you out here/)).not.toBeInTheDocument();
    expect(mockRevokeAllSessions).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sign out all sessions' }));
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(mockRevokeAllSessions).toHaveBeenCalledOnce();
    expect(assignMock).toHaveBeenCalledWith('/login');
  });

  it('keeps the confirmation visible and reports failure when revoke-all is rejected', async () => {
    const user = userEvent.setup();
    mockRevokeAllSessions.mockRejectedValueOnce(new Error('SESSION_EXPIRED'));
    renderWithProviders(<Settings />);

    await user.click(await screen.findByRole('button', { name: 'Sign out all sessions' }));
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not sign out all sessions.');
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled();
  });
});
