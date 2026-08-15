import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../state/AuthContext';
import { platformAdminApi, PlatformAdminApiError } from '../api/platformAdminApiClient';
import type { PlatformDashboardSnapshot } from '../domain/dashboard';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorState } from '../components/common/ErrorState';

function GroupedBadges({ byKey }: { byKey: Record<string, number> | null }) {
  const { t } = useTranslation();
  if (!byKey || Object.keys(byKey).length === 0) return <p className="status-unavailable">{t('common.empty')}</p>;
  return (
    <div className="actions-row">
      {Object.entries(byKey).map(([key, count]) => (
        <span key={key} className="badge">
          {key}: {count}
        </span>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { adminId, roles, sessionExpiresAt } = useAuth();
  const roleLabels = roles.map((role) => t(`roles.${role}`)).join(', ');
  const [snapshot, setSnapshot] = useState<PlatformDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    platformAdminApi
      .get<PlatformDashboardSnapshot>('/platform-admin/dashboard')
      .then(setSnapshot)
      .catch((err: unknown) => {
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [t]);

  return (
    <div className="page">
      <h1>{t('dashboard.title')}</h1>

      <section className="card">
        <h2>{t('dashboard.identityCardTitle')}</h2>
        <dl className="kv-list">
          <dt>{t('login.emailLabel')}</dt>
          <dd>{adminId}</dd>
          <dt>{t('dashboard.rolesLabel')}</dt>
          <dd>{roleLabels}</dd>
          {sessionExpiresAt && (
            <>
              <dt>{t('dashboard.sessionExpiresLabel')}</dt>
              <dd>{new Date(sessionExpiresAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </section>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}

      {snapshot && (
        <>
          <section className="card">
            <h2 className="section-title">{t('dashboard.kpisTitle')}</h2>
            <p className="status-unavailable">{t('dashboard.generatedAt', { time: new Date(snapshot.generatedAt).toLocaleString() })}</p>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr>
                    <th scope="row">{t('dashboard.accountsTotal')}</th>
                    <td>{snapshot.accountsTotal.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.accountsActiveSuspended')}</th>
                    <td className="status-unavailable">{snapshot.accountsActiveSuspended.reason}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.parentMemberUtilization')}</th>
                    <td>
                      {snapshot.parentMemberEntitlementUtilization.used ?? '—'} / {snapshot.parentMemberEntitlementUtilization.limit ?? '—'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.deviceUtilization')}</th>
                    <td>
                      {snapshot.managedDeviceEntitlementUtilization.used ?? '—'} / {snapshot.managedDeviceEntitlementUtilization.limit ?? '—'}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.deviceActive')}</th>
                    <td>{snapshot.managedDeviceActive.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.deviceReserved')}</th>
                    <td>{snapshot.managedDeviceReserved.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.pendingRequests')}</th>
                    <td>{snapshot.pendingEntitlementRequests.value ?? '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('dashboard.openDisputes')}</th>
                    <td>{snapshot.openDisputes.value ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.requestsByState')}</h2>
            <GroupedBadges byKey={snapshot.entitlementRequestsByState.byKey} />
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.subscriptionsByStatus')}</h2>
            <GroupedBadges byKey={snapshot.subscriptionsByStatus.byKey} />
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.quotesByStatus')}</h2>
            <GroupedBadges byKey={snapshot.quotesByStatus.byKey} />
          </section>

          <section className="card">
            <h2 className="section-title">{t('dashboard.invoicesByStatusCurrency')}</h2>
            {snapshot.invoicesByStatusAndCurrency.rows && snapshot.invoicesByStatusAndCurrency.rows.length > 0 ? (
              <div className="actions-row">
                {snapshot.invoicesByStatusAndCurrency.rows.map((row) => (
                  <span key={`${row.status}-${row.currencyCode}`} className="badge">
                    {row.status} ({row.currencyCode}): {row.count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="status-unavailable">{t('common.empty')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
