// The compact child card -- the thing a parent actually looks at.
//
// SEVEN fields, and no more: name, avatar initial, ONE headline pill, screen
// time, device status, protection status, last sync + freshness, plus the two
// count badges when they are non-zero.
//
// Deliberately NOT here, and this is a product decision rather than a layout
// one: trust-set epoch, key epoch, policy revision, device id, correlation
// ids. They are not deleted -- they still live on /security/status, in the
// security log, and behind the devices page's technical-details disclosure,
// which are the correct homes for them. They are simply not what a parent
// needs in the three seconds they give this screen. Break status, battery and
// policy-delivery detail move to /children/:childId/overview for the same
// reason.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ChildSummary } from '../../domain/types';
import { StatusBadge, StatusRampIcon } from '../common/StatusBadge';
import { formatNumber, formatRelative } from '../../i18n/formatters';
import { BarMeter } from '../charts/BarMeter';
import { FreshnessMarker } from './FreshnessMarker';
import {
  ALERTS_ROUTE,
  REQUESTS_ROUTE,
  childHeadline,
  rampColorToken,
  screenTimeFraction,
  screenTimeRamp,
  usableScreenTime,
  type ScreenTimeReading,
} from './dashboardModel';

/** `<dd>` carries a 40px UA margin that would break the flex row; nothing in global.css resets it. */
const DD_RESET = { margin: 0 } as const;

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="child-metric">
      <dt className="child-metric-label">{label}</dt>
      <dd className="child-metric-value" style={DD_RESET}>
        {children}
      </dd>
    </div>
  );
}

/**
 * The single headline pill.
 *
 * When freshness (not status) decided the colour, the pill says
 * "Last known: <state>" rather than asserting the state is current. The label
 * change matters as much as the colour: a violet pill saying "Active" would
 * still read as "active" to anyone skimming.
 */
function HeadlinePill({ child }: { child: ChildSummary }) {
  const { t } = useTranslation();
  const headline = childHeadline(child);
  if (!headline.downgradedByFreshness) {
    return <StatusBadge state={headline.state} size="lg" />;
  }
  return (
    <span className={`status-badge status-${headline.ramp} status-badge-lg`}>
      <StatusRampIcon ramp={headline.ramp} />
      {t('dashboard.lastKnownState', { state: t(`state.${headline.state}`) })}
    </span>
  );
}

export interface ChildCardProps {
  child: ChildSummary;
  /** Undefined while the per-child read is in flight; `UNAVAILABLE` once it failed. */
  screenTime: ScreenTimeReading | undefined;
}

export function ChildCard({ child, screenTime }: ChildCardProps) {
  const { t, i18n } = useTranslation();
  const fraction = screenTimeFraction(screenTime);
  // NOT `screenTime.value`: a resolved read whose own state is UNAVAILABLE /
  // NOT_SUPPORTED / PLATFORM_LIMITED carries last-known numbers at best, and
  // must not be drawn as today's usage. See `usableScreenTime`.
  const reading = usableScreenTime(screenTime);

  return (
    // `card-interactive` gives the hover/focus-within affordance. There is
    // deliberately no click handler on the <article> itself: the name link and
    // the badges already reach every destination, and putting a click handler
    // on a non-interactive element would need a jsx-a11y suppression to add an
    // affordance that keyboard users could not use anyway.
    <article className="card card-interactive child-card">
      <div className="child-card-head">
        <span className="child-avatar" aria-hidden="true">
          {child.avatarInitial}
        </span>
        <Link
          className="child-name"
          to={`/children/${child.childId}/overview`}
          aria-label={t('dashboard.viewChild', { name: child.displayName })}
        >
          {/* A display name is family plaintext and may be Arabic, Latin or mixed. */}
          <bdi className="iso">{child.displayName}</bdi>
        </Link>
        <span className="child-headline-status">
          <HeadlinePill child={child} />
        </span>
      </div>

      <dl className="child-metrics">
        <Metric label={t('dashboard.screenTime')}>
          {fraction === null || reading === null ? (
            // No usable reading. The bar is NOT drawn at 0%: an empty bar says
            // "no screen time used today", which is a different claim from
            // "we could not read it".
            <StatusBadge state={child.screenTimeState} />
          ) : (
            <>
              <div style={{ flex: '1 1 5rem', minInlineSize: '3rem' }}>
                <BarMeter
                  segments={[
                    {
                      label: t('dashboard.screenTime'),
                      fraction,
                      color: rampColorToken(screenTimeRamp(fraction)),
                    },
                  ]}
                />
              </div>
              <bdi className="iso">
                {t('dashboard.screenTimeOfLimit', {
                  used: formatNumber(reading.continuousUseElapsedMinutes, i18n.language),
                  limit: formatNumber(reading.continuousUseLimitMinutes, i18n.language),
                })}
              </bdi>
            </>
          )}
        </Metric>

        <Metric label={t('dashboard.deviceState')}>
          <StatusBadge state={child.deviceState} />
        </Metric>

        {/* PENDING_DELIVERY renders as the blue `pending` pill here -- not
            green, and not a muted grey afterthought. */}
        <Metric label={t('dashboard.protectionCapability')}>
          <StatusBadge state={child.protectionCapabilityState} />
        </Metric>

        <Metric label={t('dashboard.lastSync')}>
          <bdi className="iso">{formatRelative(child.lastSeenUtc, i18n.language)}</bdi>
          <FreshnessMarker state={child.dataFreshnessState} />
        </Metric>
      </dl>

      {(child.pendingRequestCount > 0 || child.importantAlertCount > 0) && (
        <div className="child-card-foot">
          {/* A zero count is not rendered at all: a badge reading "0 requests"
              is visual noise, and linking it would land on an empty list. */}
          {child.pendingRequestCount > 0 && (
            <Link className="child-badge" to={REQUESTS_ROUTE}>
              {t('dashboard.requestsBadge', { count: child.pendingRequestCount })}
            </Link>
          )}
          {child.importantAlertCount > 0 && (
            <Link className="child-badge" to={ALERTS_ROUTE}>
              {t('dashboard.alertsBadge', { count: child.importantAlertCount })}
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
