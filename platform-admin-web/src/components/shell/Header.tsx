import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useToast } from '../../state/ToastContext';
import { LanguageSwitcher } from '../common/LanguageSwitcher';

interface HeaderProps {
  onToggleDrawer: () => void;
}

export function Header({ onToggleDrawer }: HeaderProps) {
  const { t } = useTranslation();
  const { adminId, roles, sessionExpiresAt, logout } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const handleLogout = async () => {
    await logout();
    notify(t('shell.logout'), 'info');
    navigate('/login', { replace: true });
  };

  const roleLabels = roles.map((role) => t(`roles.${role}`)).join(', ');

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
      <LanguageSwitcher />
      {adminId && (
        <div className="identity-badge">
          <span>{t('shell.signedInAs', { adminId })}</span>
          {roles.length > 0 && <span>{t('shell.role', { count: roles.length, roles: roleLabels })}</span>}
          {sessionExpiresAt && (
            <span className="session-expiry">{t('shell.sessionExpiresAt', { time: new Date(sessionExpiresAt).toLocaleTimeString() })}</span>
          )}
        </div>
      )}
      <button type="button" className="btn" onClick={handleLogout}>
        {t('shell.logout')}
      </button>
    </header>
  );
}
