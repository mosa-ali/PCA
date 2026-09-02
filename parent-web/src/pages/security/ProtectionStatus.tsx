import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ProtectionAlertPanel } from './ProtectionAlertPanel';

export default function ProtectionStatus() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getDashboard(), []);
  // Genuinely separate fetch from the dashboard snapshot above -- see
  // ProtectionAlertFeedResult's own doc comment in api/interfaces.ts. While
  // this hasn't resolved yet, `alertFeed` is null, which is rendered as the
  // same honest PENDING_TRUSTED_DECRYPTION state as an explicit pending
  // result -- never a fabricated empty list.
  const { data: alertFeed } = useAsync(() => clients.protectionAlertDelivery.list(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <section aria-labelledby="protection-title">
      <h1 id="protection-title">{t('nav.protectionStatus')}</h1>
      <p>{t('protectionStatus.epochSummary', { trustSetEpoch: data.familyEpoch.trustSetEpoch, keyEpoch: data.familyEpoch.keyEpoch })}</p>
      <div className="card-grid">
        {data.children.map((c) => (
          <article className="card" key={c.childId}>
            <h2>{c.displayName}</h2>
            <p>
              {t('dashboard.protectionCapability')}: <StatusBadge state={c.protectionCapabilityState} />
            </p>
            <p>
              {t('dashboard.policyDelivery')}: <StatusBadge state={c.policyDeliveryState} />
            </p>
          </article>
        ))}
      </div>
      <ProtectionAlertPanel
        alerts={alertFeed?.status === 'READY' ? alertFeed.alerts : []}
        feedState={alertFeed?.status === 'READY' ? 'READY' : 'PENDING_TRUSTED_DECRYPTION'}
      />
    </section>
  );
}
