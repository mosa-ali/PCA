import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState, EmptyState } from '../../components/common/States';

export default function ChildWellbeingPage() {
  const { t, i18n } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(() => clients.wellbeingMessages.getControl(), []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const targeted = data.customMessages.filter((m) => m.targetChildIds.includes(childId) && !m.archived);
  const lang = i18n.language.split('-')[0];

  return (
    <div>
      <p>
        <Link to="/wellbeing-messages">{t('wellbeing.title')}</Link>
      </p>
      {targeted.length === 0 && <EmptyState message={t('childWellbeing.noMessages')} />}
      <div className="card-grid">
        {targeted.map((m) => {
          const text = m.languageTexts.find((l) => l.languageTag === lang)?.text ?? m.languageTexts[0]?.text;
          return (
            <article className="card" key={m.messageId}>
              <h2>{t(`wellbeing.categories.${m.category}`)}</h2>
              <p>{text}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
