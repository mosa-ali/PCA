// PCA-MYKIDS-BILL-3: wires the real commercial-notification read/acknowledge
// API (list, unread-count, mark-read, acknowledge). QUOTE_EXPIRED is
// rendered if it ever appears (it is a legal wire value), but no flow here
// assumes it will -- see domain/billing.ts's CommercialNotificationEventType
// doc comment. The list endpoint has no cursor/offset pagination (limit
// only), so this page renders the single fetched page as-is.
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { LoadingState, ErrorState } from '../components/common/States';

const NOTIFICATION_LIST_LIMIT = 50;

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();

  const { data, loading, error, reload } = useAsync(
    () =>
      Promise.all([clients.commercialNotifications.list(NOTIFICATION_LIST_LIMIT), clients.commercialNotifications.unreadCount()]).then(
        ([notifications, unreadCount]) => ({ notifications, unreadCount }),
      ),
    [],
  );

  const markRead = async (notificationId: string) => {
    await clients.commercialNotifications.markRead(notificationId);
    reload();
  };

  const acknowledge = async (notificationId: string) => {
    await clients.commercialNotifications.acknowledge(notificationId);
    reload();
  };

  return (
    <section aria-labelledby="notifications-title">
      <h1 id="notifications-title">{t('nav.notifications')}</h1>
      <div className="card">
        {/*
          PCA-FR-094: no backend notification-preference endpoint exists in
          this repository slice (checked backend/src/http/routes/
          parentAccountRoutes.ts and the whole backend tree for
          notification-preference/email-destination surface -- none found).
          Rendering these as live, silently-no-op checkboxes would mislead a
          parent into believing a choice here changes delivery. They are
          disabled and explicitly labeled as not-yet-connected rather than
          faked; see ICR-PCA-FR-094-NOTIFICATION-PREFS filed alongside this
          change for the real backend work this needs.
        */}
        <label className="checkbox-row">
          <input type="checkbox" checked disabled aria-describedby="notification-prefs-gap-note" /> {t('notifications.emailAlerts')}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked disabled aria-describedby="notification-prefs-gap-note" /> {t('notifications.pushRequests')}
        </label>
        <p id="notification-prefs-gap-note" role="status">
          {t('notifications.preferencesNotYetConnected')}
        </p>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('notifications.payloadNote')}</p>

      <div className="card" aria-labelledby="commercial-notifications-title">
        <h2 id="commercial-notifications-title">
          {t('notifications.commercialTitle')}
          {typeof data?.unreadCount === 'number' && data.unreadCount > 0 && ` (${t('notifications.unreadCount', { count: data.unreadCount })})`}
        </h2>
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && data && data.notifications.length === 0 && <p>{t('notifications.commercialEmpty')}</p>}
        {!loading && !error && data && data.notifications.length > 0 && (
          <ul className="plain-list">
            {data.notifications.map((n) => (
              <li key={n.notificationId}>
                <strong>{t(`notifications.eventType.${n.eventType}`)}</strong>{' '}
                <span style={{ color: 'var(--color-text-muted)' }}>{new Date(n.createdAtUtc).toLocaleString(i18n.language)}</span>
                {n.readAtUtc === null && (
                  <>
                    {' '}
                    <button type="button" className="btn btn-sm" onClick={() => markRead(n.notificationId)}>
                      {t('notifications.markRead')}
                    </button>
                  </>
                )}
                {n.acknowledgedAtUtc === null && (
                  <>
                    {' '}
                    <button type="button" className="btn btn-sm" onClick={() => acknowledge(n.notificationId)}>
                      {t('notifications.acknowledge')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
