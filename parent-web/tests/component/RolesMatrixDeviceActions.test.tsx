import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import RolesMatrix from '../../src/pages/family/RolesMatrix';

/**
 * P2 finding: the matrix's own comments admit it is a client-side
 * heuristic NOT authoritative for device-enrollment actions, and those
 * actions were simply omitted from the table. This proves they're now
 * present, alongside a plain-language explanation per role and the
 * heuristic-not-authoritative disclosure itself.
 */
describe('RolesMatrix surfaces device-enrollment actions and plain-language role explanations', () => {
  it('lists all four device-enrollment actions as real rows', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    await screen.findByRole('table');

    expect(screen.getByText('View device enrollment status')).toBeInTheDocument();
    expect(screen.getByText('Invite a new child device')).toBeInTheDocument();
    expect(screen.getByText('Revoke a device invitation')).toBeInTheDocument();
    expect(screen.getByText('Confirm device pairing')).toBeInTheDocument();
  });

  it('discloses that the device-enrollment rows are a client-side heuristic, not the real server authority', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    expect(await screen.findByText(/client-side estimate, not the server's own authority model/)).toBeInTheDocument();
  });

  it('shows a plain-language explanation for every role', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    await screen.findByRole('table');

    expect(screen.getByText(/Full control: can manage every family setting/)).toBeInTheDocument();
    expect(screen.getByText(/Can manage children's policies and approve requests day to day/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only access to family status and device-enrollment information/)).toBeInTheDocument();
    expect(screen.getByText(/Can send requests \(like more screen time\)/)).toBeInTheDocument();
  });

  it('an OWNER is allowed to invite a device; a VIEWER is not (matches evaluatePermission, not a hardcoded guess)', async () => {
    renderWithProviders(<RolesMatrix />, { role: 'OWNER' });
    await screen.findByRole('table');
    const row = screen.getByText('Invite a new child device').closest('tr')!;
    const cells = row.querySelectorAll('td');
    // ROLES order is OWNER, ADMINISTRATOR, VIEWER, CHILD.
    expect(cells[0].textContent).toContain('Yes');
    expect(cells[2].textContent).toBe('—');
  });
});
