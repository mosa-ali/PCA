import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { planRefLabel } from '../../i18n/enumLabels';
import { Link, useParams } from 'react-router-dom';
import { platformAdminApi, PlatformAdminApiError, isNotFoundError } from '../../api/platformAdminApiClient';
import type { AccountStatusChangeResult, AccountSummaryDto } from '../../domain/accounts';
import { LoadingState } from '../../components/common/LoadingState';
import { ErrorState } from '../../components/common/ErrorState';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useStepUp } from '../../state/StepUpContext';
import { useToast } from '../../state/ToastContext';
import type { PlatformAdminStepUpScope } from '../../domain/stepUpScopes';

const SUSPENSION_REASON_MAX_LENGTH = 500;

export default function AccountDetail() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const { requestStepUp } = useStepUp();
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [suspendReason, setSuspendReason] = useState('');
  const [statusActionBusy, setStatusActionBusy] = useState(false);

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

  // PCA-ADD-PA-017: every mutating call here requires a fresh step-up
  // re-verification (never assumes login MFA suffices, see StepUpContext) --
  // this is this app's established confirmation gate for a sensitive action
  // (mirrors AdminUsers.tsx's disable/reactivate and
  // ComplimentaryCapacity.tsx's revoke/renew; this codebase has no separate
  // ConfirmDialog/modal pattern to reuse instead of it).
  const withStepUp = async (scope: PlatformAdminStepUpScope, action: (stepUpId: string) => Promise<void>) => {
    setStatusActionBusy(true);
    try {
      const stepUpId = await requestStepUp(scope);
      if (!stepUpId) return;
      await action(stepUpId);
    } catch (err) {
      notify(err instanceof PlatformAdminApiError ? t(`errors.${err.status}`, t('common.unexpectedError')) : t('common.unexpectedError'), 'error');
    } finally {
      setStatusActionBusy(false);
    }
  };

  const onSuspend = () => {
    if (!account) return;
    const reason = suspendReason.trim();
    if (!reason) {
      notify(t('accounts.suspendReasonRequired'), 'error');
      return;
    }
    void withStepUp('FAMILY_ACCOUNT_SUSPEND', async (stepUpId) => {
      const result = await platformAdminApi.post<AccountStatusChangeResult>(`/platform-admin/accounts/${encodeURIComponent(account.familyId)}/suspend`, {
        reason,
        stepUpId,
      });
      setAccount((prev) => (prev ? { ...prev, status: result.status, suspendedAt: result.suspendedAt, suspensionReason: result.suspensionReason } : prev));
      setSuspendReason('');
      notify(t('accounts.suspendSuccess'), 'success');
    });
  };

  const onReactivate = () => {
    if (!account) return;
    void withStepUp('FAMILY_ACCOUNT_REACTIVATE', async (stepUpId) => {
      const result = await platformAdminApi.post<AccountStatusChangeResult>(`/platform-admin/accounts/${encodeURIComponent(account.familyId)}/reactivate`, {
        stepUpId,
      });
      setAccount((prev) => (prev ? { ...prev, status: result.status, suspendedAt: result.suspendedAt, suspensionReason: result.suspensionReason } : prev));
      notify(t('accounts.reactivateSuccess'), 'success');
    });
  };

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
              <dd>
                {account.deletedAt ? (
                  t('accounts.deleted')
                ) : (
                  <span className={`badge ${account.status === 'SUSPENDED' ? 'badge-danger' : 'badge-success'}`}>{t(`accounts.statuses.${account.status}`)}</span>
                )}
              </dd>
              {account.deletedAt && (
                <>
                  <dt>{t('accounts.deletedAt')}</dt>
                  <dd>{new Date(account.deletedAt).toLocaleString()}</dd>
                </>
              )}
              {!account.deletedAt && account.status === 'SUSPENDED' && (
                <>
                  <dt>{t('accounts.suspendedAt')}</dt>
                  <dd>{account.suspendedAt ? new Date(account.suspendedAt).toLocaleString() : '—'}</dd>
                  <dt>{t('accounts.suspensionReason')}</dt>
                  <dd>{account.suspensionReason ?? '—'}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="card">
            <h2 className="section-title">{t('accounts.entitlement')}</h2>
            {account.entitlement ? (
              <dl className="kv-list">
                <dt>{t('accounts.plan')}</dt>
                <dd>{account.entitlement.planRef ? planRefLabel(t, account.entitlement.planRef) : '—'}</dd>
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
                {/* Reuses the existing billing.subscriptionStatuses table (the same
                    TRIALING/ACTIVE/PAST_DUE/CANCELED/EXPIRED union backend/src/billing/
                    subscription.ts defines) rather than duplicating those labels under
                    accounts.*; the raw wire value is the explicit fallback so an
                    unmapped status degrades to the code instead of a bare i18n key. */}
                <dd>{t(`billing.subscriptionStatuses.${account.latestSubscription.status}`, account.latestSubscription.status)}</dd>
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
            {account.deletedAt ? (
              <p className="status-unavailable">{t('accounts.statusActionsUnavailable')}</p>
            ) : (
              <div className="actions-row">
                {account.status === 'ACTIVE' && (
                  <PermissionGate operation="SUSPEND_FAMILY_ACCOUNT">
                    <input
                      aria-label={t('accounts.suspendReasonLabel')}
                      placeholder={t('accounts.suspendReasonLabel')}
                      maxLength={SUSPENSION_REASON_MAX_LENGTH}
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                    />
                    <button type="button" className="btn" disabled={statusActionBusy} onClick={onSuspend}>
                      {t('accounts.suspend')}
                    </button>
                  </PermissionGate>
                )}
                {account.status === 'SUSPENDED' && (
                  <PermissionGate operation="REACTIVATE_FAMILY_ACCOUNT">
                    <button type="button" className="btn btn-primary" disabled={statusActionBusy} onClick={onReactivate}>
                      {t('accounts.reactivate')}
                    </button>
                  </PermissionGate>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
