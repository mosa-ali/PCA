import { useTranslation } from 'react-i18next';

export default function Subscription() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="subscription-title">
      <h1 id="subscription-title">{t('nav.subscription')}</h1>
      <div className="card">
        <p>Plan: Family (DEV fixture)</p>
        <p>Status: Active</p>
      </div>
    </section>
  );
}
