import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError, isNotFoundError } from '../../api/platformAdminApiClient';
import type { AccountSummaryDto } from '../../domain/accounts';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';

export default function AccountDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    platformAdminApi
      .get<AccountSummaryDto>(`/platform-admin/accounts/${encodeURIComponent(id)}`)
      .then(setAccount)
      .catch((err: unknown) => {
        if (isNotFoundError(err)) {
          setNotFound(true);
          return;
        }
        setError(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'));
      })
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  return (
    <div className="page">
      <h1>{t('accounts.detailTitle', { familyId: id })}</h1>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {notFound && <p className="status-unavailable">{t('accounts.notFound')}</p>}

      {account && (
        <>
          <section className="card">
            <h2 className="section-title">{t('accounts.overview')}</h2>
            <dl className="kv-list">
              <dt>{t('accounts.familyId')}</dt>
              <dd>{account.familyId}</dd>
              <dt>{t('accounts.createdAt')}</dt>
              <dd>{account.createdAt ? new Date(account.createdAt).toLocaleString() : '—'}</dd>
              <dt>{t('accounts.status')}</dt>
              <dd>{account.deletedAt ? t('accounts.deleted') : account.statusCapability}</dd>
              {account.deletedAt && (
                <>
                  <dt>{t('accounts.deletedAt')}</dt>
                  <dd>{new Date(account.deletedAt).toLocaleString()}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="card">
            <h2 className="section-title">{t('accounts.entitlement')}</h2>
            {account.entitlement ? (
              <dl className="kv-list">
                <dt>{t('accounts.plan')}</dt>
                <dd>{account.entitlement.planRef ?? '—'}</dd>
                <dt>{t('accounts.parentMembers')}</dt>
                <dd>
                  {account.entitlement.parentMemberUsedCount}/{account.entitlement.parentMemberLimit}
                  {account.entitlement.overLimitParentMember && <span className="badge badge-warning">{t('accounts.overLimit')}</span>}
                </dd>
                <dt>{t('accounts.devices')}</dt>
                <dd>
                  {account.entitlement.managedDeviceActiveCount}/{account.entitlement.managedDeviceLimit} ({t('accounts.reserved')}: {account.entitlement.managedDeviceReservedCount})
                  {account.entitlement.overLimitManagedDevice && <span className="badge badge-warning">{t('accounts.overLimit')}</span>}
                </dd>
              </dl>
            ) : (
              <p className="status-unavailable">{t('accounts.noEntitlement')}</p>
            )}
            <div className="actions-row">
              <Link className="btn" to={`/entitlements?familyId=${encodeURIComponent(account.familyId)}`}>
                {t('accounts.manageEntitlement')}
              </Link>
              <Link className="btn" to={`/entitlement-requests?familyId=${encodeURIComponent(account.familyId)}`}>
                {t('accounts.viewRequests')}
              </Link>
            </div>
          </section>

          <section className="card">
            <h2 className="section-title">{t('accounts.subscription')}</h2>
            {account.latestSubscription ? (
              <dl className="kv-list">
                <dt>{t('accounts.subscriptionId')}</dt>
                <dd>{account.latestSubscription.subscriptionId}</dd>
                <dt>{t('accounts.subscriptionStatus')}</dt>
                <dd>{account.latestSubscription.status}</dd>
                <dt>{t('accounts.currentPeriod')}</dt>
                <dd>
                  {account.latestSubscription.currentPeriodStart ? new Date(account.latestSubscription.currentPeriodStart).toLocaleDateString() : '—'} –{' '}
                  {account.latestSubscription.currentPeriodEnd ? new Date(account.latestSubscription.currentPeriodEnd).toLocaleDateString() : '—'}
                </dd>
              </dl>
            ) : (
              <p className="status-unavailable">{t('accounts.noSubscription')}</p>
            )}
          </section>

          <section className="card">
            <h2 className="section-title">{t('accounts.statusActions')}</h2>
            <p className="status-unavailable">{t('accounts.statusActionsUnavailable')}</p>
            <div className="actions-row">
              <button type="button" className="btn" disabled aria-disabled="true" title={t('accounts.statusActionsUnavailable')}>
                {t('accounts.suspend')}
              </button>
              <button type="button" className="btn" disabled aria-disabled="true" title={t('accounts.statusActionsUnavailable')}>
                {t('accounts.reactivate')}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
