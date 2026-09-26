import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingPlans from '../../src/pages/billing/BillingPlans';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const SAMPLE_PLAN = {
  planId: 'plan-1', planCode: 'FAMILY_STANDARD', planVersion: 3, status: 'ACTIVE', billingCadence: 'MONTHLY',
  defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 10, priceBookId: 'pb-1', createdAt: '2026-01-01T00:00:00.000Z',
};

function renderPage(browseCalls: string[], total = 1, items = [SAMPLE_PLAN], filteredItems: typeof items = items) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.includes('/platform-admin/billing/plans')) {
      browseCalls.push(url);
      const query = new URL(url).searchParams;
      const filtered = Boolean(query.get('planCode') || query.get('status') || query.get('billingCadence'));
      const resultItems = filtered ? filteredItems : items;
      return Promise.resolve(jsonResponse(200, { items: resultItems, total: filtered ? filteredItems.length : total, limit: Number(query.get('limit') ?? 20), offset: Number(query.get('offset') ?? 0) }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  }));
  return render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/commercial-pricing?tab=plans']}>
    <ToastProvider><AuthProvider><StepUpProvider><BillingPlans /></StepUpProvider></AuthProvider></ToastProvider>
  </MemoryRouter></I18nextProvider>);
}

describe('BillingPlans directory and sub-tabs', () => {
  afterEach(() => { vi.unstubAllGlobals(); secureSession.clear(); });

  it('auto-loads the paginated All Plans directory', async () => {
    const calls: string[] = [];
    renderPage(calls);
    expect(await screen.findByText('FAMILY_STANDARD')).toBeInTheDocument();
    expect(new URL(calls[0]).pathname).toBe('/platform-admin/billing/plans');
    expect(screen.getByRole('tab', { name: 'All plans' })).toHaveAttribute('aria-selected', 'true');
  });

  it('submits plan code, status, and cadence together as server-side filters', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findByText('FAMILY_STANDARD');
    await userEvent.type(screen.getByLabelText('Plan code (exact)'), 'FAMILY_STANDARD');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await userEvent.selectOptions(screen.getByLabelText('Billing cadence'), 'MONTHLY');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    const query = new URL(calls.at(-1)!);
    expect(query.searchParams.get('planCode')).toBe('FAMILY_STANDARD');
    expect(query.searchParams.get('status')).toBe('ACTIVE');
    expect(query.searchParams.get('billingCadence')).toBe('MONTHLY');
    expect(query.searchParams.get('offset')).toBe('0');
  });

  it('clears the active plan filters and reloads the unfiltered first page', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findByText('FAMILY_STANDARD');
    await userEvent.type(screen.getByLabelText('Plan code (exact)'), 'FAMILY_STANDARD');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(new URL(calls.at(-1)!).searchParams.get('planCode')).toBe('FAMILY_STANDARD');

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const clearedQuery = new URL(calls.at(-1)!);
    expect(clearedQuery.searchParams.has('planCode')).toBe(false);
    expect(clearedQuery.searchParams.has('status')).toBe(false);
    expect(clearedQuery.searchParams.has('billingCadence')).toBe(false);
    expect(clearedQuery.searchParams.get('offset')).toBe('0');
  });

  it('paginates the server-side list', async () => {
    const calls: string[] = [];
    renderPage(calls, 45);
    await screen.findByText('FAMILY_STANDARD');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(new URL(calls.at(-1)!).searchParams.get('offset')).toBe('20');
  });

  it('distinguishes an empty plans directory from a filter with no matches', async () => {
    const emptyCalls: string[] = [];
    renderPage(emptyCalls, 0, []);
    expect(await screen.findByText('No plans have been created yet.')).toBeInTheDocument();

    cleanup();
    secureSession.clear();
    vi.unstubAllGlobals();
    const filteredCalls: string[] = [];
    renderPage(filteredCalls, 1, [SAMPLE_PLAN], []);
    await screen.findByText('FAMILY_STANDARD');
    await userEvent.type(screen.getByLabelText('Plan code (exact)'), 'MISSING_PLAN');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('No plans match these filters.')).toBeInTheDocument();
    expect(filteredCalls.some((url) => !new URL(url).searchParams.has('planCode'))).toBe(true);
  });

  it('keeps the creation workflow separate from the list and can open it for an existing plan code', async () => {
    const calls: string[] = [];
    renderPage(calls);
    await screen.findByText('FAMILY_STANDARD');
    await userEvent.click(screen.getByRole('tab', { name: 'Create plan' }));
    expect(screen.getByLabelText('Plan code')).toHaveValue('');
    expect(screen.queryByRole('table')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'All plans' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create next version' }));
    expect(screen.getByLabelText('Plan code')).toHaveValue('FAMILY_STANDARD');
    expect(screen.getByRole('tab', { name: 'Create plan' })).toHaveAttribute('aria-selected', 'true');
  });
});
