import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import WebProtectionPage from '../../src/pages/children/WebProtectionPage';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/web-protection" element={<WebProtectionPage />} />
    </Routes>
  );
}

// PCA-WEB-RUNTIME-1: getApiClients() caches a single DevWebRuleAdminClient
// for the whole test module (module-level singleton, same as production),
// and unlike ScreenTimePage's fixtures it genuinely mutates per-child state
// on add/remove. Each test below therefore uses its OWN childId so tests
// stay independent regardless of execution order.
describe('WebProtectionPage rule authoring', () => {
  it('starts with empty allow/deny lists for a child with no rules yet', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/web-protection', role: 'OWNER' });
    expect(await screen.findByText('No sites are blocked.')).toBeInTheDocument();
    expect(screen.getByText('No sites are on the always-allow list.')).toBeInTheDocument();
  });

  it('adding a valid domain to the denylist shows it in the list and reports DELIVERED, never APPLIED', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-lina/web-protection', role: 'OWNER' });
    const input = await screen.findByLabelText('Website address');

    await userEvent.type(input, 'blocked.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.getByText('blocked.example')).toBeInTheDocument());
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });

  it('rejects a malformed domain without adding it to any list', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-yousef/web-protection', role: 'OWNER' });
    const input = await screen.findByLabelText('Website address');

    await userEvent.type(input, 'not a domain');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/does not look like a valid website address/i)).toBeInTheDocument();
    expect(screen.getByText('No sites are blocked.')).toBeInTheDocument();
  });

  it('removing a listed domain takes it back out of the list', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-lina/web-protection', role: 'OWNER' });
    const input = await screen.findByLabelText('Website address');
    await userEvent.type(input, 'second-blocked.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('second-blocked.example')).toBeInTheDocument());

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removeButtons[removeButtons.length - 1]);

    await waitFor(() => expect(screen.queryByText('second-blocked.example')).not.toBeInTheDocument());
  });

  it('a Viewer sees the lists but cannot add or remove a rule', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-yousef/web-protection', role: 'VIEWER' });
    await screen.findByText(/blocked sites/i);

    expect(screen.queryByLabelText('Website address')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
