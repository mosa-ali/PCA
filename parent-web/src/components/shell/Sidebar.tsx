import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NAV_SECTIONS } from '../../nav/navConfig';

interface SidebarProps {
  collapsed: boolean;
  drawerOpen: boolean;
  onNavigate: () => void;
}

export function Sidebar({ collapsed, drawerOpen, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  return (
    <nav
      className={`sidebar${drawerOpen ? ' drawer-open' : ''}`}
      aria-label={t('nav.dashboard')}
      id="app-sidebar"
    >
      {NAV_SECTIONS.map((section, idx) => (
        <div key={section.titleKey ?? `section-${idx}`}>
          {section.titleKey && !collapsed && (
            <p className="sidebar-section-title">{t(section.titleKey)}</p>
          )}
          {section.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className="nav-link"
              onClick={onNavigate}
            >
              <span>{collapsed ? t(item.labelKey).slice(0, 1) : t(item.labelKey)}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
