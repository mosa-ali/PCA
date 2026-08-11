import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from '../../src/components/shell/AppLayout';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestShell() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
      </Route>
    </Routes>
  );
}

describe('mobile sidebar / drawer behaviour', () => {
  it('opens the drawer via the mobile menu button and closes it via the scrim', async () => {
    renderWithProviders(<TestShell />, { route: '/dashboard' });
    const sidebar = document.getElementById('app-sidebar');
    expect(sidebar).not.toHaveClass('drawer-open');

    const openButton = screen.getByLabelText('Open navigation menu');
    await userEvent.click(openButton);
    expect(sidebar).toHaveClass('drawer-open');

    const scrim = document.querySelector('.drawer-scrim');
    expect(scrim).toBeTruthy();
    if (scrim) await userEvent.click(scrim);
    expect(sidebar).not.toHaveClass('drawer-open');
  });

  it('closes the drawer automatically after a nav link is clicked', async () => {
    renderWithProviders(<TestShell />, { route: '/dashboard' });
    await userEvent.click(screen.getByLabelText('Open navigation menu'));
    const sidebar = document.getElementById('app-sidebar')!;
    expect(sidebar).toHaveClass('drawer-open');
    const dashboardLink = screen.getAllByText('Dashboard')[0];
    await userEvent.click(dashboardLink);
    expect(sidebar).not.toHaveClass('drawer-open');
  });
});
