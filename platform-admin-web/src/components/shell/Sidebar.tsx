import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NAV_SECTIONS } from '../../nav/navConfig';
import { isPermitted } from '../../domain/roles';
import { isBillingPermitted } from '../../domain/billingRbac';
import { useCurrentRoles } from '../../state/AuthContext';

interface SidebarProps {
  drawerOpen: boolean;
  onNavigate: () => void;
}

export function Sidebar({ drawerOpen, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const roles = useCurrentRoles();

  return (
    <nav className={`sidebar${drawerOpen ? ' drawer-open' : ''}`} aria-label={t('nav.dashboard')} id="app-sidebar">
      {NAV_SECTIONS.map((section, idx) => {
        const visibleItems = section.items.filter(
          (item) => (item.operation ? isPermitted(roles, item.operation) : true) && (item.billingOperation ? isBillingPermitted(roles, item.billingOperation) : true),
        );
        if (visibleItems.length === 0) return null;
        return (
          <div key={section.titleKey ?? `section-${idx}`}>
            {section.titleKey && <p className="sidebar-section-title">{t(section.titleKey)}</p>}
            {visibleItems.map((item) => (
              <NavLink key={item.path} to={item.path} className="nav-link" onClick={onNavigate}>
                {t(item.labelKey)}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
