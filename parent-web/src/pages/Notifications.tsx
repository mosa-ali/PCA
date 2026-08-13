import { useTranslation } from 'react-i18next';

export default function Notifications() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="notifications-title">
      <h1 id="notifications-title">{t('nav.notifications')}</h1>
      <div className="card">
        <label className="checkbox-row">
          <input type="checkbox" defaultChecked /> {t('notifications.emailAlerts')}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" defaultChecked /> {t('notifications.pushRequests')}
        </label>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('notifications.payloadNote')}</p>
    </section>
  );
}
