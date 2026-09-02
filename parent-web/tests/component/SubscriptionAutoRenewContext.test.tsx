// B088 (product-completion ledger): a parent looking at Subscription.tsx's
// "Cancel auto-renew" button had no idea what canceling would actually do
// (does the plan die immediately? get refunded? can it be undone?), and a
// parent who HAD already canceled had no way back -- resumeAutoRenew was
// fully wired end-to-end in the API clients this session (see
// devBillingClient.ts/realBillingClient.ts) but never reachable from the
// UI. This proves both: honest context text next to each action, and the
// resume path actually working from the page.
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import Subscription from '../../src/pages/Subscription';
import { renderWithProviders } from '../utils/renderWithProviders';
import {
  __resetDevBillingStateForTests,
  __setDevSubscriptionForTests,
  __setDevEntitlementTierForTests,
} from '../../src/api/dev/devBillingClient';
import en from '../../src/i18n/locales/en.json';

function TestApp() {
  return (
    <Routes>
      <Route path="/subscription" element={<Subscription />} />
    </Routes>
  );
}

async function confirmStepUp() {
  await userEvent.click(await screen.findByRole('button', { name: 'Re-authenticate' }));
}

// Same environment characteristic as tests/component/Members.test.tsx's
// STEP_UP_FLOW_TIMEOUT_MS: driving the full step-up modal through userEvent
// can exceed vitest's default 5000ms testTimeout on a loaded machine.
const STEP_UP_FLOW_TIMEOUT_MS = 20_000;

describe('Subscription auto-renew context and resume wiring (B088)', () => {
  beforeEach(() => {
    __resetDevBillingStateForTests();
    __setDevEntitlementTierForTests('FAMILY_PLUS');
    __setDevSubscriptionForTests({
      status: 'ACTIVE',
      planLabel: 'Family Plus',
      currentPeriodEndUtc: '2027-01-01T00:00:00.000Z',
      autoRenew: true,
    });
  });

  it('an active, auto-renewing subscription explains what canceling will (and will not) do', async () => {
    renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });

    expect(await screen.findByText(/Renews on/)).toBeInTheDocument();
    expect(screen.getByText(en.subscription.cancelAutoRenewExplain)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel auto-renew' })).toBeInTheDocument();
    // The resume explanation/button must not appear while auto-renew is still on.
    expect(screen.queryByText(en.subscription.resumeAutoRenewExplain)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume auto-renew' })).not.toBeInTheDocument();
  });

  it(
    'canceling auto-renew reveals the resume option with its own context, and resuming actually turns auto-renew back on',
    async () => {
      renderWithProviders(<TestApp />, { route: '/subscription', role: 'OWNER' });

      await userEvent.click(await screen.findByRole('button', { name: 'Cancel auto-renew' }));
      await confirmStepUp();

      expect(await screen.findByText(/Expires on/)).toBeInTheDocument();
      expect(screen.getByText(en.subscription.resumeAutoRenewExplain)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel auto-renew' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Resume auto-renew' }));
      await confirmStepUp();

      expect(await screen.findByText(/Renews on/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel auto-renew' })).toBeInTheDocument();
    },
    STEP_UP_FLOW_TIMEOUT_MS,
  );
});
