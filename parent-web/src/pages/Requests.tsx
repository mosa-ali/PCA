import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../components/common/States';
import { PermissionGate } from '../rbac/PermissionGate';
import { useFamilyAction } from '../rbac/useFamilyAction';
import { StatusBadge } from '../components/common/StatusBadge';
import { MAX_BONUS_GRANT_MINUTES, MIN_BONUS_GRANT_MINUTES, validateBonusMinutes, validateCounterOffer } from '../domain/bonusTime';
import type { RequestStatus, RequestType } from '../domain/types';

// The Type and Status columns used to render `req.type` / `req.status`
// verbatim, so a parent read the backend enum ("BONUS_TIME", "COUNTERED") in
// every locale. Both are family-facing terminology, not raw wire values: they
// go through requestsPage.types.* / requestsPage.decision* like every other
// status shown on this page (StatusBadge's install-capability states,
// policyStatus.*), so they render correctly in Arabic too. The status labels
// reuse the `requestsPage.decision*` keys that already existed for exactly
// these values.
const REQUEST_TYPE_LABEL_KEYS: Readonly<Record<RequestType, string>> = {
  BONUS_TIME: 'requestsPage.types.BONUS_TIME',
  UNBLOCK_APP: 'requestsPage.types.UNBLOCK_APP',
  UNBLOCK_SITE: 'requestsPage.types.UNBLOCK_SITE',
  EXCEPTION: 'requestsPage.types.EXCEPTION',
  DEVICE_PAIRING: 'requestsPage.types.DEVICE_PAIRING',
  INSTALL_APPROVAL: 'requestsPage.types.INSTALL_APPROVAL',
};

const REQUEST_STATUS_LABEL_KEYS: Readonly<Record<RequestStatus, string>> = {
  PENDING: 'requestsPage.decisionPending',
  APPROVED: 'requestsPage.decisionApproved',
  DENIED: 'requestsPage.decisionDenied',
  COUNTERED: 'requestsPage.decisionCountered',
  EXPIRED: 'requestsPage.decisionExpired',
  CANCELLED: 'requestsPage.decisionCancelled',
};

export default function Requests() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data, loading, error, reload } = useAsync(() => clients.requests.listRequests(), []);
  const { data: dashboard } = useAsync(() => clients.parentFamilyData.getDashboard(), []);

  const [counterOfferByRequest, setCounterOfferByRequest] = useState<Record<string, string>>({});
  const [counterOfferError, setCounterOfferError] = useState<string | null>(null);
  const [grantChildId, setGrantChildId] = useState('');
  const [grantMinutes, setGrantMinutes] = useState('');
  const [grantError, setGrantError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = async (requestId: string, decision: 'APPROVED' | 'DENIED') => {
    setActionError(null);
    try {
      await runFamilyAction('APPROVE_REQUEST', () => clients.requests.decide(requestId, decision));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('requestsPage.actionErrorFallback'));
    }
  };

  const counterOffer = async (requestId: string, requestedExtraMinutes: number) => {
    setCounterOfferError(null);
    const raw = counterOfferByRequest[requestId];
    const minutes = Number(raw);
    const validationError = validateCounterOffer(minutes, requestedExtraMinutes);
    if (validationError) {
      setCounterOfferError(t(`requestsPage.bonusTime.counterOfferError.${validationError}`));
      return;
    }
    try {
      await runFamilyAction('APPROVE_REQUEST', () => clients.requests.decide(requestId, 'COUNTERED', minutes));
      setCounterOfferByRequest((prev) => ({ ...prev, [requestId]: '' }));
      reload();
    } catch (err) {
      setCounterOfferError(err instanceof Error ? err.message : t('requestsPage.actionErrorFallback'));
    }
  };

  const grantDirectly = async () => {
    setGrantError(null);
    if (!grantChildId) {
      setGrantError(t('requestsPage.bonusTime.grantErrorNoChild'));
      return;
    }
    const minutes = Number(grantMinutes);
    const validationError = validateBonusMinutes(minutes);
    if (validationError) {
      setGrantError(t(`requestsPage.bonusTime.grantError.${validationError}`));
      return;
    }
    setGranting(true);
    try {
      await runFamilyAction('APPROVE_REQUEST', () => clients.requests.grantBonusTime(grantChildId, minutes));
      setGrantMinutes('');
      reload();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : t('requestsPage.actionErrorFallback'));
    } finally {
      setGranting(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <section aria-labelledby="requests-title">
      <h1 id="requests-title">{t('requestsPage.title')}</h1>

      <PermissionGate action="APPROVE_REQUEST" showDisabledFallback>
        <section aria-labelledby="bonus-time-grant-title" className="card field">
          <h2 id="bonus-time-grant-title">{t('requestsPage.bonusTime.grantTitle')}</h2>
          <p>{t('requestsPage.bonusTime.grantExplanation', { max: MAX_BONUS_GRANT_MINUTES })}</p>
          <div className="field">
            <label htmlFor="grant-child">{t('requestsPage.child')}</label>
            <select id="grant-child" value={grantChildId} onChange={(e) => setGrantChildId(e.target.value)}>
              <option value="">{t('requestsPage.bonusTime.selectChild')}</option>
              {(dashboard?.children ?? []).map((c) => (
                <option key={c.childId} value={c.childId}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="grant-minutes">{t('requestsPage.bonusTime.minutes')}</label>
            <input
              id="grant-minutes"
              type="number"
              min={MIN_BONUS_GRANT_MINUTES}
              max={MAX_BONUS_GRANT_MINUTES}
              value={grantMinutes}
              onChange={(e) => setGrantMinutes(e.target.value)}
            />
          </div>
          {grantError && (
            <p role="alert" className="field-error">
              {grantError}
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={grantDirectly} disabled={granting}>
            {t('requestsPage.bonusTime.grantAction')}
          </button>
        </section>
      </PermissionGate>

      {actionError && (
        <p role="alert" className="field-error">
          {actionError}
        </p>
      )}
      {(!data || data.length === 0) && <EmptyState />}
      {data && data.length > 0 && (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('requestsPage.child')}</th>
                <th scope="col">{t('requestsPage.type')}</th>
                <th scope="col">{t('requestsPage.reason')}</th>
                <th scope="col">{t('requestsPage.bonusTime.minutesColumn')}</th>
                <th scope="col">{t('requestsPage.installApproval.columnLabel')}</th>
                <th scope="col">{t('requestsPage.created')}</th>
                <th scope="col">{t('requestsPage.status')}</th>
                <th scope="col" aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {data.map((req) => (
                <tr key={req.requestId}>
                  <td data-label={t('requestsPage.child')}>{req.childDisplayName}</td>
                  <td data-label={t('requestsPage.type')}>
                    {REQUEST_TYPE_LABEL_KEYS[req.type] ? t(REQUEST_TYPE_LABEL_KEYS[req.type]) : req.type}
                  </td>
                  <td data-label={t('requestsPage.reason')}>
                    <bdi className="iso">{req.reasonText ?? '--'}</bdi>
                  </td>
                  <td data-label={t('requestsPage.bonusTime.minutesColumn')}>
                    {req.type === 'BONUS_TIME'
                      ? req.grantedExtraMinutes != null
                        ? t('requestsPage.bonusTime.grantedMinutes', { minutes: req.grantedExtraMinutes })
                        : req.requestedExtraMinutes != null
                          ? t('requestsPage.bonusTime.requestedMinutes', { minutes: req.requestedExtraMinutes })
                          : '--'
                      : '--'}
                  </td>
                  <td data-label={t('requestsPage.installApproval.columnLabel')}>
                    {req.type === 'INSTALL_APPROVAL' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <bdi className="iso">{req.installTargetAppLabel ?? req.installTargetPackageName ?? t('requestsPage.installApproval.unlabeledApp')}</bdi>
                        {req.installCapabilityState && (
                          <span>
                            {t('requestsPage.installApproval.capabilityAtRequest', { state: t(`state.${req.installCapabilityState}`) })}
                          </span>
                        )}
                        {req.installEnforcementOutcome ? (
                          <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                            {t('requestsPage.installApproval.enforcementOutcomeLabel')}
                            <StatusBadge state={req.installEnforcementOutcome} />
                          </span>
                        ) : (
                          <span>{t('requestsPage.installApproval.enforcementPending')}</span>
                        )}
                        {req.installCapabilityState && req.installCapabilityState !== 'ENFORCED' && (
                          <span style={{ fontSize: '0.85em', opacity: 0.8 }}>{t('requestsPage.installApproval.requestOnlyNotice')}</span>
                        )}
                      </div>
                    ) : (
                      '--'
                    )}
                  </td>
                  <td data-label={t('requestsPage.created')}>
                    {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
                      new Date(req.createdAtUtc),
                    )}
                  </td>
                  <td data-label={t('requestsPage.status')}>
                    {REQUEST_STATUS_LABEL_KEYS[req.status] ? t(REQUEST_STATUS_LABEL_KEYS[req.status]) : req.status}
                  </td>
                  <td>
                    {req.status === 'PENDING' && (
                      <PermissionGate action="APPROVE_REQUEST" showDisabledFallback>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <button type="button" className="btn btn-primary" onClick={() => decide(req.requestId, 'APPROVED')}>
                            {t('common.approve')}
                          </button>
                          <button type="button" className="btn" onClick={() => decide(req.requestId, 'DENIED')}>
                            {t('common.deny')}
                          </button>
                          {req.type === 'BONUS_TIME' && req.requestedExtraMinutes != null && (
                            <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                              <label htmlFor={`counter-${req.requestId}`}>{t('requestsPage.bonusTime.counterOfferLabel')}</label>
                              <input
                                id={`counter-${req.requestId}`}
                                type="number"
                                min={MIN_BONUS_GRANT_MINUTES}
                                max={req.requestedExtraMinutes - 1}
                                style={{ width: '4.5rem' }}
                                value={counterOfferByRequest[req.requestId] ?? ''}
                                onChange={(e) =>
                                  setCounterOfferByRequest((prev) => ({ ...prev, [req.requestId]: e.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn"
                                onClick={() => counterOffer(req.requestId, req.requestedExtraMinutes as number)}
                              >
                                {t('requestsPage.bonusTime.counterOfferAction')}
                              </button>
                            </span>
                          )}
                        </div>
                      </PermissionGate>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {counterOfferError && (
        <p role="alert" className="field-error">
          {counterOfferError}
        </p>
      )}
    </section>
  );
}
