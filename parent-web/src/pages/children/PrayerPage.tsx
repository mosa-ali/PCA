import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';

export default function PrayerPage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getPrayerSettings(childId), [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.prayer')}</h2>
        <StatusBadge state={data.state} />
        <p>
          {t('prayer.calculationMethod', {
            method: t(`prayer.methods.${data.calculationMethod}`, { defaultValue: data.calculationMethod }),
          })}
        </p>
        <p>{t('prayer.reminders', { status: data.remindersEnabled ? t('common.enable') : t('common.disable') })}</p>
      </article>
    </div>
  );
}
