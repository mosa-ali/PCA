import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import BillingPricing from '../../src/pages/billing/BillingPricing';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const existingPrice = {
  priceBookId: 'price-1', commercialMarket: 'GLOBAL_OTHER', currencyCode: 'USD', targetDeviceLimit: 1,
  price: { amountMinor: '1000', currencyCode: 'USD' }, priceBookVersion: 1, status: 'ACTIVE',
  effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveTo: null, createdByAdminId: 'admin-1', createdAt: '2026-09-01T00:00:00.000Z',
};

function renderPage(serverPrices: typeof existingPrice[], calls: string[] = []) {
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'] }));
    if (url.endsWith('/platform-admin/billing/price-book') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { commercialMarket: string; currencyCode: string; targetDeviceLimit: number; amountMinor: string };
      const price = { ...existingPrice, priceBookId: `price-${serverPrices.length + 1}`, commercialMarket: body.commercialMarket, currencyCode: body.currencyCode, targetDeviceLimit: body.targetDeviceLimit, price: { amountMinor: body.amountMinor, currencyCode: body.currencyCode }, priceBookVersion: serverPrices.length + 1, effectiveFrom: new Date().toISOString(), createdAt: new Date().toISOString() };
      serverPrices.unshift(price);
      return Promise.resolve(jsonResponse(201, price));
    }
    if (url.includes('/platform-admin/billing/price-book')) {
      calls.push(url);
      const query = new URL(url).searchParams;
      const filtered = serverPrices.filter((row) =>
        (!query.get('commercialMarket') || row.commercialMarket === query.get('commercialMarket'))
        && (!query.get('currencyCode') || row.currencyCode === query.get('currencyCode'))
        && (!query.get('targetDeviceLimit') || row.targetDeviceLimit === Number(query.get('targetDeviceLimit')))
        && (query.get('activeOnly') !== 'true' || row.status === 'ACTIVE'));
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 20);
      return Promise.resolve(jsonResponse(200, { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  }));
  const view = render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={['/price-book']}>
    <ToastProvider><AuthProvider><StepUpProvider><Routes>
      <Route path="/price-book" element={<><Link to="/away">Away</Link><BillingPricing /></>} />
      <Route path="/away" element={<Link to="/price-book">Back to Price Book</Link>} />
    </Routes></StepUpProvider></AuthProvider></ToastProvider>
  </MemoryRouter></I18nextProvider>);
  return { ...view, calls };
}

describe('Price Book authoritative directory persistence', () => {
  afterEach(() => { vi.unstubAllGlobals(); secureSession.clear(); });

  it('auto-loads the active directory from the list API on entry', async () => {
    const { calls } = renderPage([existingPrice]);
    expect(await screen.findByText('$10.00')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get('activeOnly')).toBe('true');
  });

  it('submits market, currency, target limit, and active-only filters to the server and clears them', async () => {
    const calls: string[] = [];
    renderPage([existingPrice], calls);
    await screen.findByText('$10.00');
    await userEvent.selectOptions(document.getElementById('pb-filter-market')!, 'GLOBAL_OTHER');
    await userEvent.selectOptions(document.getElementById('pb-filter-currency')!, 'USD');
    await userEvent.type(screen.getByLabelText('Target device limit', { selector: '#pb-filter-target-limit' }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    let query = new URL(calls.at(-1)!);
    expect(query.searchParams.get('commercialMarket')).toBe('GLOBAL_OTHER');
    expect(query.searchParams.get('currencyCode')).toBe('USD');
    expect(query.searchParams.get('targetDeviceLimit')).toBe('1');
    expect(query.searchParams.get('activeOnly')).toBe('true');

    const beforeClear = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(beforeClear));
    query = new URL(calls.at(-1)!);
    expect(query.searchParams.has('commercialMarket')).toBe(false);
    expect(query.searchParams.has('currencyCode')).toBe(false);
    expect(query.searchParams.has('targetDeviceLimit')).toBe(false);
    expect(query.searchParams.get('activeOnly')).toBe('true');
  });

  it('uses server-side pagination with a stable 20-row page size', async () => {
    const calls: string[] = [];
    const prices = Array.from({ length: 21 }, (_, index) => ({ ...existingPrice, priceBookId: `price-${index + 1}`, targetDeviceLimit: index + 1 }));
    renderPage(prices, calls);
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(21));
    expect(new URL(calls[0]).searchParams.get('limit')).toBe('20');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(new URL(calls.at(-1)!).searchParams.get('offset')).toBe('20');
  });

  it('re-reads after publish and again after navigating away and back', async () => {
    const serverPrices: typeof existingPrice[] = [];
    const user = userEvent.setup();
    const { calls } = renderPage(serverPrices);
    await screen.findByText('No price book entries have been created yet.');
    await user.type(screen.getByLabelText('Amount'), '10.00');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('$10.00')).toBeInTheDocument();
    expect(await screen.findByText('Price version 1 published.')).toBeInTheDocument();
    expect(serverPrices).toHaveLength(1);
    expect(calls.length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('link', { name: 'Away' }));
    await user.click(screen.getByRole('link', { name: 'Back to Price Book' }));
    expect(await screen.findByText('$10.00')).toBeInTheDocument();
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('distinguishes an empty price book from a filter with no matches', async () => {
    const empty = renderPage([]);
    expect(await screen.findByText('No price book entries have been created yet.')).toBeInTheDocument();
    expect(empty.calls.some((url) => new URL(url).searchParams.get('activeOnly') === 'false')).toBe(true);

    cleanup();
    secureSession.clear();
    vi.unstubAllGlobals();
    const populated = renderPage([existingPrice]);
    expect(await screen.findByText('$10.00')).toBeInTheDocument();
    await userEvent.selectOptions(document.getElementById('pb-filter-market')!, 'YEMEN');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No prices match these filters.')).toBeInTheDocument();
    expect(populated.calls.some((url) => new URL(url).searchParams.get('activeOnly') === 'false')).toBe(true);
  });
});
