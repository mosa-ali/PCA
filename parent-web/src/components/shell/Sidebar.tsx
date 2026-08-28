import type { RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NAV_SECTIONS } from '../../nav/navConfig';

interface SidebarProps {
  collapsed: boolean;
  drawerOpen: boolean;
  onNavigate: () => void;
  /** Closes the mobile drawer (the in-drawer close control). */
  onClose: () => void;
  /** Lets AppLayout move focus to the close control when the drawer opens. */
  closeButtonRef?: RefObject<HTMLButtonElement>;
}

export function Sidebar({ collapsed, drawerOpen, onNavigate, onClose, closeButtonRef }: SidebarProps) {
  const { t } = useTranslation();
  return (
    <nav
      className={`sidebar${drawerOpen ? ' drawer-open' : ''}`}
      // The landmark's own name -- it used to be t('nav.dashboard'), i.e. a
      // navigation region announced as "Dashboard".
      aria-label={t('shell.primaryNav')}
      id="app-sidebar"
    >
      {drawerOpen && (
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-btn drawer-close mobile-only"
          aria-label={t('shell.closeMenu')}
          onClick={onClose}
        >
          <span aria-hidden="true">&times;</span>
        </button>
      )}
      {NAV_SECTIONS.map((section, idx) => (
        <div key={section.titleKey ?? `section-${idx}`}>
          {section.titleKey && !collapsed && (
            <p className="sidebar-section-title">{t(section.titleKey)}</p>
          )}
          {section.items.map((item) => {
            const label = t(item.labelKey);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className="nav-link"
                onClick={onNavigate}
                title={collapsed ? label : undefined}
              >
                {/*
                  Collapsed, the rail shows a single character. That character
                  must NOT be the link's accessible name: in Arabic 10 of the 18
                  nav labels start with the definite article "ا", so ten links
                  were all announced as "ا" and were indistinguishable to a
                  screen-reader or voice-control user. The initial is decorative
                  (aria-hidden) and the full label is always present for
                  assistive technology, collapsed or not.
                */}
                {collapsed ? (
                  <>
                    <span aria-hidden="true">{label.slice(0, 1)}</span>
                    <span className="visually-hidden">{label}</span>
                  </>
                ) : (
                  <span>{label}</span>
                )}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
