import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="card">
        <h1>{t('notFound.title')}</h1>
        <p>{t('notFound.body')}</p>
      </div>
    </div>
  );
}
