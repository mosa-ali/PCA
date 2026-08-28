import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

export default function NotPermitted() {
  const { t } = useTranslation();
  const location = useLocation();
  const state = location.state as { from?: string; operation?: string } | null;
  // NEVER link back to state.from: every guard that redirects here
  // (RouteGuard/BillingRouteGuard/SettlementRouteGuard) sets `from` to the
  // route it just DENIED, so "Back" pointed straight at a route whose guard
  // immediately bounces the operator to /not-permitted again -- a dead loop.
  // The dashboard is the one destination every role can actually reach
  // (VIEW_PLATFORM_DASHBOARD is ALLOW for all five roles in domain/roles.ts),
  // which is exactly what the link's label already promises.
  const backTo = '/dashboard';

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
