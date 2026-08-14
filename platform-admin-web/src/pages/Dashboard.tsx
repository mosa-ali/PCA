import { useTranslation } from 'react-i18next';
import { useAuth } from '../state/AuthContext';

/**
 * Only the identity/session panel is backed by a real endpoint (whoami).
 * KPI aggregates (account/entitlement/billing counts, mission Section 11)
 * have no backend dashboard endpoint yet -- see this app's README
 * BACKEND_GAP_REQUIRED entry. No KPI numbers are fabricated here.
 */
export default function Dashboard() {
  const { t } = useTranslation();
  const { adminId, roles, sessionExpiresAt } = useAuth();
  const roleLabels = roles.map((role) => t(`roles.${role}`)).join(', ');

  return (
    <div className="page">
      <h1>{t('dashboard.title')}</h1>

      <section className="card">
        <h2>{t('dashboard.identityCardTitle')}</h2>
        <dl className="kv-list">
          <dt>{t('login.emailLabel')}</dt>
          <dd>{adminId}</dd>
          <dt>Roles</dt>
          <dd>{roleLabels}</dd>
          {sessionExpiresAt && (
            <>
              <dt>Session expires</dt>
              <dd>{new Date(sessionExpiresAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="card coming-soon" role="status">
        <h2>{t('common.comingSoonTitle')}</h2>
        <p>{t('dashboard.kpisComingSoonBody')}</p>
      </section>
    </div>
  );
}
