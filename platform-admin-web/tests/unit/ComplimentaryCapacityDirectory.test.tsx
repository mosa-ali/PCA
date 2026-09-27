import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import ComplimentaryCapacity from '../../src/pages/entitlements/ComplimentaryCapacity';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

const family = {
  familyId: 'fam-capacity-1', createdAt: '2026-08-01T00:00:00.000Z', status: 'ACTIVE', planRef: 'FREE_STARTER',
  parentMemberLimit: 3, parentMemberUsed: 1, deviceLimit: 5, deviceActive: 2,
  activeGrantCount: 1, complimentaryParentMemberCapacity: 2, complimentaryDeviceCapacity: 4, complimentaryAccess: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ComplimentaryCapacity directory', () => {
  afterEach(() => { vi.unstubAllGlobals(); secureSession.clear(); });

  it('auto-loads capacity rows, then opens the existing grant detail workflow for a selected family', async () => {
    secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
      if (url.includes('/platform-admin/complimentary-capacity')) return Promise.resolve(jsonResponse(200, { items: [family], total: 1, limit: 20, offset: 0 }));
      if (url.includes('/platform-admin/families/fam-capacity-1/complimentary-grants')) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    }));

    render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/enrollment-management?tab=complimentary-capacity']}>
      <ToastProvider><AuthProvider><StepUpProvider><ComplimentaryCapacity /></StepUpProvider></AuthProvider></ToastProvider>
    </MemoryRouter></I18nextProvider>);

    expect(await screen.findByText('fam-capacity-1')).toBeInTheDocument();
    expect(screen.getByText('1; None')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(calls.some((url) => url.includes('/families/fam-capacity-1/complimentary-grants'))).toBe(true));
    expect(screen.getByRole('heading', { name: 'Complimentary grants' })).toBeInTheDocument();
  });
});
