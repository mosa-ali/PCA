import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../state/AuthContext';
import { applyDocumentDirection } from '../../i18n';
import type { FamilyRole } from '../../domain/roles';

interface HeaderProps {
  onToggleSidebar: () => void;
  onToggleDrawer: () => void;
  sidebarCollapsed: boolean;
  /** Whether the mobile navigation drawer is currently open. */
  drawerOpen?: boolean;
  /** Lets AppLayout restore focus here when the drawer is closed. */
  drawerToggleRef?: RefObject<HTMLButtonElement>;
}

const DEMO_ROLES: FamilyRole[] = ['OWNER', 'ADMINISTRATOR', 'VIEWER', 'CHILD'];

export function Header({
  onToggleSidebar,
  onToggleDrawer,
  sidebarCollapsed,
  drawerOpen = false,
  drawerToggleRef,
}: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { session, isFixtureBacked, setDemoRole } = useAuth();

  const changeLanguage = (lng: string) => {
    void i18n.changeLanguage(lng);
    applyDocumentDirection(lng);
  };

  return (
    <header className="app-header">
      <button
        ref={drawerToggleRef}
        type="button"
        className="icon-btn mobile-only"
        aria-label={drawerOpen ? t('shell.closeMenu') : t('shell.openMenu')}
        aria-controls="app-sidebar"
        aria-expanded={drawerOpen}
        onClick={onToggleDrawer}
      >
        <span aria-hidden="true">≡</span>
      </button>
      <button
        type="button"
        className="icon-btn desktop-only"
        aria-label={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.toggleSidebar')}
        aria-expanded={!sidebarCollapsed}
        aria-controls="app-sidebar"
        onClick={onToggleSidebar}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <strong>{t('app.name')}</strong>
      <div className="spacer" />
      {isFixtureBacked && (
        <label>
          <span className="visually-hidden">{t('shell.role')}</span>
          <select
            aria-label={t('shell.demoRoleSwitcher')}
            value={session?.role ?? 'OWNER'}
            onChange={(e) => setDemoRole(e.target.value as FamilyRole)}
          >
            {DEMO_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r.toLowerCase()}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className="visually-hidden">{t('shell.language')}</span>
        <select aria-label={t('shell.language')} value={i18n.language.split('-')[0]} onChange={(e) => changeLanguage(e.target.value)}>
          <option value="en">EN</option>
          <option value="ar">AR</option>
        </select>
      </label>
      {session && <span className="visually-hidden">{t('shell.signedInAs', { name: session.displayName })}</span>}
    </header>
  );
}
