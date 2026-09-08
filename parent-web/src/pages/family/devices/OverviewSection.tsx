import { useTranslation } from 'react-i18next';
import { AsyncStates } from '../../../components/common/States';
import { rampForStatus } from '../../../domain/dashboardStatus';
import { formatNumber } from '../../../i18n/formatters';
import type { ChildSummary, DeviceProtectionStatus } from '../../../domain/types';
import type { DevicesSectionId } from './DevicesTabs';

/**
 * Section 1 -- what a parent sees first: how many devices there are and how
 * many need something, then a way into the section that does it.
 *
 * THE HONESTY RULE APPLIES PER NUMBER, not per page. Three of these four
 * counts come from `listDeviceStatuses()`; "Offline" is a property of the
 * FAMILY read, which is fail-closed by design in real mode. That read has
 * three states and the tile says a different thing for each:
 *
 *   - resolved  -> the count;
 *   - pending   -> a dash and "Loading..." (`familyPending`);
 *   - declined  -> a dash and "we can't verify this right now".
 *
 * It does NOT show 0 for either of the last two: `0` may only ever mean "we
 * counted zero". And it does not say "can't verify" for a read that simply
 * has not come back yet -- until 2026-09-08 it did, on every visit, because
 * the device list resolves before the family read (mirrors `KpiTile`).
 */
export default function OverviewSection({
  devices,
  loading,
  error,
  onRetry,
  familyChildren,
  familyPending,
  onGoToSection,
}: {
  devices: DeviceProtectionStatus[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** `null` means the family read declined or has not resolved -- not "empty". */
  familyChildren: ChildSummary[] | null;
  /** True while the family read is still in flight (and `familyChildren` is therefore null). */
  familyPending: boolean;
  onGoToSection: (section: DevicesSectionId) => void;
}) {
  const { t, i18n } = useTranslation();

  const list = devices ?? [];
  const total = list.length;
  const protectedCount = list.filter((device) => device.protectionState === 'PROTECTED').length;
  const attentionCount = list.filter((device) => rampForStatus(device.protectionState) === 'attention').length;
  const offlineCount = familyChildren
    ? familyChildren.filter((child) => child.deviceState === 'OFFLINE').length
    : null;

  return (
    <section className="device-section" aria-labelledby="devices-overview-title">
      <div className="section-panel-head">
        <h2 className="section-panel-title" id="devices-overview-title">
          {t('devicesPage.tabOverview')}
        </h2>
      </div>

      <AsyncStates loading={loading} error={error} onRetry={onRetry}>
        <div className="device-summary-grid">
          <SummaryItem label={t('devicesPage.summaryTotal')} value={formatNumber(total, i18n.language)} />
          <SummaryItem label={t('devicesPage.summaryProtected')} value={formatNumber(protectedCount, i18n.language)} />
          <SummaryItem label={t('devicesPage.summaryAttention')} value={formatNumber(attentionCount, i18n.language)} />
          <SummaryItem
            label={t('devicesPage.summaryOffline')}
            value={offlineCount === null ? null : formatNumber(offlineCount, i18n.language)}
            pending={familyChildren === null && familyPending}
            pendingNote={t('common.loading')}
            unverifiedNote={t('dashboard.kpi.cannotVerify')}
          />
        </div>
      </AsyncStates>

      <div className="wizard-actions">
        <button type="button" className="btn btn-primary" onClick={() => onGoToSection('add')}>
          {t('devicesPage.tabAddDevice')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onGoToSection('pending')}>
          {t('devicesPage.tabPending')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onGoToSection('devices')}>
          {t('devicesPage.tabDevices')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onGoToSection('protection')}>
          {t('devicesPage.tabProtection')}
        </button>
      </div>
    </section>
  );
}

function SummaryItem({
  label,
  value,
  pending = false,
  pendingNote,
  unverifiedNote,
}: {
  label: string;
  /** `null` = the underlying read has not resolved (`pending`) or declined. Renders a dash, never a zero. */
  value: string | null;
  pending?: boolean;
  pendingNote?: string;
  unverifiedNote?: string;
}) {
  return (
    <div className="device-summary-item">
      {value === null ? (
        pending ? (
          <>
            <span className="kpi-value">—</span>
            {pendingNote && <span className="kpi-meta">{pendingNote}</span>}
          </>
        ) : (
          <>
            <span className="kpi-value kpi-value-unknown">—</span>
            {unverifiedNote && (
              <span className="freshness-marker freshness-unavailable">{unverifiedNote}</span>
            )}
          </>
        )
      ) : (
        <span className="kpi-value">{value}</span>
      )}
      <span className="kpi-label">{label}</span>
    </div>
  );
}
