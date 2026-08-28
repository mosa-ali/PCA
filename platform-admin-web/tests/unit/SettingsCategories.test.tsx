// /settings never called the category-settings backend at all: the page
// issued only free-starter-defaults/currencies/market-mapping and then
// rendered a static "no sensitive-settings route exists on this backend
// surface" card -- a claim that stopped being true once
// backend/src/http/routes/platformadmin/settingsRoutes.ts shipped
// GET /platform-admin/settings/category/:category and
// PUT /platform-admin/settings/key/:settingKey (PCA-ADD-PA-043/044).
//
// These tests pin the wiring AND the RBAC split it must not widen:
//   * reads for all five categories,
//   * PAYMENT_PROVIDER rendered from its structurally masked view only,
//   * the sensitive write behind ADMINISTER_SENSITIVE_PLATFORM_SETTINGS
//     (APP_OWNER only) while ordinary categories use
//     ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS -- exactly
//     PlatformAdminSettingsService.requireMutate's own rule.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import Settings from '../../src/pages/Settings';
import { AuthProvider } from '../../src/state/AuthContext';
import { StepUpProvider } from '../../src/state/StepUpContext';
import { ToastProvider } from '../../src/state/ToastContext';
import { secureSession } from '../../src/security/secureSession';

const FREE_STARTER_DEFAULTS = { tier: 'FREE_STARTER', parentMemberLimit: 2, managedDeviceLimit: 3, updatedAt: '2026-01-01T00:00:00.000Z', updatedByAdminId: 'admin-1' };

/** GET /platform-admin/settings/category/BRANDING -- non-sensitive: full value. */
const BRANDING_ROWS = [
  { settingKey: 'branding.support_email', category: 'BRANDING', value: 'support@example.test', updatedAt: '2026-02-01T00:00:00.000Z', updatedByAdminId: 'admin-7' },
];

/** GET /platform-admin/settings/category/PAYMENT_PROVIDER -- masked: NO value field exists at all. */
const PAYMENT_PROVIDER_ROWS = [
  { settingKey: 'payment.provider_ref', category: 'PAYMENT_PROVIDER', maskedDisplay: '•••• 4321', updatedAt: '2026-03-01T00:00:00.000Z', updatedByAdminId: 'admin-9' },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Recorded {
  categoryReads: string[];
  puts: Array<{ url: string; body: unknown }>;
}

function renderPage(roles: string[]): Recorded {
  const recorded: Recorded = { categoryReads: [], puts: [] };
  secureSession.set('tok-ok', new Date(Date.now() + 60_000).toISOString());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/platform-admin/auth/whoami')) return Promise.resolve(jsonResponse(200, { adminId: 'admin-1', roles }));
      if (init?.method === 'PUT' && url.includes('/platform-admin/settings/key/')) {
        const body = JSON.parse(init.body as string) as { category: string; value: unknown; maskedDisplay?: string };
        recorded.puts.push({ url, body });
        const settingKey = decodeURIComponent(url.split('/platform-admin/settings/key/')[1]);
        return Promise.resolve(
          jsonResponse(
            200,
            body.category === 'PAYMENT_PROVIDER'
              ? { settingKey, category: body.category, maskedDisplay: body.maskedDisplay, updatedAt: '2026-04-01T00:00:00.000Z', updatedByAdminId: 'admin-1' }
              : { settingKey, category: body.category, value: body.value, updatedAt: '2026-04-01T00:00:00.000Z', updatedByAdminId: 'admin-1' },
          ),
        );
      }
      if (url.includes('/platform-admin/settings/category/')) {
        const category = url.split('/platform-admin/settings/category/')[1];
        recorded.categoryReads.push(category);
        if (category === 'BRANDING') return Promise.resolve(jsonResponse(200, { items: BRANDING_ROWS }));
        if (category === 'PAYMENT_PROVIDER') return Promise.resolve(jsonResponse(200, { items: PAYMENT_PROVIDER_ROWS }));
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      if (url.includes('/platform-admin/settings/free-starter-defaults')) return Promise.resolve(jsonResponse(200, FREE_STARTER_DEFAULTS));
      if (url.includes('/platform-admin/settings/currencies')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.includes('/platform-admin/settings/market-mapping')) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
    }),
  );
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/settings']}>
        <ToastProvider>
          <AuthProvider>
            <StepUpProvider>
              <Settings />
            </StepUpProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
  return recorded;
}

async function card(headingText: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: headingText });
  const section = heading.closest('section');
  if (!section) throw new Error(`no section for heading ${headingText}`);
  return section as HTMLElement;
}

// The initial render chain is: whoami resolves -> roles set -> 5 independent
// CategorySettingsCard components mount -> each fires its own effect-triggered
// fetch -> re-render. All 5 fetches genuinely run in parallel (see
// Settings.tsx's useEffect(load, [category]) per card, not a sequential loop),
// so this is a scheduling/CPU-contention sensitivity, not a real performance
// defect -- same class of fix as LocationPage.test.tsx's empty-state wait and
// Dashboard.test.tsx's rollup waitFor (601690a).
const INITIAL_LOAD_TIMEOUT_MS = 10_000;

describe('Settings: category settings surface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    secureSession.clear();
  });

  it('reads every named settings category from the backend and renders key/value/updatedAt', async () => {
    const recorded = renderPage(['APP_OWNER']);

    expect(await screen.findByText('branding.support_email', {}, { timeout: INITIAL_LOAD_TIMEOUT_MS })).toBeInTheDocument();
    await waitFor(() => expect(recorded.categoryReads.sort()).toEqual(['BRANDING', 'FEATURE_FLAG', 'MAINTENANCE', 'NOTIFICATION', 'PAYMENT_PROVIDER']));

    const branding = await card('Branding and support metadata');
    expect(within(branding).getByText('"support@example.test"')).toBeInTheDocument();
    expect(within(branding).getByText(new Date('2026-02-01T00:00:00.000Z').toLocaleString())).toBeInTheDocument();
    expect(within(branding).getByText('admin-7')).toBeInTheDocument();
  });

  it('renders PAYMENT_PROVIDER from its masked view only -- masked label, never a value', async () => {
    renderPage(['APP_OWNER']);

    const payments = await card('Sensitive settings — payment provider');
    expect(await within(payments).findByText('payment.provider_ref')).toBeInTheDocument();
    expect(within(payments).getByText('•••• 4321')).toBeInTheDocument();
    // The masked read carries no value field at all -- the table must not
    // invent one (an "undefined" cell is exactly that failure).
    expect(within(payments).queryByText('undefined')).not.toBeInTheDocument();
    expect(within(payments).getByRole('columnheader', { name: 'Masked label' })).toBeInTheDocument();
  });

  it('keeps the sensitive write behind ADMINISTER_SENSITIVE_PLATFORM_SETTINGS: PLATFORM_ADMIN may edit ordinary categories but not PAYMENT_PROVIDER', async () => {
    renderPage(['PLATFORM_ADMIN']);

    const branding = await card('Branding and support metadata');
    expect(await within(branding).findByLabelText('Setting key')).toBeInTheDocument();

    const payments = await card('Sensitive settings — payment provider');
    expect(within(payments).queryByLabelText('Setting key')).not.toBeInTheDocument();
    expect(within(payments).queryByLabelText('Masked label')).not.toBeInTheDocument();
    expect(within(payments).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('saves a non-sensitive setting through PUT /settings/key/:settingKey without a maskedDisplay', async () => {
    const recorded = renderPage(['PLATFORM_ADMIN']);

    const branding = await card('Branding and support metadata');
    await userEvent.type(await within(branding).findByLabelText('Setting key'), 'branding.support_url');
    await userEvent.type(within(branding).getByLabelText('Value (JSON)'), '"https://help.example.test"');
    await userEvent.click(within(branding).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(recorded.puts.length).toBe(1));
    expect(recorded.puts[0].url).toContain('/platform-admin/settings/key/branding.support_url');
    expect(recorded.puts[0].body).toEqual({ category: 'BRANDING', value: 'https://help.example.test' });
    expect(await within(branding).findByText('branding.support_url')).toBeInTheDocument();
  });

  it('requires and sends a masked label when an APP_OWNER writes a PAYMENT_PROVIDER setting', async () => {
    const recorded = renderPage(['APP_OWNER']);

    const payments = await card('Sensitive settings — payment provider');
    await userEvent.type(await within(payments).findByLabelText('Setting key'), 'payment.provider_ref');
    await userEvent.type(within(payments).getByLabelText('Value (JSON)'), '"provider-ref-abc"');
    await userEvent.type(within(payments).getByLabelText('Masked label'), '•••• 9999');
    await userEvent.click(within(payments).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(recorded.puts.length).toBe(1));
    expect(recorded.puts[0].body).toEqual({ category: 'PAYMENT_PROVIDER', value: 'provider-ref-abc', maskedDisplay: '•••• 9999' });
  });

  it('no longer claims the backend lacks a sensitive-settings route', async () => {
    renderPage(['APP_OWNER']);
    await screen.findByText('branding.support_email');
    expect(screen.queryByText(/No sensitive-settings route/)).not.toBeInTheDocument();
  });
});
