import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Dashboard important-alerts click-through', () => {
  it('links a non-zero important-alert count to /security/status instead of a dead-end number', async () => {
    renderWithProviders(<Dashboard />);

    const yousefCard = (await screen.findByText('Yousef (DEV)')).closest('article');
    expect(yousefCard).not.toBeNull();
    const card = within(yousefCard as HTMLElement);
    const link = card.getByRole('link', { name: '2' });
    expect(link.getAttribute('href')).toBe('/security/status');
  });

  it('renders a zero important-alert count as plain text, not a link', async () => {
    renderWithProviders(<Dashboard />);

    const amirCard = (await screen.findByText('Amir (DEV)')).closest('article');
    expect(amirCard).not.toBeNull();
    const card = within(amirCard as HTMLElement);
    const alertsLabel = card.getByText('Important alerts');
    const alertsValue = alertsLabel.nextElementSibling;
    expect(alertsValue?.textContent).toBe('0');
    expect(alertsValue?.querySelector('a')).toBeNull();
  });
});
