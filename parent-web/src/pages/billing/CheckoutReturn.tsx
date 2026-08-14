// PCA-ADD-BILL-035/PCA-ADD-PA-049: this page is a UX affordance ONLY. It
// never locally raises managedDeviceLimit, never marks the request
// APPROVED, and never treats its own rendering as proof of payment -- it
// only ever reflects state read back from BillingClient.getRequest.
// Server-side confirmation (a real provider webhook, or -- only inside
// DevBillingClient itself, never called from this page -- a scheduled dev
// simulation) is the only thing that ever changes that state; this page
// just polls for it while PAYMENT_PENDING, exactly as it would have to
// against a real asynchronous webhook.
import { useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { RequestStateBadge } from '../../components/billing/RequestStateBadge';
import { formatMoney } from '../../domain/billing';
import { getStoredPaymentAttemptId } from '../../domain/checkoutCorrelation';

const POLL_INTERVAL_MS = 1000;

export default function CheckoutReturn() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId');

  const load = useCallback(async () => {
    if (!requestId) return null;
    // The change-request's own lifecycle state (PENDING/QUOTED/
    // PAYMENT_PENDING/APPROVED/DENIED/CANCELLED) is this page's primary,
    // authoritative render driver -- it is what the webhook pipeline
    // ultimately updates. getCheckoutStatus (below) is polled too, purely
    // supplementary (contract: "poll GET .../billing/checkout/:paymentAttemptId
    // -- polling only, not authoritative confirmation"), never substituted
    // for the request-state read.
    const [request, paymentAttemptId] = [await clients.billing.getRequest(requestId), getStoredPaymentAttemptId(requestId)];
    const checkoutStatus = paymentAttemptId ? await clients.billing.getCheckoutStatus(paymentAttemptId).catch(() => null) : null;
    return { request, checkoutStatus };
  }, [clients, requestId]);

  const { data, loading, error, reload } = useAsync(load, [requestId]);
  const request = data?.request ?? null;
  const checkoutStatus = data?.checkoutStatus ?? null;

  useEffect(() => {
    if (request?.state !== 'PAYMENT_PENDING') return;
    const interval = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [request?.state, reload]);

  return (
    <section aria-labelledby="checkout-return-title">
      <h1 id="checkout-return-title">{t('subscription.checkoutReturn.title')}</h1>
      {!requestId && <ErrorState message={t('subscription.checkoutReturn.missingRequest')} />}
      {requestId && loading && <LoadingState />}
      {requestId && !loading && error && <ErrorState message={error} onRetry={reload} />}
      {requestId && !loading && !error && !request && <ErrorState message={t('subscription.checkoutReturn.missingRequest')} />}
      {requestId && !loading && !error && request && (
        <div className="card">
          <p>
            <RequestStateBadge request={request} />
          </p>
          {request.state === 'PAYMENT_PENDING' && (
            <>
              <p role="status" aria-live="polite">
                {t('subscription.checkoutReturn.confirming')}
              </p>
              {checkoutStatus && (
                <p className="text-muted">
                  {t('subscription.checkoutReturn.providerStatus', { status: checkoutStatus.status, amount: formatMoney(checkoutStatus.amount, i18n.language) })}
                </p>
              )}
            </>
          )}
          {request.state === 'APPROVED' && <p role="status">{t('subscription.checkoutReturn.confirmed')}</p>}
          {request.state === 'DENIED' && <ErrorState message={t('subscription.checkoutReturn.failed')} />}
          {request.state === 'CANCELLED' && <p>{t('subscription.increaseDevices.cancelled')}</p>}

          <button type="button" className="btn" onClick={reload}>
            {t('subscription.checkoutReturn.refreshStatus')}
          </button>
        </div>
      )}
      <p>
        <Link to="/subscription">{t('common.back')}</Link>
      </p>
    </section>
  );
}
