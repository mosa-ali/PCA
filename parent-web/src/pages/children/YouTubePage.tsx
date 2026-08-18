import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import type { YouTubeSafeContentCapability } from '../../domain/types';

function restrictedModeLabel(capability: YouTubeSafeContentCapability, translate: (key: string) => string): string {
  if (capability.source !== 'YOUTUBE_RESTRICTED_MODE') return translate('state.UNAVAILABLE');

  switch (capability.status) {
    case 'ENABLED':
      return translate('common.yes');
    case 'DISABLED':
      return translate('common.no');
    case 'UNSUPPORTED':
    case 'UNKNOWN':
      return translate('state.UNAVAILABLE');
  }
}

export default function YouTubePage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getYouTubeStatus(childId), [childId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.youtube')}</h2>
        <StatusBadge state={data.visibilityState} />
        <p>{t('youtube.restrictedMode', { status: restrictedModeLabel(data.safeContentCapability, t) })}</p>
        <p>{t('youtube.approvedChannels', { count: data.approvedChannelCount })}</p>
      </article>
    </div>
  );
}
