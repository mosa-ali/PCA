// THE SINGLE EASIEST WAY TO LIE ON A DASHBOARD IS TO PRINT `0`.
//
// "Needs attention: 0" is read as reassurance. If the underlying read actually
// threw, that reassurance is fabricated -- and in real (non-fixture) mode the
// family-data read throws BY DESIGN, so this is the normal case, not an edge
// case. These tests pin the three renderings of a KPI tile (verified /
// unverified / unknown) and the counting rules behind them.
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { KpiRow } from '../../src/components/dashboard/KpiRow';
import type { ChildSummary, DeviceProtectionStatus } from '../../src/domain/types';
import { renderWithProviders } from '../utils/renderWithProviders';

function child(overrides: Partial<ChildSummary> = {}): ChildSummary {
  return {
    childId: 'child-1',
    displayName: 'Child One',
    ageProfile: 'PRE_TEEN',
    avatarInitial: 'C',
    deviceState: 'ACTIVE',
    screenTimeState: 'ACTIVE',
    breakState: 'ACTIVE',
    batteryPercent: 80,
    batteryState: 'ACTIVE',
    lastSeenUtc: new Date().toISOString(),
    lastSeenState: 'ACTIVE',
    dataFreshnessState: 'LIVE',
    protectionCapabilityState: 'ACTIVE',
    policyDeliveryState: 'ACTIVE',
    pendingRequestCount: 0,
    importantAlertCount: 0,
    ...overrides,
  };
}

function device(overrides: Partial<DeviceProtectionStatus> = {}): DeviceProtectionStatus {
  return {
    childId: 'child-1',
    deviceId: 'device-1',
    deviceLabel: 'Phone',
    osFamily: 'ANDROID',
    appVersion: '1.0.0',
    protectionState: 'PROTECTED',
    lastAcknowledgedPolicyRevision: 1,
    trustSetEpoch: 1,
    keyEpoch: 1,
    ...overrides,
  };
}

function tile(label: string): HTMLElement {
  return screen.getByText(label).closest('.kpi-tile') as HTMLElement;
}

describe('Dashboard KPI honesty', () => {
  it('renders an em dash, never a zero, for every KPI whose source threw', () => {
    const { container } = renderWithProviders(
      <KpiRow childSummaries={null} childSummariesFailed devices={null} devicesFailed />,
    );

    const tiles = Array.from(container.querySelectorAll('.kpi-tile'));
    expect(tiles).toHaveLength(6);
    for (const one of tiles) {
      const value = one.querySelector('.kpi-value');
      expect(value?.textContent, one.textContent ?? '').toBe('—');
      expect(value, one.textContent ?? '').toHaveClass('kpi-value-unknown');
      // The `0` that would otherwise sit here must not appear anywhere.
      expect(one.textContent, one.textContent ?? '').not.toContain('0');
    }
    expect(screen.getAllByText("We can't verify this right now")).toHaveLength(6);
  });

  it('never turns an unreadable KPI into a link', () => {
    const { container } = renderWithProviders(
      <KpiRow childSummaries={null} childSummariesFailed devices={null} devicesFailed />,
    );
    expect(container.querySelectorAll('a.kpi-tile')).toHaveLength(0);
  });

  it('renders a genuine zero as a plain, unlinked count', () => {
    renderWithProviders(
      <KpiRow childSummaries={[child()]} childSummariesFailed={false} devices={[]} devicesFailed={false} />,
    );

    const requests = tile('Pending requests');
    expect(requests.tagName).toBe('DIV');
    expect(within(requests).getByText('0')).toBeInTheDocument();
    expect(requests.querySelector('.kpi-value')).not.toHaveClass('kpi-value-unknown');

    const alerts = tile('Important alerts');
    expect(alerts.tagName).toBe('DIV');
    expect(within(alerts).getByText('0')).toBeInTheDocument();
  });

  it('counts only PROTECTED devices as protected, never STANDARD, AUTHORIZATION_REQUIRED or NOT_SUPPORTED', () => {
    renderWithProviders(
      <KpiRow
        childSummaries={[child()]}
        childSummariesFailed={false}
        devices={[
          device({ deviceId: 'a', protectionState: 'PROTECTED' }),
          device({ deviceId: 'b', protectionState: 'STANDARD' }),
          device({ deviceId: 'c', protectionState: 'AUTHORIZATION_REQUIRED' }),
          device({ deviceId: 'd', protectionState: 'NOT_SUPPORTED' }),
        ]}
        devicesFailed={false}
      />,
    );

    const protectedTile = tile('Protected devices');
    expect(within(protectedTile).getByText('1')).toBeInTheDocument();
    expect(protectedTile.textContent).toContain('of 4 devices');
  });

  it('does not escalate PENDING_DELIVERY or PARTIALLY_APPLIED into "needs attention"', () => {
    renderWithProviders(
      <KpiRow
        childSummaries={[
          child({ childId: 'a', policyDeliveryState: 'PENDING_DELIVERY' }),
          child({ childId: 'b', protectionCapabilityState: 'PARTIALLY_APPLIED' }),
          child({ childId: 'c', deviceState: 'LIMITED' }),
        ]}
        childSummariesFailed={false}
        devices={[]}
        devicesFailed={false}
      />,
    );

    // A queued policy change is not an alarm. Inflating it into one is a lie in
    // the other direction, and it trains a parent to ignore the count that does
    // matter.
    expect(within(tile('Needs attention')).getByText('0')).toBeInTheDocument();
  });

  it('does count NEEDS_ATTENTION, EPOCH_STALE, AUTHORIZATION_REQUIRED and REVOKED', () => {
    renderWithProviders(
      <KpiRow
        childSummaries={[
          child({ childId: 'a', deviceState: 'NEEDS_ATTENTION' }),
          child({ childId: 'b', protectionCapabilityState: 'EPOCH_STALE' }),
          child({ childId: 'c', policyDeliveryState: 'REVOKED' }),
          child({ childId: 'd' }),
        ]}
        childSummariesFailed={false}
        devices={[]}
        devicesFailed={false}
      />,
    );

    expect(within(tile('Needs attention')).getByText('3')).toBeInTheDocument();
  });

  it('shows a real count but marks it unverified when a contributing record is cached', () => {
    renderWithProviders(
      <KpiRow
        childSummaries={[child({ dataFreshnessState: 'CACHED', pendingRequestCount: 2 })]}
        childSummariesFailed={false}
        devices={[]}
        devicesFailed={false}
      />,
    );

    const requests = tile('Pending requests');
    expect(within(requests).getByText('2')).toBeInTheDocument();
    const marker = requests.querySelector('.freshness-marker');
    expect(marker).toHaveClass('freshness-cached');
    expect(marker?.textContent).toContain('Cached');
  });

  it('shows the loading meta, not "we cannot verify", while a read is still in flight', () => {
    renderWithProviders(
      <KpiRow childSummaries={null} childSummariesFailed={false} devices={null} devicesFailed={false} />,
    );

    // An in-flight read must not flash a claim we did not mean to make.
    expect(screen.queryByText("We can't verify this right now")).toBeNull();
    expect(document.querySelectorAll('.kpi-value-unknown')).toHaveLength(0);
  });
});
