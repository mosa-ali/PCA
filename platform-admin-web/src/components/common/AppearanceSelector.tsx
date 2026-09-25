import { useTranslation } from 'react-i18next';
import { useAppearance, type Appearance } from '../../state/AppearanceContext';

export function AppearanceSelector() {
  const { t } = useTranslation();
  const { appearance, setAppearance } = useAppearance();
  return (
    <label className="appearance-selector">
      <span className="visually-hidden">{t('appearance.label')}</span>
      <select aria-label={t('appearance.label')} value={appearance} onChange={(event) => setAppearance(event.target.value as Appearance)}>
        <option value="dark">{t('appearance.dark')}</option>
        <option value="slate">{t('appearance.slate')}</option>
        <option value="light">{t('appearance.light')}</option>
      </select>
    </label>
  );
}
