import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

export default function NotPermitted() {
  const { t } = useTranslation();
  const location = useLocation();
  const state = location.state as { from?: string; operation?: string } | null;
  const backTo = state?.from ?? '/dashboard';

  return (
    <div className="page">
      <div className="card" role="alert">
        <h1>{t('notPermitted.title')}</h1>
        <p>{t('notPermitted.body')}</p>
        {state?.operation && <p className="status-unavailable">{t('notPermitted.requiredOperation', { operation: state.operation })}</p>}
        <Link to={backTo} className="btn">
          {t('common.back')}
        </Link>
      </div>
    </div>
  );
}
