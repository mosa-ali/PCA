// PCA-MYKIDS-BILL-3: wires the real commercial-notification read/acknowledge
// API (list, unread-count, mark-read, acknowledge). QUOTE_EXPIRED is
// rendered if it ever appears (it is a legal wire value), but no flow here
// assumes it will -- see domain/billing.ts's CommercialNotificationEventType
// doc comment.
//
// The list endpoint has no cursor/offset pagination, only a `limit` query
// param capped server-side at 200 (backend/src/http/routes/
// commercialNotificationRoutes.ts's MAX_LIMIT_PARAM) -- there is no way to
// fetch a 201st notification at all. So this page fetches that full
// server-side cap in one call and then applies the read/unread filter and
// "show more" pagination client-side over data already in hand, exactly the
// same genuine-client-side-slicing pattern as Invoices.tsx's date-range
// filter and ActivityTimelinePage.tsx's category filter (see their file
// headers) -- not a fabricated server capability.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { LoadingState, ErrorState } from '../components/common/States';

const NOTIFICATION_FETCH_LIMIT = 200;
const PAGE_SIZE = 10;
type ReadFilter = '' | 'UNREAD' | 'READ';

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const [preferences, setPreferences] = useState<Awaited<ReturnType<typeof clients.parentPreferences.get>> | null>(null);
  const [emailDestinationDraft, setEmailDestinationDraft] = useState('');
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState<string | null>(null);

  const loadPreferences = useCallback(async () => {
    try {
      const next = await clients.parentPreferences.get();
      setPreferences(next);
      setEmailDestinationDraft(next.emailDestination ?? '');
      setPreferencesError(null);
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : 'Unable to load notification preferences.');
    }
  }, [clients.parentPreferences]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const updatePreference = async (key: 'emailAlertsEnabled' | 'pushRequestsEnabled', value: boolean) => {
    setSavingPreference(key);
    try {
      setPreferences(await clients.parentPreferences.update({ [key]: value }));
      setPreferencesError(null);
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : 'Unable to save notification preferences.');
    } finally {
      setSavingPreference(null);
    }
  };

  const saveEmailDestination = async () => {
    setSavingPreference('emailDestination');
    try {
      const next = await clients.parentPreferences.update({ emailDestination: emailDestinationDraft.trim() || null });
      setPreferences(next);
      setEmailDestinationDraft(next.emailDestination ?? '');
      setPreferencesError(null);
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : 'Unable to save notification destination.');
    } finally {
      setSavingPreference(null);
    }
  };

  const { data, loading, error, reload } = useAsync(
    () =>
      Promise.all([clients.commercialNotifications.list(NOTIFICATION_FETCH_LIMIT), clients.commercialNotifications.unreadCount()]).then(
        ([notifications, unreadCount]) => ({ notifications, unreadCount }),
      ),
    [],
  );

  const [notificationActionError, setNotificationActionError] = useState<string | null>(null);
  const [readFilter, setReadFilter] = useState<ReadFilter>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filteredNotifications = useMemo(() => {
    const notifications = data?.notifications ?? [];
    if (readFilter === 'UNREAD') return notifications.filter((n) => n.readAtUtc === null);
    if (readFilter === 'READ') return notifications.filter((n) => n.readAtUtc !== null);
    return notifications;
  }, [data, readFilter]);
  const visibleNotifications = filteredNotifications.slice(0, visibleCount);

  const markRead = async (notificationId: string) => {
    setNotificationActionError(null);
    try {
      await clients.commercialNotifications.markRead(notificationId);
      reload();
    } catch (error) {
      setNotificationActionError(error instanceof Error ? error.message : t('notifications.actionErrorFallback'));
    }
  };

  const acknowledge = async (notificationId: string) => {
    setNotificationActionError(null);
    try {
      await clients.commercialNotifications.acknowledge(notificationId);
      reload();
    } catch (error) {
      setNotificationActionError(error instanceof Error ? error.message : t('notifications.actionErrorFallback'));
    }
  };

  return (
    <section aria-labelledby="notifications-title">
      <h1 id="notifications-title">{t('nav.notifications')}</h1>
      <div className="card">
        {preferencesError && <p role="alert">{preferencesError}</p>}
        <label className="checkbox-row">
          <input type="checkbox" checked={preferences?.emailAlertsEnabled ?? false} disabled={!preferences || savingPreference !== null} onChange={(e) => void updatePreference('emailAlertsEnabled', e.target.checked)} /> {t('notifications.emailAlerts')}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={preferences?.pushRequestsEnabled ?? false} disabled={!preferences || savingPreference !== null} onChange={(e) => void updatePreference('pushRequestsEnabled', e.target.checked)} /> {t('notifications.pushRequests')}
        </label>
        <div className="field">
          <label htmlFor="notification-email-destination">{t('notifications.emailDestination')}</label>
          <input id="notification-email-destination" type="email" value={emailDestinationDraft} disabled={!preferences || savingPreference !== null} onChange={(event) => setEmailDestinationDraft(event.target.value)} />
          <button type="button" className="btn btn-sm" onClick={() => void saveEmailDestination()} disabled={!preferences || savingPreference !== null}>{t('notifications.saveEmailDestination')}</button>
          {preferences?.emailDestinationState === 'UNVERIFIED' && <p>{t('notifications.emailDestinationUnverified')}</p>}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void loadPreferences()} disabled={savingPreference !== null}>{t('common.retry')}</button>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('notifications.payloadNote')}</p>

      <div className="card" aria-labelledby="commercial-notifications-title">
        <h2 id="commercial-notifications-title">
          {t('notifications.commercialTitle')}
          {typeof data?.unreadCount === 'number' && data.unreadCount > 0 && ` (${t('notifications.unreadCount', { count: data.unreadCount })})`}
        </h2>
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && notificationActionError && <ErrorState message={notificationActionError} />}

        {!loading && !error && data && data.notifications.length > 0 && (
          <div className="field" style={{ maxWidth: '20rem' }}>
            <label htmlFor="notifications-read-filter">{t('notifications.filterLabel')}</label>
            <select
              id="notifications-read-filter"
              value={readFilter}
              onChange={(e) => {
                setReadFilter(e.target.value as ReadFilter);
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <option value="">{t('notifications.filterAll')}</option>
              <option value="UNREAD">{t('notifications.filterUnread')}</option>
              <option value="READ">{t('notifications.filterRead')}</option>
            </select>
          </div>
        )}

        {!loading && !error && data && data.notifications.length === 0 && <p>{t('notifications.commercialEmpty')}</p>}
        {!loading && !error && data && data.notifications.length > 0 && filteredNotifications.length === 0 && (
          <p>{t('notifications.commercialEmptyForFilter')}</p>
        )}

        {!loading && !error && filteredNotifications.length > 0 && (
          <>
            <ul className="plain-list">
              {visibleNotifications.map((n) => (
                <li key={n.notificationId}>
                  <strong>{t(`notifications.eventType.${n.eventType}`)}</strong>{' '}
                  <span style={{ color: 'var(--color-text-muted)' }}>{new Date(n.createdAtUtc).toLocaleString(i18n.language)}</span>
                  {n.readAtUtc === null && (
                    <>
                      {' '}
                      <button type="button" className="btn btn-sm" onClick={() => void markRead(n.notificationId)}>
                        {t('notifications.markRead')}
                      </button>
                    </>
                  )}
                  {n.acknowledgedAtUtc === null && (
                    <>
                      {' '}
                      <button type="button" className="btn btn-sm" onClick={() => void acknowledge(n.notificationId)}>
                        {t('notifications.acknowledge')}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {visibleCount < filteredNotifications.length && (
              <button type="button" className="btn" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                {t('notifications.showMore', { count: filteredNotifications.length - visibleCount })}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
