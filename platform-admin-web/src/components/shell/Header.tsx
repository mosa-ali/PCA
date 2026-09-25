import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { AppearanceSelector } from '../common/AppearanceSelector';

interface HeaderProps {
  onToggleDrawer: () => void;
}

export function Header({ onToggleDrawer }: HeaderProps) {
  const { t } = useTranslation();
  const { displayName, adminId, roles, sessionExpiresAt, logout } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const handleLogout = async () => {
    await logout();
    notify(t('shell.logout'), 'info');
    navigate('/login', { replace: true });
  };

  return (
    <header className="app-header">
      <button
        type="button"
        className="icon-btn mobile-only"
        aria-label={t('app.skipToContent')}
        aria-controls="app-sidebar"
        onClick={onToggleDrawer}
      >
        <span aria-hidden="true">≡</span>
      </button>
      <strong>{t('app.title')}</strong>
      <div className="spacer" />
      <div className="header-controls">
        <LanguageSwitcher />
        {adminId && (
          <details className="account-menu">
            <summary className="account-menu-trigger" aria-label={t('shell.accountMenuLabel')}>
              {displayName || t('shell.accountFallback')}
              <span aria-hidden="true"> ▾</span>
            </summary>
            <div className="account-menu-panel">
              <strong className="account-menu-name">{displayName || t('shell.accountFallback')}</strong>
              <div className="account-menu-section">
                <span className="account-menu-label">{t('dashboard.rolesLabel')}</span>
                <ul>{roles.map((role) => <li key={role}>{t(`roles.${role}`)}</li>)}</ul>
              </div>
              {sessionExpiresAt && <p className="account-menu-expiry"><span className="account-menu-label">{t('shell.sessionExpiryLabel')}</span><br />{new Date(sessionExpiresAt).toLocaleString()}</p>}
              <div className="account-menu-section"><AppearanceSelector /></div>
              <button type="button" className="btn account-menu-logout" onClick={handleLogout}>{t('shell.logout')}</button>
            </div>
          </details>
        )}
      </div>
    </header>
  );
}
