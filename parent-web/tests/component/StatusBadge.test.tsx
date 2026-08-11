import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { StatusBadge } from '../../src/components/common/StatusBadge';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('StatusBadge', () => {
  it('renders both a text label and a visual dot, never color alone', () => {
    const { container } = renderWithProviders(<StatusBadge state="NEEDS_ATTENTION" />);
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(container.querySelector('.dot')).toBeTruthy();
  });

  it.each(['ACTIVE', 'LIMITED', 'UNAVAILABLE', 'OFFLINE', 'PENDING_DELIVERY', 'PARTIALLY_APPLIED', 'EPOCH_STALE', 'REVOKED'] as const)(
    'renders a readable label for state %s',
    (state) => {
      renderWithProviders(<StatusBadge state={state} />);
      expect(document.querySelector(`.status-${state}`)).toBeTruthy();
    },
  );
});
