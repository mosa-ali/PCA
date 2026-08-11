import { useTranslation } from 'react-i18next';

export default function Notifications() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="notifications-title">
      <h1 id="notifications-title">{t('nav.notifications')}</h1>
      <div className="card">
        <label className="checkbox-row">
          <input type="checkbox" defaultChecked /> Email me for important alerts
        </label>
        <label className="checkbox-row">
          <input type="checkbox" defaultChecked /> Push notifications for requests
        </label>
      </div>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Notification payloads never contain family activity detail -- only a generic wake signal
        (docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 6).
      </p>
    </section>
  );
}
