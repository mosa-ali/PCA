import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { FreeAccessReminderBannerView } from '../../src/components/freeaccess/FreeAccessReminderBannerView';
import type { FreeAccessStatus } from '../../src/domain/freeAccess';

function renderView(status: FreeAccessStatus, onDismiss = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <FreeAccessReminderBannerView status={status} onDismiss={onDismiss} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const BASE: FreeAccessStatus = {
  mode: 'TIME_LIMITED',
  grantedAt: '2026-07-16T00:00:00.000Z',
  expiresAt: '2026-08-15T00:00:00.000Z',
  remainingDays: 7,
  status: 'ACTIVE',
};

describe('FreeAccessReminderBannerView', () => {
  it('renders nothing for PERPETUAL', () => {
    const { container } = renderView({ mode: 'PERPETUAL', grantedAt: BASE.grantedAt, expiresAt: null, remainingDays: null, status: 'PERPETUAL' });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the exact remaining-days count and exact expiry date for ACTIVE', () => {
    renderView(BASE);
    expect(screen.getByText('7 days remaining in your free access period')).toBeInTheDocument();
    expect(screen.getByText(/It expires on/)).toBeInTheDocument();
    expect(screen.getByText(/August 15, 2026/)).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly 1 day remaining', () => {
    renderView({ ...BASE, remainingDays: 1 });
    expect(screen.getByText('1 day remaining in your free access period')).toBeInTheDocument();
  });

  it('shows "expires today" wording when remainingDays is 0, distinct from a specific day count', () => {
    renderView({ ...BASE, remainingDays: 0 });
    expect(screen.getByText('Your free access period expires today')).toBeInTheDocument();
  });

  it('always shows a Billing CTA linking to /subscription', () => {
    renderView(BASE);
    expect(screen.getByRole('link', { name: 'View billing options' })).toHaveAttribute('href', '/subscription');
  });

  it('never uses manipulative urgency language (no exclamation marks, no "act now"/"hurry")', () => {
    renderView(BASE);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/!/);
    expect(text.toLowerCase()).not.toMatch(/act now|hurry|don't miss|limited time/);
  });

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    renderView(BASE, onDismiss);
    screen.getByRole('button', { name: 'Dismiss this reminder for today' }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('EXPIRED: states the period ended without implying protection was deleted/disabled, and still offers Billing', () => {
    renderView({ ...BASE, remainingDays: null, status: 'EXPIRED' });
    expect(screen.getByText('Your free access period has ended')).toBeInTheDocument();
    const body = screen.getByText(/continue to work as before/i);
    expect(body).toBeInTheDocument();
    expect(body.textContent?.toLowerCase()).not.toMatch(/disabled|deleted|removed|revoked/);
    expect(screen.getByRole('link', { name: 'View billing options' })).toHaveAttribute('href', '/subscription');
  });

  it('EXPIRED is also dismissible', () => {
    const onDismiss = vi.fn();
    renderView({ ...BASE, remainingDays: null, status: 'EXPIRED' }, onDismiss);
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
