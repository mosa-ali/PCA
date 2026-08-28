import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../utils/renderWithProviders';
import TrustedBrowser from '../../src/pages/security/TrustedBrowser';
import { getApiClients } from '../../src/api/client';

// Rather than mocking the whole client factory (AuthProvider/PermissionGate
// depend on several other clients from the same object), take the real
// dev-mode singleton and temporarily override just the field(s) this suite
// cares about, restoring afterward in a finally block so no state leaks
// into other test files sharing the same module-level cache. The override
// must stay in place through the async assertions too (TrustedBrowser's
// data load happens in a passive effect after render() returns), not just
// during the synchronous render call.
describe('TrustedBrowser hides dev-only simulation controls outside demo mode', () => {
  it('shows the simulate-approval control when fixture-backed (demo mode) after pairing is requested', async () => {
    const clients = getApiClients();
    await clients.trustedBrowser.beginServiceAuthentication();
    await clients.trustedBrowser.requestPairing();
    renderWithProviders(<TrustedBrowser />);

    expect(await screen.findByRole('button', { name: 'Simulate parent approval (demo mode)' })).toBeInTheDocument();
    // Real, working actions are no longer mislabeled as dev-only.
    expect(screen.getByRole('button', { name: "Reset this browser's trust" })).toBeInTheDocument();

    await clients.trustedBrowser.reset();
  });

  it('hides the simulate-approval control when not fixture-backed (production)', async () => {
    const clients = getApiClients();
    await clients.trustedBrowser.beginServiceAuthentication();
    await clients.trustedBrowser.requestPairing();

    const original = clients.isFixtureBacked;
    clients.isFixtureBacked = false;
    try {
      renderWithProviders(<TrustedBrowser />);
      await screen.findByText('Pairing request sent. Waiting for parent approval on an already-trusted device.');
      expect(screen.queryByRole('button', { name: 'Simulate parent approval (demo mode)' })).not.toBeInTheDocument();
    } finally {
      clients.isFixtureBacked = original;
      await clients.trustedBrowser.reset();
    }
  });

  it('surfaces a real action failure via the error state instead of an unhandled rejection', async () => {
    const clients = getApiClients();
    await clients.trustedBrowser.beginServiceAuthentication();
    await clients.trustedBrowser.requestPairing();

    const originalSimulate = clients.trustedBrowser.simulateParentApproval;
    clients.trustedBrowser.simulateParentApproval = async () => {
      throw new Error('TrustedBrowserProvider.simulateParentApproval -- real parent-approval confirmation requires the backend relay');
    };
    try {
      renderWithProviders(<TrustedBrowser />);
      const button = await screen.findByRole('button', { name: 'Simulate parent approval (demo mode)' });
      await userEvent.click(button);
      expect(await screen.findByText(/real parent-approval confirmation requires the backend relay/)).toBeInTheDocument();
    } finally {
      clients.trustedBrowser.simulateParentApproval = originalSimulate;
      await clients.trustedBrowser.reset();
    }
  });
});
