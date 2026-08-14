// PCA-MYKIDS-BILL-1 (doc PCA_ADDENDUM_002 Section 18): real, source-backed
// commercial self-service overview -- current plan/FREE_STARTER status,
// device/parent-member entitlement usage (active vs. reserved vs. limit,
// PCA-ADD-PA-040), open increase requests, renewal state, and a safe
// payment-method view. Owner-only (RouteGuard in App.tsx gates the route;
// PermissionGate below additionally hides mutating entry points for a
// non-Owner who somehow lands here via a stale link).
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { LoadingState, ErrorState } from '../components/common/States';
import { PermissionGate } from '../rbac/PermissionGate';
import { useStepUp } from '../state/StepUpContext';
import { FREE_STARTER_TIER } from '../domain/billing';
import { RequestStateBadge } from '../components/billing/RequestStateBadge';

export default function Subscription() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const { requestStepUp } = useStepUp();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () =>
      Promise.all([clients.billing.getEntitlement(), clients.billing.getSubscription(), clients.billing.listPaymentMethods()]).then(
        ([entitlement, subscription, paymentMethods]) => ({ entitlement, subscription, paymentMethods }),
      ),
    [],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { entitlement, subscription, paymentMethods } = data;
  const isFreeStarter = entitlement.tier === FREE_STARTER_TIER;

  const cancelAutoRenew = async () => {
    setActionError(null);
    try {
      const granted = await requestStepUp('MANAGE_PAYMENT_METHOD');
      if (!granted) return;
      await clients.billing.cancelAutoRenew();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.errorGeneric'));
    }
  };

  return (
    <section aria-labelledby="subscription-title">
      <h1 id="subscription-title">{t('nav.subscription')}</h1>
      {actionError && <ErrorState message={actionError} />}

      <div className="card" aria-labelledby="subscription-plan-title">
        <h2 id="subscription-plan-title">{t('subscription.planSectionTitle')}</h2>
        {isFreeStarter ? (
          <>
            <p>
              <strong>{t('subscription.freeStarterBadge')}</strong>
            </p>
            <p>{t('subscription.freeStarterIncluded', { count: entitlement.managedDeviceLimit })}</p>
            <p>{t('subscription.freeStarterPrice')}</p>
            <p>{t('subscription.freeStarterExplain')}</p>
          </>
        ) : (
          <>
            <p>{t('subscription.planLabel', { plan: subscription.planLabel })}</p>
            <p>{t('subscription.statusLabel', { status: t(`subscription.status.${subscription.status}`) })}</p>
            {subscription.currentPeriodEndUtc && (
              <p>
                {subscription.autoRenew
                  ? t('subscription.renewsOn', { date: new Date(subscription.currentPeriodEndUtc).toLocaleDateString(i18n.language) })
                  : t('subscription.expiresOn', { date: new Date(subscription.currentPeriodEndUtc).toLocaleDateString(i18n.language) })}
              </p>
            )}
            {subscription.autoRenew && (
              <PermissionGate action="MANAGE_PAYMENT_METHOD" showDisabledFallback>
                <button type="button" className="btn" onClick={cancelAutoRenew}>
                  {t('subscription.cancelAutoRenew')}
                </button>
              </PermissionGate>
            )}
          </>
        )}
      </div>

      <div className="card" aria-labelledby="subscription-devices-title">
        <h2 id="subscription-devices-title">{t('subscription.deviceAllowanceTitle')}</h2>
        <dl>
          <dt>{t('subscription.devicesActive')}</dt>
          <dd>{entitlement.managedDeviceActive}</dd>
          <dt>{t('subscription.devicesReserved')}</dt>
          <dd>{entitlement.managedDeviceReserved}</dd>
          <dt>{t('subscription.devicesLimit')}</dt>
          <dd>{entitlement.managedDeviceLimit}</dd>
          <dt>{t('subscription.devicesAvailable')}</dt>
          <dd>{entitlement.availableDeviceSlots}</dd>
        </dl>
        {entitlement.overLimitManagedDevice && <ErrorState message={t('subscription.overLimitDevices')} />}
        <PermissionGate action="REQUEST_DEVICE_INCREASE" showDisabledFallback>
          <Link className="btn btn-primary" to="/subscription/increase-devices">
            {t('subscription.requestMoreDevices')}
          </Link>
        </PermissionGate>
      </div>

      <div className="card" aria-labelledby="subscription-members-title">
        <h2 id="subscription-members-title">{t('subscription.memberAllowanceTitle')}</h2>
        <dl>
          <dt>{t('subscription.membersUsed')}</dt>
          <dd>{entitlement.parentMemberUsed}</dd>
          <dt>{t('subscription.membersLimit')}</dt>
          <dd>{entitlement.parentMemberLimit}</dd>
        </dl>
        {entitlement.overLimitParentMember && <ErrorState message={t('subscription.overLimitMembers')} />}
        <PermissionGate action="REQUEST_PARENT_MEMBER_INCREASE" showDisabledFallback>
          <Link className="btn" to="/subscription/increase-parent-members">
            {t('subscription.requestMoreMembers')}
          </Link>
        </PermissionGate>
      </div>

      {entitlement.openRequests.length > 0 && (
        <div className="card" aria-labelledby="subscription-requests-title">
          <h2 id="subscription-requests-title">{t('subscription.openRequestsTitle')}</h2>
          <ul className="plain-list">
            {entitlement.openRequests.map((request) => (
              <li key={request.requestId}>
                <RequestStateBadge request={request} />{' '}
                {t(`subscription.limitType.${request.limitType}`)} &rarr; {request.targetLimit}{' '}
                <Link
                  to={
                    request.limitType === 'MANAGED_DEVICE_LIMIT'
                      ? `/subscription/increase-devices?requestId=${request.requestId}`
                      : `/subscription/increase-parent-members?requestId=${request.requestId}`
                  }
                >
                  {t('subscription.viewRequest')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" aria-labelledby="subscription-payment-title">
        <h2 id="subscription-payment-title">{t('subscription.paymentMethodTitle')}</h2>
        {paymentMethods.length === 0 ? (
          <p>{t('subscription.noPaymentMethod')}</p>
        ) : (
          <ul className="plain-list">
            {paymentMethods.map((pm) => (
              <li key={pm.paymentMethodId}>{pm.displayLabel}</li>
            ))}
          </ul>
        )}
        {!clients.billing.isPaymentProviderAvailable() && <p>{t('subscription.paymentProviderUnavailable')}</p>}
      </div>

      <p>
        <Link to="/subscription/invoices">{t('subscription.viewInvoices')}</Link>
      </p>
    </section>
  );
}
