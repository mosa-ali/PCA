import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';

export default function TrustedBrowser() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.trustedBrowser.getSnapshot(), []);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('common.errorGeneric'));
    }
  };

  return (
    <section aria-labelledby="trusted-browser-title">
      <h1 id="trusted-browser-title">{t('trustedBrowser.title')}</h1>
      <p className="card">{t('trustedBrowser.note')}</p>
      <div className="card">
        <p>
          <strong>{t(`trustedBrowser.${data.state}`)}</strong>
        </p>
        <dl>
          <dt>{t('trustedBrowser.serviceAuthenticated')}</dt>
          <dd>{data.serviceAuthenticated ? t('common.yes') : t('common.no')}</dd>
          <dt>{t('trustedBrowser.browserEndpoint')}</dt>
          <dd>{data.browserEndpointId ?? '--'}</dd>
          <dt>{t('trustedBrowser.trustSetEpoch')}</dt>
          <dd>{data.trustSetEpoch ?? '--'}</dd>
        </dl>
        {actionError && <ErrorState message={actionError} />}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {data.state === 'BROWSER_NOT_TRUSTED' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.beginServiceAuthentication())}>
              {t('trustedBrowser.beginServiceAuth')}
            </button>
          )}
          {data.state === 'PAIRING_REQUIRED' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.requestPairing())}>
              {t('trustedBrowser.requestPairing')}
            </button>
          )}
          {/*
            simulateParentApproval/simulateEpochGoneStale/simulateRevoke have
            no real implementation at all outside demo mode -- see
            RealTrustedBrowserProvider, where each unconditionally throws
            ServiceUnavailableError ("a real transition must never be
            fabricated locally"). Showing a "(dev)"-labelled button that
            always fails is not an honest production affordance, so these
            are demo-mode-only, matching this app's established pattern of
            never presenting a debug-only control as a real capability.
          */}
          {clients.isFixtureBacked && data.state === 'PAIRING_PENDING' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.simulateParentApproval())}>
              {t('trustedBrowser.simulateApproval')}
            </button>
          )}
          {clients.isFixtureBacked && data.state === 'TRUSTED' && (
            <>
              <button type="button" className="btn" onClick={() => act(() => clients.trustedBrowser.simulateEpochGoneStale())}>
                {t('trustedBrowser.simulateStale')}
              </button>
              <button type="button" className="btn" onClick={() => act(() => clients.trustedBrowser.simulateRevoke())}>
                {t('trustedBrowser.simulateRevoke')}
              </button>
            </>
          )}
          {clients.isFixtureBacked && data.state === 'EPOCH_STALE' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.simulateParentApproval())}>
              {t('trustedBrowser.resync')}
            </button>
          )}
          {data.state === 'REVOKED' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.beginServiceAuthentication())}>
              {t('trustedBrowser.requestPairing')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => act(() => clients.trustedBrowser.reset())}>
            {t('trustedBrowser.reset')}
          </button>
        </div>
      </div>
    </section>
  );
}
