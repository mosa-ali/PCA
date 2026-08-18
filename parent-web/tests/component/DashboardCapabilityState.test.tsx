import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Dashboard capability states', () => {
  it('renders a stale protection capability as an explicit non-active state', async () => {
    renderWithProviders(<Dashboard />);

    const childCard = (await screen.findByText('Yousef (DEV)')).closest('article');
    expect(childCard).not.toBeNull();
    const card = within(childCard as HTMLElement);
    const protectionLabel = card.getByText('Protection');
    const protectionValue = protectionLabel.nextElementSibling?.querySelector('.status-badge');

    expect(protectionValue).not.toBeNull();
    expect(protectionValue).toHaveClass('status-EPOCH_STALE');
    expect(protectionValue).not.toHaveClass('status-ACTIVE');
  });
});
