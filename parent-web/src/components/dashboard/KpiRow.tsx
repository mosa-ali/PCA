// The six KPIs, in the owner's fixed order:
//
//   Children | Active devices | Protected devices | Needs attention |
//   Pending requests | Important alerts
//
// Every number here is derived, not fetched, so the derivation rules ARE the
// honesty rules. The two that matter:
//
//  1. A tile whose source threw renders an em dash, never `0` (see KpiTile).
//  2. `PENDING_DELIVERY` and `PARTIALLY_APPLIED` do NOT count toward "Needs
//     attention". A queued policy change is not an alarm; escalating it into
//     one is a lie in the other direction, and it would train a parent to
//     ignore the count that actually matters. They surface as their own
//     `pending`/`limited` pills on the child card and in the visual cards.
import { useTranslation } from 'react-i18next';
import type { ChildSummary, DeviceProtectionStatus } from '../../domain/types';
import { KpiTile, type KpiVerification } from './KpiTile';
import { ALERTS_ROUTE, childNeedsAttention, REQUESTS_ROUTE, worstFreshness } from './dashboardModel';

/* ------------------------------------------------------------------ icons --
   All six are non-directional (people, phone, shield, warning triangle, clock,
   bell) so none of them mirrors under `dir="rtl"`. All are `aria-hidden`: the
   tile's own label and value carry the meaning. */

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

const CHILDREN_ICON = (
  <svg {...ICON_PROPS}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16.5 11.5a2.75 2.75 0 1 0-1.6-5M17 19.5a4.75 4.75 0 0 0-1.4-3.4" />
  </svg>
);

const DEVICE_ICON = (
  <svg {...ICON_PROPS}>
    <rect x="6.5" y="2.75" width="11" height="18.5" rx="2.5" />
    <path d="M10.75 18.25h2.5" />
  </svg>
);

const SHIELD_CHECK_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M12 2.75 4.75 5.5v5.9c0 4.4 3 8.2 7.25 9.85 4.25-1.65 7.25-5.45 7.25-9.85V5.5Z" />
    <path d="m9 11.75 2.25 2.25L15.25 10" />
  </svg>
);

const ATTENTION_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M12 3.5 21.5 20H2.5Z" />
    <path d="M12 9.5v4.5M12 17h.01" />
  </svg>
);

const CLOCK_ICON = (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.5l3.5 2" />
  </svg>
);

const BELL_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.25 1.5 5.25H5S6.5 14 6.5 10Z" />
    <path d="M10 18.5a2.25 2.25 0 0 0 4 0" />
  </svg>
);

export interface KpiRowProps {
  /** The child roster, or null when it has not resolved. */
  childSummaries: ChildSummary[] | null;
  /** True when the family-data read threw. Its tiles must show a dash, not zeros. */
  childSummariesFailed: boolean;
  devices: DeviceProtectionStatus[] | null;
  devicesFailed: boolean;
}

export function KpiRow({ childSummaries, childSummariesFailed, devices, devicesFailed }: KpiRowProps) {
  const { t } = useTranslation();

  const familyVerification: KpiVerification = childSummariesFailed
    ? 'UNKNOWN'
    : childSummaries === null
      ? 'PENDING'
      : 'VERIFIED';
  const list = childSummaries ?? [];
  const freshness = worstFreshness(list.map((child) => child.dataFreshnessState));

  /** Any tile derived from device-reported child records inherits their freshness. */
  const reported: KpiVerification =
    familyVerification === 'VERIFIED' && freshness !== 'LIVE' ? 'UNVERIFIED' : familyVerification;

  // The device list carries no freshness field of its own (DeviceProtectionStatus
  // has none), so this tile is verified/unknown only -- it is never marked
  // unverified off the back of a DIFFERENT source's staleness, which would be
  // asserting something about a read we have no freshness signal for.
  const deviceVerification: KpiVerification = devicesFailed ? 'UNKNOWN' : devices === null ? 'PENDING' : 'VERIFIED';

  const sum = (pick: (child: ChildSummary) => number) => list.reduce((total, child) => total + pick(child), 0);

  // STANDARD is a real, honest state -- but it is not "protected", and neither
  // AUTHORIZATION_REQUIRED nor NOT_SUPPORTED may ever be counted here. Those
  // two are exactly the cases where the console cannot enforce anything.
  const protectedCount = devices?.filter((device) => device.protectionState === 'PROTECTED').length ?? null;

  return (
    <div className="kpi-row">
      <KpiTile
        icon={CHILDREN_ICON}
        label={t('dashboard.kpi.children')}
        value={familyVerification === 'VERIFIED' ? list.length : null}
        verification={familyVerification}
      />
      <KpiTile
        icon={DEVICE_ICON}
        label={t('dashboard.kpi.activeDevices')}
        value={reported === 'UNKNOWN' || reported === 'PENDING' ? null : list.filter((c) => c.deviceState === 'ACTIVE').length}
        verification={reported}
        freshness={freshness}
      />
      <KpiTile
        icon={SHIELD_CHECK_ICON}
        label={t('dashboard.kpi.protectedDevices')}
        value={protectedCount}
        verification={deviceVerification}
        meta={devices ? t('dashboard.kpi.protectedOf', { count: devices.length }) : undefined}
      />
      <KpiTile
        icon={ATTENTION_ICON}
        label={t('dashboard.kpi.needsAttention')}
        value={reported === 'UNKNOWN' || reported === 'PENDING' ? null : list.filter(childNeedsAttention).length}
        verification={reported}
        freshness={freshness}
        accent="attention"
      />
      <KpiTile
        icon={CLOCK_ICON}
        label={t('dashboard.kpi.pendingRequests')}
        value={reported === 'UNKNOWN' || reported === 'PENDING' ? null : sum((c) => c.pendingRequestCount)}
        verification={reported}
        freshness={freshness}
        accent="pending"
        to={REQUESTS_ROUTE}
      />
      <KpiTile
        icon={BELL_ICON}
        label={t('dashboard.kpi.importantAlerts')}
        value={reported === 'UNKNOWN' || reported === 'PENDING' ? null : sum((c) => c.importantAlertCount)}
        verification={reported}
        freshness={freshness}
        accent="error"
        to={ALERTS_ROUTE}
      />
    </div>
  );
}
