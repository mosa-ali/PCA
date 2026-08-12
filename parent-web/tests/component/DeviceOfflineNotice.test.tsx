import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import { DeviceOfflineNotice } from '../../src/components/common/DeviceOfflineNotice';

function renderNotice(props: Partial<React.ComponentProps<typeof DeviceOfflineNotice>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DeviceOfflineNotice
        lastSuccessfulSyncUtc={null}
        lastAppliedPolicyRevision={null}
        hasPendingPolicyDelivery={false}
        {...props}
      />
    </I18nextProvider>,
  );
}

describe('DeviceOfflineNotice', () => {
  it('never implies protection is disabled -- always states local protection continues', () => {
    renderNotice();
    expect(screen.getByText(/local protection continues on the device/i)).toBeInTheDocument();
  });

  it('states remote data may be stale', () => {
    renderNotice();
    expect(screen.getByText(/Remote data may be stale/i)).toBeInTheDocument();
  });

  it('shows the last successful sync time when known', () => {
    renderNotice({ lastSuccessfulSyncUtc: '2026-08-01T00:00:00.000Z' });
    expect(screen.getByText('2026-08-01T00:00:00.000Z')).toBeInTheDocument();
  });

  it('shows "never synced" when no successful sync has ever occurred', () => {
    renderNotice({ lastSuccessfulSyncUtc: null });
    expect(screen.getByText('Never synced')).toBeInTheDocument();
  });

  it('shows the last known applied policy revision', () => {
    renderNotice({ lastAppliedPolicyRevision: 11 });
    expect(screen.getByText('11')).toBeInTheDocument();
  });

  it('surfaces a pending-delivery note only when there is a pending policy change', () => {
    const { rerender } = renderNotice({ hasPendingPolicyDelivery: false });
    expect(screen.queryByText(/pending delivery/i)).not.toBeInTheDocument();
    rerender(
      <I18nextProvider i18n={i18n}>
        <DeviceOfflineNotice lastSuccessfulSyncUtc={null} lastAppliedPolicyRevision={null} hasPendingPolicyDelivery />
      </I18nextProvider>,
    );
    expect(screen.getByText(/pending delivery/i)).toBeInTheDocument();
  });
});
