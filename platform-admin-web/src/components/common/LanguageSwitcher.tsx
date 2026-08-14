import { useTranslation } from 'react-i18next';
import { applyDocumentDirection } from '../../i18n';

/**
 * Shared EN/AR switcher. Rendered both inside the authenticated shell
 * (Header) and on the standalone Login page -- mission Section 25 requires
 * Arabic/RTL support "from the first implementation," which includes the
 * very first screen an operator sees, not just the post-login shell.
 */
export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    void i18n.changeLanguage(lng);
    applyDocumentDirection(lng);
  };

  return (
    <label>
      <span className="visually-hidden">Language</span>
      <select aria-label="Language" value={i18n.language.split('-')[0]} onChange={(e) => changeLanguage(e.target.value)}>
        <option value="en">EN</option>
        <option value="ar">AR</option>
      </select>
    </label>
  );
}
