// PCA_ADDENDUM_002 Section 18.1: the full, ordered device-entitlement
// increase self-service flow -- view current allowance, choose/request a
// target quantity, see the exact price (or a PENDING_ADMIN_QUOTE state)
// before payment, hand off to checkout, and reflect only server-confirmed
// state afterward. This page never marks a request APPROVED itself --
// APPROVED is only ever read back from BillingClient.getRequest.
//
// Once a request exists, it is tracked by requestId (?requestId=... in the
// URL) and re-read via getRequest, NOT via entitlement.openRequests --
// openRequests deliberately excludes terminal states (APPROVED/DENIED/
// CANCELLED), so deriving the "existing request" view from it would make a
// just-approved or just-denied request silently vanish back into the
// create-new-request form instead of showing its outcome.
import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { RequestStateBadge } from '../../components/billing/RequestStateBadge';
import { formatMoney, isQuoteExpired, suggestedDeviceTargets } from '../../domain/billing';

export default function DeviceIncreaseRequest() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId');
  const [customTarget, setCustomTarget] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const entitlement = await clients.billing.getEntitlement();
    const request = requestId ? await clients.billing.getRequest(requestId) : null;
    return { entitlement, request };
  }, [requestId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { entitlement, request } = data;

  const submit = async (targetLimit: number) => {
    setFormError(null);
    if (!Number.isInteger(targetLimit) || targetLimit <= entitlement.managedDeviceLimit) {
      setFormError(t('subscription.increaseDevices.invalidTarget', { current: entitlement.managedDeviceLimit }));
      return;
    }
    setBusy(true);
    try {
      const created = await clients.billing.requestLimitIncrease('MANAGED_DEVICE_LIMIT', targetLimit);
      navigate(`/subscription/increase-devices?requestId=${created.requestId}`, { replace: true });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setActionError(null);
    setBusy(true);
    try {
      await clients.billing.cancelRequest(id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const beginCheckout = async (id: string) => {
    setActionError(null);
    setBusy(true);
    try {
      await clients.billing.beginCheckout(id);
      navigate(`/subscription/checkout-return?requestId=${id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('common.errorGeneric'));
      setBusy(false);
    }
  };

  if (request) {
    const quoteExpired = request.quote ? isQuoteExpired(request.quote, new Date().toISOString()) : false;
    return (
      <section aria-labelledby="device-increase-title">
        <h1 id="device-increase-title">{t('subscription.increaseDevices.title')}</h1>
        {actionError && <ErrorState message={actionError} />}
        <div className="card">
          <p>
            <RequestStateBadge request={request} />
          </p>
          <dl>
            <dt>{t('subscription.increaseDevices.current')}</dt>
            <dd>{request.currentLimitAtRequest}</dd>
            <dt>{t('subscription.increaseDevices.requested')}</dt>
            <dd>{request.targetLimit}</dd>
          </dl>

          {request.state === 'PENDING' && request.awaitingAdminQuote && <p>{t('subscription.increaseDevices.awaitingAdminQuote')}</p>}

          {request.quote && (
            <div>
              <p>
                <strong>{t('subscription.increaseDevices.price')}</strong> {formatMoney(request.quote.price, i18n.language)}
              </p>
              {request.quote.expiresAtUtc && (
                <p>{t('subscription.increaseDevices.quoteExpires', { date: new Date(request.quote.expiresAtUtc).toLocaleString(i18n.language) })}</p>
              )}
              {quoteExpired && <ErrorState message={t('subscription.increaseDevices.quoteExpired')} />}
            </div>
          )}

          {request.state === 'QUOTED' && !quoteExpired && (
            <>
              {clients.billing.isPaymentProviderAvailable() ? (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => beginCheckout(request.requestId)}>
                  {t('subscription.increaseDevices.proceedToPayment')}
                </button>
              ) : (
                <p role="status">{t('subscription.paymentProviderUnavailable')}</p>
              )}
            </>
          )}

          {request.state === 'PAYMENT_PENDING' && (
            <p role="status" aria-live="polite">
              {t('subscription.increaseDevices.confirmingPayment')}
            </p>
          )}

          {request.state === 'APPROVED' && (
            <p role="status">
              {t('subscription.increaseDevices.approved', { used: entitlement.managedDeviceActive, limit: entitlement.managedDeviceLimit })}
            </p>
          )}
          {request.state === 'DENIED' && <ErrorState message={t('subscription.increaseDevices.denied', { reason: request.denialReason ?? t('subscription.increaseDevices.denialUnspecified') })} />}
          {request.state === 'CANCELLED' && <p>{t('subscription.increaseDevices.cancelled')}</p>}

          {(request.state === 'PENDING' || request.state === 'QUOTED') && (
            <button type="button" className="btn" disabled={busy} onClick={() => cancel(request.requestId)}>
              {t('subscription.increaseDevices.cancelRequest')}
            </button>
          )}
          <button type="button" className="btn" onClick={reload}>
            {t('common.retry')}
          </button>
        </div>
        <p>
          <Link to="/subscription">{t('common.back')}</Link>
        </p>
      </section>
    );
  }

  const suggested = suggestedDeviceTargets(entitlement.managedDeviceLimit);

  return (
    <section aria-labelledby="device-increase-title">
      <h1 id="device-increase-title">{t('subscription.increaseDevices.title')}</h1>
      <p>{t('subscription.increaseDevices.currentAllowance', { count: entitlement.managedDeviceLimit })}</p>
      {formError && <ErrorState message={formError} />}
      <div className="card">
        <fieldset disabled={busy}>
          <legend>{t('subscription.increaseDevices.chooseTarget')}</legend>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBlockEnd: '1rem' }}>
            {suggested.map((n) => (
              <button key={n} type="button" className="btn" onClick={() => submit(n)}>
                {t('subscription.increaseDevices.suggestedTarget', { count: n })}
              </button>
            ))}
          </div>
          <label htmlFor="custom-target">{t('subscription.increaseDevices.customTargetLabel')}</label>
          <input
            id="custom-target"
            type="number"
            min={entitlement.managedDeviceLimit + 1}
            step={1}
            value={customTarget}
            onChange={(e) => setCustomTarget(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const parsed = Number.parseInt(customTarget, 10);
              submit(parsed);
            }}
          >
            {t('subscription.increaseDevices.submit')}
          </button>
        </fieldset>
      </div>
      <p>
        <Link to="/subscription">{t('common.back')}</Link>
      </p>
    </section>
  );
}
