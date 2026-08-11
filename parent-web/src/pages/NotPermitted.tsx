import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { useCurrentRole } from '../state/AuthContext';

export default function NotPermitted() {
  const { t } = useTranslation();
  const location = useLocation();
  const role = useCurrentRole();
  const state = location.state as { reason?: string } | null;

  return (
    <section aria-labelledby="not-permitted-title" role="alert">
      <h1 id="not-permitted-title">{t('rbac.deniedTitle')}</h1>
      <p>{t('rbac.deniedBody', { role: t(`roles.${role.toLowerCase()}`) })}</p>
      {state?.reason && <p style={{ color: 'var(--color-text-muted)' }}>{state.reason}</p>}
      <Link to="/dashboard" className="btn">
        {t('common.back')}
      </Link>
    </section>
  );
}
