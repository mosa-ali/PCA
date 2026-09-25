import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import EnrollmentManagement from '../../src/pages/EnrollmentManagement';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="current location">{location.pathname}{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <button type="button" onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function renderPage(path = '/enrollment?keep=1') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 })));
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <EnrollmentManagement />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('EnrollmentManagement tabs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a stable query tab, preserves unrelated search parameters, and restores history state', async () => {
    const user = userEvent.setup();
    renderPage();

    const tablist = screen.getByRole('tablist');
    const accounts = screen.getByRole('tab', { name: 'Accounts' });
    const entitlements = screen.getByRole('tab', { name: 'Entitlements' });
    expect(accounts).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByLabelText('current location')).toHaveTextContent('/enrollment?keep=1&tab=accounts'));

    await user.click(entitlements);
    expect(entitlements).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('current location')).toHaveTextContent('/enrollment?keep=1&tab=entitlements');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'enrollment-tab-entitlements');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(accounts).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByLabelText('current location')).toHaveTextContent('/enrollment?keep=1&tab=accounts');

    await user.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(entitlements).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByLabelText('current location')).toHaveTextContent('tab=entitlements');
    expect(tablist).toBeInTheDocument();
  });

  it('loads a selected tab from the URL and supports arrow/Home/End focus navigation', async () => {
    const user = userEvent.setup();
    renderPage('/enrollment?tab=requests');

    const requests = screen.getByRole('tab', { name: 'Entitlement Requests' });
    const complimentary = screen.getByRole('tab', { name: 'Complimentary Capacity' });
    expect(requests).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'enrollment-tab-requests');

    requests.focus();
    await user.keyboard('{ArrowRight}');
    expect(complimentary).toHaveFocus();
    expect(complimentary).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Complimentary Capacity' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveFocus();
    expect(screen.getByLabelText('current location')).toHaveTextContent('tab=accounts');
  });

  it('replaces an unknown tab value with Accounts while preserving unrelated query parameters', async () => {
    renderPage('/enrollment?keep=1&tab=unknown');
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByLabelText('current location')).toHaveTextContent('/enrollment?keep=1&tab=accounts'));
  });

  it('keeps the selected tab and unrelated query state when a nested page applies filters', async () => {
    const user = userEvent.setup();
    renderPage('/enrollment?keep=1&tab=requests');

    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByRole('tab', { name: 'Entitlement Requests' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('current location')).toHaveTextContent('/enrollment?keep=1&tab=requests');
  });
});
