import { useTranslation } from 'react-i18next';

export default function NotPermitted() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="card" role="alert">
        <h1>{t('notPermitted.title')}</h1>
        <p>{t('notPermitted.body')}</p>
      </div>
    </div>
  );
}
