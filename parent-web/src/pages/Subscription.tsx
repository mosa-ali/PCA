import { useTranslation } from 'react-i18next';

export default function Subscription() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="subscription-title">
      <h1 id="subscription-title">{t('nav.subscription')}</h1>
      <div className="card">
        <p>{t('subscription.planLabel', { plan: t('subscription.planFamilyDev') })}</p>
        <p>{t('subscription.statusLabel', { status: t('subscription.statusActive') })}</p>
      </div>
    </section>
  );
}
