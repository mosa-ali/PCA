// V7 -- Requests and alerts.
//
// The two counts a parent is expected to act on, plus the three most recent
// alerts so the numbers are not a dead end.
//
// When the alert feed resolves to `PENDING_TRUSTED_DECRYPTION` the card shows
// the existing honest sentence in the action-needed treatment -- NOT an empty
// list. "No alerts" and "alerts exist but this browser cannot open them yet"
// are opposite facts, and rendering the second as the first would be the worst
// possible failure on this screen.
//
// Only the alert's trigger category and its time are shown. `alert.deviceId`
// is deliberately not rendered: it is an internal identifier, and the alerts
// page is where a parent goes for detail.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ProtectionAlertFeedResult } from '../../api/interfaces';
import type { ChildSummary } from '../../domain/types';
import { ActionNeededState, AsyncStates } from '../common/States';
import { formatRelative } from '../../i18n/formatters';
import { ALERTS_ROUTE, REQUESTS_ROUTE } from './dashboardModel';

const ALERT_PREVIEW_LIMIT = 3;

export interface RequestsAlertsCardProps {
  childSummaries: ChildSummary[];
  feed: ProtectionAlertFeedResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function RequestsAlertsCard({ childSummaries, feed, loading, error, onRetry }: RequestsAlertsCardProps) {
  const { t, i18n } = useTranslation();
  const pendingRequests = childSummaries.reduce((total, child) => total + child.pendingRequestCount, 0);
  const importantAlerts = childSummaries.reduce((total, child) => total + child.importantAlertCount, 0);
  const recent = feed?.status === 'READY' ? feed.alerts.slice(0, ALERT_PREVIEW_LIMIT) : [];

  return (
    <article className="card">
      <div className="card-header">
        <h3 className="card-title">{t('dashboard.requestsAndAlerts')}</h3>
      </div>
      <div className="card-body">
        <div className="child-card-foot" style={{ borderBlockStart: 'none', paddingBlockStart: 0 }}>
          {/* A zero count is plain text, not a link: a link that lands on an
              empty list is a small broken promise. */}
          {pendingRequests > 0 ? (
            <Link className="child-badge" to={REQUESTS_ROUTE}>
              {t('dashboard.requestsBadge', { count: pendingRequests })}
            </Link>
          ) : (
            <span className="child-badge">{t('dashboard.requestsBadge', { count: 0 })}</span>
          )}
          {importantAlerts > 0 ? (
            <Link className="child-badge" to={ALERTS_ROUTE}>
              {t('dashboard.alertsBadge', { count: importantAlerts })}
            </Link>
          ) : (
            <span className="child-badge">{t('dashboard.alertsBadge', { count: 0 })}</span>
          )}
        </div>
        <AsyncStates loading={loading} error={error} onRetry={onRetry}>
          {feed?.status === 'PENDING_TRUSTED_DECRYPTION' ? (
            <ActionNeededState
              titleKey="states.notAvailableYetTitle"
              body={t('protectionStatus.alertsPendingDecryption')}
            />
          ) : (
            recent.length > 0 && (
              <ul className="plain-list">
                {recent.map((alert) => (
                  <li key={alert.alertId} className="child-metric">
                    <span className="child-metric-value">{t(`protectionStatus.triggers.${alert.trigger}`)}</span>
                    <span className="text-muted">
                      <bdi className="iso">{formatRelative(alert.generatedAtUtc, i18n.language)}</bdi>
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}
        </AsyncStates>
      </div>
    </article>
  );
}
