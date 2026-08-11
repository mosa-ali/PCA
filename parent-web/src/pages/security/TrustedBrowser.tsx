import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';

export default function TrustedBrowser() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.trustedBrowser.getSnapshot(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    reload();
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
          <dt>Service authenticated</dt>
          <dd>{data.serviceAuthenticated ? t('common.yes') : t('common.no')}</dd>
          <dt>Browser endpoint</dt>
          <dd>{data.browserEndpointId ?? '--'}</dd>
          <dt>Trust-set epoch</dt>
          <dd>{data.trustSetEpoch ?? '--'}</dd>
        </dl>
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
          {data.state === 'PAIRING_PENDING' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.simulateParentApproval())}>
              {t('trustedBrowser.simulateApproval')}
            </button>
          )}
          {data.state === 'TRUSTED' && (
            <>
              <button type="button" className="btn" onClick={() => act(() => clients.trustedBrowser.simulateEpochGoneStale())}>
                {t('trustedBrowser.simulateStale')}
              </button>
              <button type="button" className="btn" onClick={() => act(() => clients.trustedBrowser.simulateRevoke())}>
                {t('trustedBrowser.simulateRevoke')}
              </button>
            </>
          )}
          {data.state === 'EPOCH_STALE' && (
            <button type="button" className="btn btn-primary" onClick={() => act(() => clients.trustedBrowser.simulateParentApproval())}>
              Resync (dev)
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
