import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Dashboard pending-requests click-through', () => {
  it('links a non-zero pending-request count to /requests instead of a dead-end number', async () => {
    renderWithProviders(<Dashboard />);

    const amirCard = (await screen.findByText('Amir (DEV)')).closest('article');
    expect(amirCard).not.toBeNull();
    const card = within(amirCard as HTMLElement);
    const link = card.getByRole('link', { name: '1' });
    expect(link.getAttribute('href')).toBe('/requests');
  });

  it('renders a zero pending-request count as plain text, not a link', async () => {
    renderWithProviders(<Dashboard />);

    const yousefCard = (await screen.findByText('Yousef (DEV)')).closest('article');
    expect(yousefCard).not.toBeNull();
    const card = within(yousefCard as HTMLElement);
    const pendingLabel = card.getByText('Pending requests');
    const pendingValue = pendingLabel.nextElementSibling;
    expect(pendingValue?.textContent).toBe('0');
    expect(pendingValue?.querySelector('a')).toBeNull();
  });
});
