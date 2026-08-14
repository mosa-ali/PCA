// PCA-ADD-PA-054: parentMemberLimit increases are never priced -- this flow
// never touches PriceBook/Quote/payment, and never routes through the
// billable device-increase checkout path. A request is approved or denied
// by Platform Administration directly, at no charge.
//
// Once a request exists, it is tracked by requestId (?requestId=... in the
// URL) and re-read via getRequest, NOT via entitlement.openRequests --
// openRequests deliberately excludes terminal states, so an APPROVED/DENIED
// outcome must not silently disappear back into the create-new-request form.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { RequestStateBadge } from '../../components/billing/RequestStateBadge';

export default function ParentMemberIncreaseRequest() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId');
  const [customTarget, setCustomTarget] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
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

  const submit = async () => {
    setFormError(null);
    const targetLimit = Number.parseInt(customTarget, 10);
    if (!Number.isInteger(targetLimit) || targetLimit <= entitlement.parentMemberLimit) {
      setFormError(t('subscription.increaseMembers.invalidTarget', { current: entitlement.parentMemberLimit }));
      return;
    }
    setBusy(true);
    try {
      const created = await clients.billing.requestLimitIncrease('PARENT_MEMBER_LIMIT', targetLimit);
      navigate(`/subscription/increase-parent-members?requestId=${created.requestId}`, { replace: true });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await clients.billing.cancelRequest(id);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="member-increase-title">
      <h1 id="member-increase-title">{t('subscription.increaseMembers.title')}</h1>
      <p>{t('subscription.increaseMembers.neverBillable')}</p>
      {formError && <ErrorState message={formError} />}

      {request ? (
        <div className="card">
          <p>
            <RequestStateBadge request={request} />
          </p>
          <dl>
            <dt>{t('subscription.increaseMembers.current')}</dt>
            <dd>{request.currentLimitAtRequest}</dd>
            <dt>{t('subscription.increaseMembers.requested')}</dt>
            <dd>{request.targetLimit}</dd>
          </dl>
          {request.state === 'APPROVED' && <p role="status">{t('subscription.increaseMembers.approved', { limit: entitlement.parentMemberLimit })}</p>}
          {request.state === 'DENIED' && (
            <ErrorState message={t('subscription.increaseMembers.denied', { reason: request.denialReason ?? t('subscription.increaseDevices.denialUnspecified') })} />
          )}
          {request.state === 'CANCELLED' && <p>{t('subscription.increaseDevices.cancelled')}</p>}
          {request.state === 'PENDING' && (
            <button type="button" className="btn" disabled={busy} onClick={() => cancel(request.requestId)}>
              {t('subscription.increaseDevices.cancelRequest')}
            </button>
          )}
          <button type="button" className="btn" onClick={reload}>
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="card">
          <p>{t('subscription.increaseMembers.currentAllowance', { count: entitlement.parentMemberLimit })}</p>
          <label htmlFor="member-target">{t('subscription.increaseMembers.targetLabel')}</label>
          <input
            id="member-target"
            type="number"
            min={entitlement.parentMemberLimit + 1}
            step={1}
            value={customTarget}
            disabled={busy}
            onChange={(e) => setCustomTarget(e.target.value)}
          />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {t('subscription.increaseMembers.submit')}
          </button>
        </div>
      )}
      <p>
        <Link to="/subscription">{t('common.back')}</Link>
      </p>
    </section>
  );
}
