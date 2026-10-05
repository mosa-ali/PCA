import { useTranslation } from 'react-i18next';
import { RecoverySecretLossDisclosure } from './RecoverySecretDisclosure';

export default function Recovery() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="recovery-title">
      <h1 id="recovery-title">{t('nav.recovery')}</h1>
      <p>{t('recovery.description')}</p>
      <RecoverySecretLossDisclosure showAcknowledgement={false} />
      <p role="status">{t('recovery.notYetAvailable')}</p>
    </section>
  );
}
