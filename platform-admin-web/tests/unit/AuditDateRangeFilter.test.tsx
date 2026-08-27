// The backend's GET /platform-admin/audit already accepts since/until
// date-range query params (backend/src/http/routes/platformadmin/auditRoutes.ts),
// but the UI never exposed a way to set them -- every other filter
// (eventType/actorAdminId/targetRef/result) worked, this one silently
// didn't. This proves the filter form now actually sends them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import Audit from '../../src/pages/Audit';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetchFor(auditCalls: string[]) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/audit')) {
      auditCalls.push(url);
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
}

function renderPage(auditCalls: string[]) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', mockFetchFor(auditCalls));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/audit']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Audit />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Audit date-range filter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('sends since/until in the query string once the filter form is submitted', async () => {
    const auditCalls: string[] = [];
    renderPage(auditCalls);

    const sinceInput = await screen.findByLabelText('From date');
    const untilInput = screen.getByLabelText('To date');
    await userEvent.type(sinceInput, '2026-01-01');
    await userEvent.type(untilInput, '2026-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    const lastCall = auditCalls[auditCalls.length - 1];
    expect(lastCall).toContain('since=2026-01-01');
    expect(lastCall).toContain('until=2026-01-31');
  });
});
