import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

export default function ProtectionStatus() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getDashboard(), []);

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
    </section>
  );
}
